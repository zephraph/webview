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
import type { Except } from "npm:type-fest";
import { join } from "jsr:@std/path";
import { ensureDir, exists } from "jsr:@std/fs";

export type { WebViewOptions } from "./schemas.ts";

// Should match the cargo package version
/** The version of the webview binary that's expected */
export const BIN_VERSION = "0.1.8";

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

/**
 * A helper function for extracting the result from a webview response.
 *
 * @param result - The result of the webview request.
 * @param expectedType - The format of the expected result.
 */
function returnResult(
  result: WebViewResponse,
  expectedType: "boolean",
): boolean;
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
): string | JSON | boolean {
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
        case "boolean":
          return res.value;
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

  /**
   * Creates a new webview window.
   *
   * @param options - The options for the webview.
   * @param webviewBinaryPath - The path to the webview binary.
   */
  constructor(options: WebViewOptions, webviewBinaryPath: string) {
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
        const notification = data;
        this.#externalEvent.emit(notification.$type);
        if (notification.$type === "started") {
          const version = notification.version;
          if (version !== BIN_VERSION) {
            console.warn(
              `Expected webview to be version ${BIN_VERSION} but got ${version}. Some features may not work as expected.`,
            );
          }
        }
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

  /**
   * Listens for events emitted by the webview.
   */
  on(
    event: WebViewNotification["$type"],
    callback: (event: WebViewNotification) => void,
  ) {
    this.#externalEvent.on(event, callback);
  }

  /**
   * Listens for a single event emitted by the webview.
   */
  once(
    event: WebViewNotification["$type"],
    callback: (event: WebViewNotification) => void,
  ) {
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
