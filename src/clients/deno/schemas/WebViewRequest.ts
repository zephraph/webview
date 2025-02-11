// DO NOT EDIT: This file is auto-generated by generate-schema/index.ts
import { z } from "npm:zod";

export type Size = {
  /** The height of the window in logical pixels. */
  height: number;
  /** The width of the window in logical pixels. */
  width: number;
};

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
    size: Size;
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

export const Size: z.ZodType<Size> = z.object({
  height: z.number(),
  width: z.number(),
});

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
    z.object({ $type: z.literal("setSize"), id: z.string(), size: Size }),
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
