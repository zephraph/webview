/**
 * A library for creating and interacting with native webview windows.
 *
 * @module
 *
 * @example
 * ```ts
 * import { createWebView } from "jsr:@justbe/webview";
 *
 * using webview = await createWebView({
 *  title: "Example",
 *  html: "<h1>Hello, World!</h1>",
 *  devtools: true
 * });
 *
 * webview.on("started", async () => {
 *  await webview.openDevTools();
 *  await webview.eval("console.log('This is printed from eval!')");
 * });
 *
 * await webview.waitUntilClosed();
 * ```
 */

import { EventEmitter } from "node:events";
import {
  Message,
  type Options,
  type Request as WebViewRequest,
  Response as WebViewResponse,
} from "./schemas.ts";
import type { Except, Simplify } from "npm:type-fest";
import { join } from "jsr:@std/path";
import { ensureDir, exists } from "jsr:@std/fs";
import { error, FmtSubscriber, instrument, Level, trace, warn } from "tracing";
import { match, P } from "ts-pattern";

export * from "./schemas.ts";

if (
  Deno.permissions.querySync({ name: "env", variable: "LOG_LEVEL" }).state ===
    "granted"
) {
  const level = match(Deno.env.get("LOG_LEVEL"))
    .with("trace", () => Level.TRACE)
    .with("debug", () => Level.DEBUG)
    .with("info", () => Level.INFO)
    .with("warn", () => Level.WARN)
    .with("error", () => Level.ERROR)
    .with("fatal", () => Level.CRITICAL)
    .otherwise(() => Level.INFO);

  FmtSubscriber.setGlobalDefault({ level, color: true });
}

// Should match the cargo package version
/** The version of the webview binary that's expected */
export const BIN_VERSION = "0.3.1";

type WebViewNotification = Extract<
  Message,
  { $type: "notification" }
>["data"];

type ResultType = Extract<WebViewResponse, { $type: "result" }>;

/**
 * A helper function for extracting the result from a webview response.
 * Throws if the response includes unexpected results.
 *
 * @param result - The result of the webview request.
 * @param expectedType - The format of the expected result.
 */
function returnResult<
  Response extends WebViewResponse,
  E extends ResultType["result"]["$type"],
>(
  result: Response,
  expectedType: E,
): Extract<ResultType["result"], { $type: E }>["value"] {
  if (result.$type === "result") {
    if (result.result.$type === expectedType) {
      // @ts-expect-error TS doesn't correctly narrow this type, but it's correct
      return result.result.value;
    }
    throw new Error(`unexpected result type: ${result.result.$type}`);
  }
  throw new Error(`unexpected response: ${result.$type}`);
}

/**
 * A helper function for acknowledging a webview response.
 * Throws if the response includes unexpected results.
 */
const returnAck = (result: WebViewResponse) => {
  return match(result)
    .with({ $type: "ack" }, () => undefined)
    .with({ $type: "err" }, (err) => {
      throw new Error(err.message);
    })
    .otherwise(() => {
      throw new Error(`unexpected response: ${result.$type}`);
    });
};

async function getWebViewBin(options: Options) {
  if (
    Deno.permissions.querySync({ name: "env", variable: "WEBVIEW_BIN" })
      .state === "granted"
  ) {
    const binPath = Deno.env.get("WEBVIEW_BIN");
    if (binPath) return binPath;
  }

  const flags = options.devtools
    ? "-devtools"
    : options.transparent && Deno.build.os === "darwin"
    ? "-transparent"
    : "";

  const cacheDir = getCacheDir();
  const fileName = `webview-${BIN_VERSION}${flags}${
    Deno.build.os === "windows" ? ".exe" : ""
  }`;
  const filePath = join(cacheDir, fileName);

  // Check if the file already exists in cache
  if (await exists(filePath)) {
    return filePath;
  }

  // If not in cache, download it
  let url =
    `https://github.com/zephraph/webview/releases/download/webview-v${BIN_VERSION}/webview`;
  url += match(Deno.build.os)
    .with(
      "darwin",
      () => "-mac" + (Deno.build.arch === "aarch64" ? "-arm64" : "") + flags,
    )
    .with("linux", () => "-linux" + flags)
    .with("windows", () => "-windows" + flags + ".exe")
    .otherwise(() => {
      throw new Error("unsupported OS");
    });

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
  return match(Deno.build.os)
    .with(
      "darwin",
      () => join(Deno.env.get("HOME")!, "Library", "Caches", "webview"),
    )
    .with("linux", () => join(Deno.env.get("HOME")!, ".cache", "webview"))
    .with(
      "windows",
      () => join(Deno.env.get("LOCALAPPDATA")!, "webview", "Cache"),
    )
    .otherwise(() => {
      throw new Error("Unsupported OS");
    });
}

