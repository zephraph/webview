// DO NOT EDIT: This file is auto-generated by scripts/generate-schema.ts
import { z } from "npm:zod";

/**
 * Complete definition of all outbound messages from the webview to the client.
 */
export type WebViewMessage =
  | {
    $type: "notification";
    data:
      | {
        $type: "started";
        /** The version of the webview binary */
        version: string;
      }
      | {
        $type: "ipc";
        /** The message sent from the webview UI to the client. */
        message: string;
      }
      | {
        $type: "closed";
      };
  }
  | {
    $type: "response";
    data:
      | {
        $type: "ack";
        id: string;
      }
      | {
        $type: "result";
        id: string;
        result:
          | {
            $type: "string";
            value: string;
          }
          | {
            $type: "boolean";
            value: boolean;
          }
          | {
            $type: "float";
            value: number;
          }
          | {
            $type: "size";
            value: {
              /** The height of the window in logical pixels. */
              height: number;
              /** The ratio between physical and logical sizes. */
              scale_factor: number;
              /** The width of the window in logical pixels. */
              width: number;
            };
          };
      }
      | {
        $type: "err";
        id: string;
        message: string;
      };
  };
export const WebViewMessage: z.ZodType<WebViewMessage> = z.discriminatedUnion(
  "$type",
  [
    z.object({
      $type: z.literal("notification"),
      data: z.discriminatedUnion("$type", [
        z.object({ $type: z.literal("started"), version: z.string() }),
        z.object({ $type: z.literal("ipc"), message: z.string() }),
        z.object({ $type: z.literal("closed") }),
      ]),
    }),
    z.object({
      $type: z.literal("response"),
      data: z.discriminatedUnion("$type", [
        z.object({ $type: z.literal("ack"), id: z.string() }),
        z.object({
          $type: z.literal("result"),
          id: z.string(),
          result: z.discriminatedUnion("$type", [
            z.object({ $type: z.literal("string"), value: z.string() }),
            z.object({ $type: z.literal("boolean"), value: z.boolean() }),
            z.object({ $type: z.literal("float"), value: z.number() }),
            z.object({
              $type: z.literal("size"),
              value: z.object({
                height: z.number(),
                scale_factor: z.number(),
                width: z.number(),
              }),
            }),
          ]),
        }),
        z.object({
          $type: z.literal("err"),
          id: z.string(),
          message: z.string(),
        }),
      ]),
    }),
  ],
);

/**
 * Options for creating a webview.
 */
export type WebViewOptions =
  & {
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
    /** The size of the window. */
    size?: "maximized" | "fullscreen" | {
      height: number;
      width: number;
    };
    /** Sets the title of the window. */
    title: string;
    /** Sets whether the window should be transparent. */
    transparent?: boolean;
    /** Sets the user agent to use when loading pages. */
    userAgent?: string;
  }
  & (
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
    }
  );
export const WebViewOptions: z.ZodType<WebViewOptions> = z.intersection(
  z.object({
    acceptFirstMouse: z.boolean().optional(),
    autoplay: z.boolean().optional(),
    clipboard: z.boolean().optional(),
    decorations: z.boolean().optional(),
    devtools: z.boolean().optional(),
    focused: z.boolean().optional(),
    incognito: z.boolean().optional(),
    initializationScript: z.string().optional(),
    ipc: z.boolean().optional(),
    size: z.union([
      z.literal("maximized"),
      z.literal("fullscreen"),
      z.object({ height: z.number(), width: z.number() }),
    ])
      .optional(),
    title: z.string(),
    transparent: z.boolean().optional(),
    userAgent: z.string().optional(),
  }),
  z.union([
    z.object({
      headers: z.record(z.string(), z.string()).optional(),
      url: z.string(),
    }),
    z.object({ html: z.string(), origin: z.string().optional() }),
  ]),
);

/**
 * Explicit requests from the client to the webview.
 */
