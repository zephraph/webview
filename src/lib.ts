import { EventEmitter } from "node:events";
import {
  WebViewMessage,
  type WebViewOptions,
  type WebViewRequest,
  WebViewResponse,
} from "./schemas.ts";
import { monotonicUlid as ulid } from "jsr:@std/ulid";
import type { Except } from "npm:type-fest";
import { join } from "jsr:@std/path";
import { ensureDir } from "jsr:@std/fs";
import { exists } from "jsr:@std/fs";

type JSON =
  | string
  | number
  | boolean
  | null
  | JSON[]
  | { [key: string]: JSON };

type WebViewNotification = Extract<
  WebViewMessage,
  { $type: "notification" }
>["data"];

type ResultType = Extract<WebViewResponse, { $type: "result" }>["result"];
type ResultKinds = Pick<ResultType, "$type">["$type"];

function returnResult(
  result: WebViewResponse,
  expectedType: "string",
): string;
function returnResult(
  result: WebViewResponse,
  expectedType: "json",
): JSON;
function returnResult(
  result: WebViewResponse,
  expectedType?: ResultKinds,
): string | JSON {
  switch (result.$type) {
    case "result": {
      if (expectedType && result.result.$type !== expectedType) {
        throw new Error(`unexpected result type: ${result.result.$type}`);
      }
      const res = result.result;
      switch (res.$type) {
        case "string":
          return res.value;
        case "json":
          return JSON.parse(res.value) as JSON;
      }
      break;
    }
    case "err":
      throw new Error(result.message);
    default:
      throw new Error(`unexpected response: ${result.$type}`);
  }
}

const returnAck = (result: WebViewResponse) => {
  switch (result.$type) {
    case "ack":
      return;
    case "err":
      throw new Error(result.message);
    default:
      throw new Error(`unexpected response: ${result.$type}`);
  }
};

async function getWebViewBin(options: WebViewOptions) {
  if (Deno.permissions.querySync({ name: "env" }).state === "granted") {
    const binPath = Deno.env.get("WEBVIEW_BIN");
    if (binPath) return binPath;
  }

  const flags = options.devtools
    ? "-devtools"
    : options.transparent && Deno.build.os === "darwin"
    ? "-transparent"
    : "";

  const cacheDir = getCacheDir();
  const fileName = `deno-webview${flags}${
    Deno.build.os === "windows" ? ".exe" : ""
  }`;
  const filePath = join(cacheDir, fileName);

  // Check if the file already exists in cache
  if (await exists(filePath)) {
    return filePath;
  }

  // If not in cache, download it
  let url =
    "https://github.com/zephraph/webview/releases/download/v0.1.4/deno-webview";
  switch (Deno.build.os) {
    case "darwin": {
      url += "-mac" + flags;
      break;
    }
    case "linux": {
      url += "-linux" + flags;
      break;
    }
    case "windows": {
      url += "-windows" + flags + ".exe";
      break;
    }
    default:
      throw new Error("unsupported OS");
  }

  const res = await fetch(url);

  // Ensure the cache directory exists
  await ensureDir(cacheDir);

  // Write the binary to disk
  await Deno.writeFile(filePath, new Uint8Array(await res.arrayBuffer()), {
    mode: 0o755,
  });

  return filePath;
}

// Helper function to get the OS-specific cache directory
function getCacheDir(): string {
  switch (Deno.build.os) {
    case "darwin":
      return join(Deno.env.get("HOME")!, "Library", "Caches", "deno-webview");
    case "linux":
      return join(Deno.env.get("HOME")!, ".cache", "deno-webview");
    case "windows":
      return join(Deno.env.get("LOCALAPPDATA")!, "deno-webview", "Cache");
    default:
      throw new Error("Unsupported OS");
  }
}

export async function createWebView(options: WebViewOptions) {
  const binPath = await getWebViewBin(options);
  return new WebView(options, binPath);
}

class WebView implements Disposable {
  #process: Deno.ChildProcess;
  #stdin: WritableStreamDefaultWriter;
  #stdout: ReadableStreamDefaultReader;
  #buffer = "";
  #internalEvent = new EventEmitter();
  #externalEvent = new EventEmitter();
  #messageLoop: Promise<void>;

  constructor(options: WebViewOptions, binPath: string) {
    this.#process = new Deno.Command(binPath, {
      args: [JSON.stringify(options)],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    }).spawn();
    this.#stdin = this.#process.stdin.getWriter();
    this.#stdout = this.#process.stdout.getReader();
    this.#messageLoop = this.#processMessageLoop();
  }

  #send(request: Except<WebViewRequest, "id">): Promise<WebViewResponse> {
    const id = ulid();
    return new Promise((resolve) => {
      // Setup listener before sending the message to avoid race conditions
      this.#internalEvent.once(id, (event) => {
        resolve(WebViewResponse.parse(event));
      });
      this.#stdin.write(
        new TextEncoder().encode(
          JSON.stringify({ ...request, id }).replace("\0", "") + "\0",
        ),
      );
    });
  }

  async #recv() {
    while (true) {
      const { value, done } = await this.#stdout.read();
      if (done) {
        break;
      }
      this.#buffer += new TextDecoder().decode(value);

      const NulCharIndex = this.#buffer.indexOf("\0");
      if (NulCharIndex === -1) {
        continue;
      }
      const result = WebViewMessage.parse(
        JSON.parse(this.#buffer.slice(0, NulCharIndex)),
      );
      this.#buffer = this.#buffer.slice(NulCharIndex + 1);
      return result;
    }
  }

  async #processMessageLoop() {
    while (true) {
      const result = await this.#recv();
      if (!result) return;
      const { $type, data } = result;

      if ($type === "notification") {
        const notification = data;
        this.#externalEvent.emit(notification.$type);
        if (notification.$type === "closed") {
          return;
        }
      }

      if ($type === "response") {
        const response = data;
        this.#internalEvent.emit(response.id, response);
      }
    }
  }

  /**
   * Returns a promise that resolves when the webview window is closed.
   */
  async waitUntilClosed() {
    await this.#messageLoop;
  }

  on(
    event: WebViewNotification["$type"],
    callback: (event: WebViewNotification) => void,
  ) {
    this.#internalEvent.on(event, callback);
  }

  once(
    event: WebViewNotification["$type"],
    callback: (event: WebViewNotification) => void,
  ) {
    this.#internalEvent.once(event, callback);
  }

  async setTitle(title: string): Promise<void> {
    const result = await this.#send({
      $type: "setTitle",
      title,
    });
    return returnAck(result);
  }

  /**
   * Gets the title of the webview.
   */
  async getTitle() {
    const result = await this.#send({ $type: "getTitle" });
    return returnResult(result, "string");
  }

  bind(name: string, callback: (...args: any[]) => any) {}

  unbind(name: string) {}

  /**
   * Evaluates JavaScript code in the webview.
   */
  async eval(code: string) {
    const result = await this.#send({ $type: "eval", js: code });
    return returnAck(result);
  }

  async openDevTools() {
    const result = await this.#send({ $type: "openDevTools" });
    return returnAck(result);
  }

  destroy() {
    this[Symbol.dispose]();
  }

  [Symbol.dispose](): void {
    this.#internalEvent.removeAllListeners();
    this.#stdin.releaseLock();
    try {
      this.#process.kill();
    } catch (_) {
      _;
    }
  }
}
