// DO NOT EDIT: This file is auto-generated by generate-schema/index.ts
import { z } from "npm:zod";

/**
 * The content to load into the webview.
 */
export type WebViewContent =
  | {
    /** Optional headers to send with the request. */
    headers?: Record<string, string>;
    /** Url to load in the webview. Note: Don't use data URLs here, as they are not supported. Use the `html` field instead. */
    url: string;
  }
  | {
    /** Html to load in the webview. */
    html: string;
    /** What to set as the origin of the webview when loading html. */
    origin?: string;
  };

export type WindowSizeStates = "maximized" | "fullscreen";
export type WindowSize = WindowSizeStates | {
  height: number;
  width: number;
};

/**
 * Options for creating a webview.
 */
export type WebViewOptions = {
  /** Sets whether clicking an inactive window also clicks through to the webview. Default is false. */
  acceptFirstMouse?: boolean;
  /** When true, all media can be played without user interaction. Default is false. */
  autoplay?: boolean;
  /**
   * Enables clipboard access for the page rendered on Linux and Windows.
   *
   * macOS doesn’t provide such method and is always enabled by default. But your app will still need to add menu item accelerators to use the clipboard shortcuts.
   */
  clipboard?: boolean;
  /** When true, the window will have a border, a title bar, etc. Default is true. */
  decorations?: boolean;
  /**
   * Enable or disable webview devtools.
   *
   * Note this only enables devtools to the webview. To open it, you can call `webview.open_devtools()`, or right click the page and open it from the context menu.
   */
  devtools?: boolean;
  /** Sets whether the webview should be focused when created. Default is false. */
  focused?: boolean;
  /**
   * Run the WebView with incognito mode. Note that WebContext will be ingored if incognito is enabled.
   *
   * Platform-specific: - Windows: Requires WebView2 Runtime version 101.0.1210.39 or higher, does nothing on older versions, see https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/archive?tabs=dotnetcsharp#10121039
   */
  incognito?: boolean;
  /** Run JavaScript code when loading new pages. When the webview loads a new page, this code will be executed. It is guaranteed that the code is executed before window.onload. */
  initializationScript?: string;
  /** Sets whether host should be able to receive messages from the webview via `window.ipc.postMessage`. */
  ipc?: boolean;
  /** The content to load into the webview. */
  load: WebViewContent;
  /** The size of the window. */
  size?: WindowSize;
  /** Sets the title of the window. */
  title: string;
  /** Sets whether the window should be transparent. */
  transparent?: boolean;
  /** Sets the user agent to use when loading pages. */
  userAgent?: string;
};

export const WebViewContent: z.ZodType<WebViewContent> = z.union([
  z.object({
    headers: z.record(z.string(), z.string()).optional(),
    url: z.string(),
  }),
  z.object({ html: z.string(), origin: z.string() }),
]);

export const WindowSizeStates: z.ZodType<WindowSizeStates> = z.enum([
  "maximized",
  "fullscreen",
]);
export const WindowSize: z.ZodType<WindowSize> = z.union([
  WindowSizeStates,
  z.object({ height: z.number(), width: z.number() }),
]);

export const WebViewOptions: z.ZodType<WebViewOptions> = z.object({
  acceptFirstMouse: z.boolean().optional(),
  autoplay: z.boolean().optional(),
  clipboard: z.boolean().optional(),
  decorations: z.boolean().optional(),
  devtools: z.boolean().optional(),
  focused: z.boolean().optional(),
  incognito: z.boolean().optional(),
  initializationScript: z.string(),
  ipc: z.boolean().optional(),
  load: WebViewContent,
  size: WindowSize.optional(),
  title: z.string(),
  transparent: z.boolean().optional(),
  userAgent: z.string(),
});