export type WebViewRequest =
  | {
    $type: "getVersion";
    /** The id of the request. */
    id: string;
  }
  | {
    $type: "eval";
    /** The id of the request. */
    id: string;
    /** The javascript to evaluate. */
    js: string;
  }
  | {
    $type: "setTitle";
    /** The id of the request. */
    id: string;
    /** The title to set. */
    title: string;
  }
  | {
    $type: "getTitle";
    /** The id of the request. */
    id: string;
  }
  | {
    $type: "setVisibility";
    /** The id of the request. */
    id: string;
    /** Whether the window should be visible or hidden. */
    visible: boolean;
  }
  | {
    $type: "isVisible";
    /** The id of the request. */
    id: string;
  }
  | {
    $type: "openDevTools";
    /** The id of the request. */
    id: string;
  }
  | {
    $type: "getSize";
    /** The id of the request. */
    id: string;
    /** Whether to include the title bar and borders in the size measurement. */
    include_decorations?: boolean;
  }
  | {
    $type: "setSize";
    /** The id of the request. */
    id: string;
    /** The size to set. */
    size: {
      height: number;
      width: number;
    };
  }
  | {
    $type: "fullscreen";
    /** Whether to enter fullscreen mode. If left unspecified, the window will enter fullscreen mode if it is not already in fullscreen mode or exit fullscreen mode if it is currently in fullscreen mode. */
    fullscreen?: boolean;
    /** The id of the request. */
    id: string;
  }
  | {
    $type: "maximize";
    /** The id of the request. */
    id: string;
    /** Whether to maximize the window. If left unspecified, the window will be maximized if it is not already maximized or restored if it was previously maximized. */
    maximized?: boolean;
  }
  | {
    $type: "minimize";
    /** The id of the request. */
    id: string;
    /** Whether to minimize the window. If left unspecified, the window will be minimized if it is not already minimized or restored if it was previously minimized. */
    minimized?: boolean;
  }
  | {
    $type: "loadHtml";
    /** HTML to set as the content of the webview. */
    html: string;
    /** The id of the request. */
    id: string;
    /** What to set as the origin of the webview when loading html. If not specified, the origin will be set to the value of the `origin` field when the webview was created. */
    origin?: string;
  }
  | {
    $type: "loadUrl";
    /** Optional headers to send with the request. */
    headers?: Record<string, string>;
    /** The id of the request. */
    id: string;
    /** URL to load in the webview. */
    url: string;
  };
export const WebViewRequest: z.ZodType<WebViewRequest> = z.discriminatedUnion(
  "$type",
  [
    z.object({ $type: z.literal("getVersion"), id: z.string() }),
    z.object({ $type: z.literal("eval"), id: z.string(), js: z.string() }),
    z.object({
      $type: z.literal("setTitle"),
      id: z.string(),
      title: z.string(),
    }),
    z.object({ $type: z.literal("getTitle"), id: z.string() }),
    z.object({
      $type: z.literal("setVisibility"),
      id: z.string(),
      visible: z.boolean(),
    }),
    z.object({ $type: z.literal("isVisible"), id: z.string() }),
    z.object({ $type: z.literal("openDevTools"), id: z.string() }),
    z.object({
      $type: z.literal("getSize"),
      id: z.string(),
      include_decorations: z.boolean().optional(),
    }),
    z.object({
      $type: z.literal("setSize"),
      id: z.string(),
      size: z.object({ height: z.number(), width: z.number() }),
    }),
    z.object({
      $type: z.literal("fullscreen"),
      fullscreen: z.boolean().optional(),
      id: z.string(),
    }),
    z.object({
      $type: z.literal("maximize"),
      id: z.string(),
      maximized: z.boolean().optional(),
    }),
    z.object({
      $type: z.literal("minimize"),
      id: z.string(),
      minimized: z.boolean().optional(),
    }),
    z.object({
      $type: z.literal("loadHtml"),
      html: z.string(),
      id: z.string(),
      origin: z.string().optional(),
    }),
    z.object({
      $type: z.literal("loadUrl"),
      headers: z.record(z.string(), z.string()).optional(),
      id: z.string(),
      url: z.string(),
    }),
  ],
);

/**
 * Responses from the webview to the client.
 */
export type WebViewResponse =
  | {
    $type: "ack";
    id: string;
  }
  | {
    $type: "result";
    id: string;
    result:
      | {
        $type: "string";
        value: string;
      }
      | {
        $type: "boolean";
        value: boolean;
      }
      | {
        $type: "float";
        value: number;
      }
      | {
        $type: "size";
        value: {
          /** The height of the window in logical pixels. */
          height: number;
          /** The ratio between physical and logical sizes. */
          scale_factor: number;
          /** The width of the window in logical pixels. */
          width: number;
        };
      };
  }
  | {
    $type: "err";
    id: string;
    message: string;
  };
export const WebViewResponse: z.ZodType<WebViewResponse> = z.discriminatedUnion(
  "$type",
  [
    z.object({ $type: z.literal("ack"), id: z.string() }),
    z.object({
      $type: z.literal("result"),
      id: z.string(),
      result: z.discriminatedUnion("$type", [
        z.object({ $type: z.literal("string"), value: z.string() }),
        z.object({ $type: z.literal("boolean"), value: z.boolean() }),
        z.object({ $type: z.literal("float"), value: z.number() }),
        z.object({
          $type: z.literal("size"),
          value: z.object({
            height: z.number(),
            scale_factor: z.number(),
            width: z.number(),
          }),
        }),
      ]),
    }),
    z.object({ $type: z.literal("err"), id: z.string(), message: z.string() }),
  ],
);
