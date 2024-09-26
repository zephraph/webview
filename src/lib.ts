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
  WebViewMessage,
  type WebViewOptions,
  type WebViewRequest,
  WebViewResponse,
} from "./schemas.ts";
import { monotonicUlid as ulid } from "jsr:@std/ulid";
import type { Except, Simplify } from "npm:type-fest";
import { join } from "jsr:@std/path";
import { ensureDir, exists } from "jsr:@std/fs";

export type { WebViewOptions } from "./schemas.ts";

// Should match the cargo package version
/** The version of the webview binary that's expected */
export const BIN_VERSION = "0.1.11";

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
  const fileName = `deno-webview-${BIN_VERSION}${flags}${
    Deno.build.os === "windows" ? ".exe" : ""
  }`;
  const filePath = join(cacheDir, fileName);

  // Check if the file already exists in cache
  if (await exists(filePath)) {
    return filePath;
  }

  // If not in cache, download it
  let url =
    `https://github.com/zephraph/webview/releases/download/webview-v${BIN_VERSION}/deno-webview`;
  switch (Deno.build.os) {
    case "darwin": {
      url += "-mac" + (Deno.build.arch === "aarch64" ? "-arm64" : "") + flags;
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

/**
 * Creates a new webview window.
 *
 * Will automatically fetch the webview binary if it's not already downloaded
 */
export async function createWebView(options: WebViewOptions): Promise<WebView> {
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
  #options: WebViewOptions;

  /**
   * Creates a new webview window.
   *
   * @param options - The options for the webview.
   * @param webviewBinaryPath - The path to the webview binary.
   */
  constructor(options: WebViewOptions, webviewBinaryPath: string) {
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
    const id = ulid();
    return new Promise((resolve) => {
      // Setup listener before sending the message to avoid race conditions
      this.#internalEvent.once(id, (event) => {
        const result = WebViewResponse.safeParse(event);
        if (result.success) {
          resolve(result.data);
        } else {
          resolve({ $type: "err", id, message: result.error.message });
        }
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
      const result = WebViewMessage.safeParse(
        JSON.parse(this.#buffer.slice(0, NulCharIndex)),
      );
      this.#buffer = this.#buffer.slice(NulCharIndex + 1);
      if (result.success) {
        return result.data;
      } else {
        console.error("Error parsing message", result.error);
        return result;
      }
    }
  }

  async #processMessageLoop() {
    while (true) {
      const result = await this.#recv();
      if (!result) return;
      if ("error" in result) {
        // TODO: This should be handled more gracefully
        for (const issue of result.error.issues) {
          switch (issue.code) {
            case "invalid_type":
              console.error(
                `Invalid type: expected ${issue.expected} but got ${issue.received}`,
              );
              break;
            default:
              console.error(`Unknown error: ${issue.message}`);
          }
        }
        continue;
      }
      const { $type, data } = result;

      if ($type === "notification") {
        const { $type, ...body } = data;
        this.#externalEvent.emit($type, body);
        if (data.$type === "started") {
          const version = data.version;
          if (version !== BIN_VERSION) {
            console.warn(
              `Expected webview to be version ${BIN_VERSION} but got ${version}. Some features may not work as expected.`,
            );
          }
        }
        if ($type === "closed") {
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
  async getSize(
    includeDecorations?: boolean,
  ): Promise<{ width: number; height: number; scaleFactor: number }> {
    const result = await this.#send({
      $type: "getSize",
      include_decorations: includeDecorations,
    });
    const { width, height, scale_factor: scaleFactor } = returnResult(
      result,
      "size",
    );
    return { width, height, scaleFactor };
  }

  /**
   * Enters or exits fullscreen mode for the webview.
   *
   * @param fullscreen - If true, the webview will enter fullscreen mode. If false, the webview will exit fullscreen mode. If not specified, the webview will toggle fullscreen mode.
   */
  async fullscreen(fullscreen?: boolean): Promise<void> {
    const result = await this.#send({ $type: "fullscreen", fullscreen });
    return returnAck(result);
  }

  /**
   * Maximizes or unmaximizes the webview window.
   *
   * @param maximized - If true, the webview will be maximized. If false, the webview will be unmaximized. If not specified, the webview will toggle maximized state.
   */
  async maximize(maximized?: boolean): Promise<void> {
    const result = await this.#send({ $type: "maximize", maximized });
    return returnAck(result);
  }

  /**
   * Minimizes or unminimizes the webview window.
   *
   * @param minimized - If true, the webview will be minimized. If false, the webview will be unminimized. If not specified, the webview will toggle minimized state.
   */
  async minimize(minimized?: boolean): Promise<void> {
    const result = await this.#send({ $type: "minimize", minimized });
    return returnAck(result);
  }

  /**
   * Sets the title of the webview window.
   */
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
  async getTitle(): Promise<string> {
    const result = await this.#send({ $type: "getTitle" });
    return returnResult(result, "string");
  }

  /**
   * Sets the visibility of the webview window.
   */
  async setVisibility(visible: boolean): Promise<void> {
    const result = await this.#send({ $type: "setVisibility", visible });
    return returnAck(result);
  }

  /**
   * Returns true if the webview window is visible.
   */
  async isVisible(): Promise<boolean> {
    const result = await this.#send({ $type: "isVisible" });
    return returnResult(result, "boolean");
  }

  /**
   * Evaluates JavaScript code in the webview.
   */
  async eval(code: string): Promise<void> {
    const result = await this.#send({ $type: "eval", js: code });
    return returnAck(result);
  }

  /**
   * Opens the developer tools for the webview.
   */
  async openDevTools(): Promise<void> {
    const result = await this.#send({ $type: "openDevTools" });
    return returnAck(result);
  }

  /**
   * Reloads the webview with the provided html.
   */
  async loadHtml(html: string): Promise<void> {
    const result = await this.#send({ $type: "loadHtml", html });
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