/**
 * Creates a new webview window.
 *
 * Will automatically fetch the webview binary if it's not already downloaded
 */
export async function createWebView(options: Options): Promise<WebView> {
  const binPath = await getWebViewBin(options);
  return new WebView(options, binPath);
}

/**
 * A webview window. It's recommended to use the `createWebView` function
 * because it provides a means of automatically fetching the webview binary
 * that's compatible with your OS and architecture.
 *
 * Each instance of `WebView` spawns a new process that governs a single webview window.
 */
export class WebView implements Disposable {
  #process: Deno.ChildProcess;
  #stdin: WritableStreamDefaultWriter;
  #stdout: ReadableStreamDefaultReader;
  #buffer = "";
  #internalEvent = new EventEmitter();
  #externalEvent = new EventEmitter();
  #messageLoop: Promise<void>;
  #options: Options;
  #messageId = 0;

  /**
   * Creates a new webview window.
   *
   * @param options - The options for the webview.
   * @param webviewBinaryPath - The path to the webview binary.
   */
  constructor(options: Options, webviewBinaryPath: string) {
    this.#options = options;
    this.#process = new Deno.Command(webviewBinaryPath, {
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
    const id = this.#messageId++;
    return new Promise((resolve) => {
      // Setup listener before sending the message to avoid race conditions
      this.#internalEvent.once(id.toString(), (event) => {
        const result = WebViewResponse.safeParse(event);
        if (result.success) {
          resolve(result.data);
        } else {
          resolve({ $type: "err", id, message: result.error.message });
        }
      });
      this.#stdin.write(
        new TextEncoder().encode(
          JSON.stringify({ ...request, id }),
        ),
      );
    });
  }

  @instrument()
  async #recv() {
    while (true) {
      const { value, done } = await this.#stdout.read();
      if (done) {
        break;
      }
      this.#buffer += new TextDecoder().decode(value);

      const newlineIndex = this.#buffer.indexOf("\n");
      if (newlineIndex === -1) {
        continue;
      }
      trace("buffer", { buffer: this.#buffer });
      const result = Message.safeParse(
        JSON.parse(this.#buffer.slice(0, newlineIndex)),
      );
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (result.success) {
        return result.data;
      } else {
        error("Error parsing message", { error: result.error });
        return result;
      }
    }
  }

  async #processMessageLoop() {
    while (true) {
      const result = await this.#recv();
      if (!result) return;
      match(result)
        .with({ error: { issues: [{ code: "invalid_type" }] } }, (result) => {
          error("Invalid type", { error: result.error });
        })
        .with({ error: P.nonNullable }, (result) => {
          error("Unknown error", { error: result.error });
        })
        .with({ $type: "notification" }, ({ data }) => {
          const { $type, ...body } = data;
          this.#externalEvent.emit($type, body);
          if (data.$type === "started" && data.version !== BIN_VERSION) {
            warn(
              `Expected webview to be version ${BIN_VERSION} but got ${data.version}. Some features may not work as expected.`,
            );
          }
        })
        .with({ $type: "response" }, ({ data }) => {
          this.#internalEvent.emit(data.id.toString(), data);
        })
        .exhaustive();
    }
  }

  /**
   * Returns a promise that resolves when the webview window is closed.
   */
  async waitUntilClosed() {
    await this.#messageLoop;
  }

  /**
   * Listens for events emitted by the webview.
   */
  on<E extends WebViewNotification["$type"]>(
    event: E,
    callback: (
      event: Simplify<
        Omit<Extract<WebViewNotification, { $type: E }>, "$type">
      >,
    ) => void,
  ) {
    if (event === "ipc" && !this.#options.ipc) {
      throw new Error("IPC is not enabled for this webview");
    }
    this.#externalEvent.on(event, callback);
  }

  /**
   * Listens for a single event emitted by the webview.
   */
  once<E extends WebViewNotification["$type"]>(
    event: E,
    callback: (
      event: Simplify<
        Omit<Extract<WebViewNotification, { $type: E }>, "$type">
      >,
    ) => void,
  ) {
    if (event === "ipc" && !this.#options.ipc) {
      throw new Error("IPC is not enabled for this webview");
    }
    this.#externalEvent.once(event, callback);
  }

  /**
   * Gets the version of the webview binary.
   */
  @instrument()
  async getVersion(): Promise<string> {
    const result = await this.#send({ $type: "getVersion" });
    return returnResult(result, "string");
  }

  /**
   * Sets the size of the webview window.
   *
   * Note: this is the logical size of the window, not the physical size.
   * @see https://docs.rs/dpi/0.1.1/x86_64-unknown-linux-gnu/dpi/index.html#position-and-size-types
   */
  @instrument()
  async setSize(size: { width: number; height: number }): Promise<void> {
    const result = await this.#send({ $type: "setSize", size });
    return returnAck(result);
  }

  /**
   * Gets the size of the webview window.
   *
   * Note: this is the logical size of the window, not the physical size.
   * @see https://docs.rs/dpi/0.1.1/x86_64-unknown-linux-gnu/dpi/index.html#position-and-size-types
   */
  @instrument()
  async getSize(
    includeDecorations?: boolean,
  ): Promise<{ width: number; height: number; scaleFactor: number }> {
    const result = await this.#send({
      $type: "getSize",
      include_decorations: includeDecorations,
    });
    return returnResult(
      result,
      "size",
    );
  }

  /**
   * Enters or exits fullscreen mode for the webview.
   *
   * @param fullscreen - If true, the webview will enter fullscreen mode. If false, the webview will exit fullscreen mode. If not specified, the webview will toggle fullscreen mode.
   */
  @instrument()
  async fullscreen(fullscreen?: boolean): Promise<void> {
    const result = await this.#send({ $type: "fullscreen", fullscreen });
    return returnAck(result);
  }

  /**
   * Maximizes or unmaximizes the webview window.
   *
   * @param maximized - If true, the webview will be maximized. If false, the webview will be unmaximized. If not specified, the webview will toggle maximized state.
   */
  @instrument()
  async maximize(maximized?: boolean): Promise<void> {
    const result = await this.#send({ $type: "maximize", maximized });
    return returnAck(result);
  }

  /**
   * Minimizes or unminimizes the webview window.
   *
   * @param minimized - If true, the webview will be minimized. If false, the webview will be unminimized. If not specified, the webview will toggle minimized state.
   */
  @instrument()
  async minimize(minimized?: boolean): Promise<void> {
    const result = await this.#send({ $type: "minimize", minimized });
    return returnAck(result);
  }

  /**
   * Sets the title of the webview window.
   */
  @instrument()
  async setTitle(title: string): Promise<void> {
    const result = await this.#send({
      $type: "setTitle",
      title,
    });
    return returnAck(result);
  }

  /**
   * Gets the title of the webview window.
   */
  @instrument()
  async getTitle(): Promise<string> {
    const result = await this.#send({ $type: "getTitle" });
    return returnResult(result, "string");
  }

  /**
   * Sets the visibility of the webview window.
   */
  @instrument()
  async setVisibility(visible: boolean): Promise<void> {
    const result = await this.#send({ $type: "setVisibility", visible });
    return returnAck(result);
  }

  /**
   * Returns true if the webview window is visible.
   */
  @instrument()
  async isVisible(): Promise<boolean> {
    const result = await this.#send({ $type: "isVisible" });
    return returnResult(result, "boolean");
  }

  /**
   * Evaluates JavaScript code in the webview.
   */
  @instrument()
  async eval(code: string): Promise<void> {
    const result = await this.#send({ $type: "eval", js: code });
    return returnAck(result);
  }

  /**
   * Opens the developer tools for the webview.
   */
  @instrument()
  async openDevTools(): Promise<void> {
    const result = await this.#send({ $type: "openDevTools" });
    return returnAck(result);
  }

  /**
   * Reloads the webview with the provided html.
   */
  @instrument()
  async loadHtml(html: string): Promise<void> {
    const result = await this.#send({ $type: "loadHtml", html });
    return returnAck(result);
  }

  /**
   * Loads a URL in the webview.
   */
  @instrument()
  async loadUrl(url: string, headers?: Record<string, string>): Promise<void> {
    const result = await this.#send({ $type: "loadUrl", url, headers });
    return returnAck(result);
  }

  /**
   * Destroys the webview and cleans up resources.
   *
   * Alternatively you can use the disposible interface.
   *
   * @example
   * ```ts
   * // The `using` keyword will automatically call `destroy` on the webview when
   * // the webview goes out of scope.
   * using webview = await createWebView({ title: "My Webview" });
   * ```
   */
  @instrument()
  destroy() {
    this[Symbol.dispose]();
  }

  /**
   * Part of the explicit resource management feature added in TS 5.2
   *
   * When a reference to the webview is stored with `using` this method
   * will be called automatically when the webview goes out of scope.
   *
   * @example
   *
   * ```ts
   * {
   *  using webview = await createWebView({ title: "My Webview" });
   * } // Webview will be cleaned up here
   *
   * ```
   *
   * @see https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management
   */
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
