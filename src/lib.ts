import { EventEmitter } from "node:events";
import { ClientEvent, WebViewEvent, WebViewOptions } from "./schemas.ts";

export class WebView implements Disposable {
  #process: Deno.ChildProcess;
  #stdin: WritableStreamDefaultWriter;
  #stdout: ReadableStreamDefaultReader;
  #buffer = "";
  #event = new EventEmitter();
  #messageLoop: Promise<void>;

  constructor(options: WebViewOptions) {
    this.#process = new Deno.Command("./target/debug/deno-webview", {
      args: [JSON.stringify(options)],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    }).spawn();
    this.#stdin = this.#process.stdin.getWriter();
    this.#stdout = this.#process.stdout.getReader();
    this.#messageLoop = this.#processMessageLoop();
  }

  #send(event: ClientEvent) {
    this.#stdin.write(
      new TextEncoder().encode(JSON.stringify(event).replace("\0", "") + "\0"),
    );
  }

  async #recv() {
    while (true) {
      const { value, done } = await this.#stdout.read();
      if (done) {
        break;
      }
      this.#buffer += new TextDecoder().decode(value);

      const newLineIndex = this.#buffer.indexOf("\0");
      if (newLineIndex === -1) {
        continue;
      }
      const result = WebViewEvent.safeParse(
        JSON.parse(this.#buffer.slice(0, newLineIndex)),
      );
      this.#buffer = this.#buffer.slice(newLineIndex + 1);
      return result;
    }
  }

  async #processMessageLoop() {
    while (true) {
      const result = await this.#recv();
      if (result?.success) {
        this.#event.emit(result.data.$type, result.data);
        switch (result.data.$type) {
          case "closed":
            return;
        }
      } else {
        this.#event.emit("error", result?.error);
      }
    }
  }

  async waitUntilClosed() {
    await this.#messageLoop;
  }

  setTitle(title: string) {
    this.#stdin.write(title);
  }

  on(event: WebViewEvent["$type"], callback: (event: WebViewEvent) => void) {
    this.#event.on(event, callback);
  }

  getTitle() {
    return this.#stdout.read();
  }

  bind(name: string, callback: (...args: any[]) => any) {}

  unbind(name: string) {}

  eval(code: string, callback?: (result: any) => void) {
    this.#send({ $type: "eval", data: code });
  }

  destroy() {
    this[Symbol.dispose]();
  }

  [Symbol.dispose](): void {
    this.#stdin.releaseLock();
    try {
      this.#process.kill();
    } catch (_) {
      _;
    }
  }
}
