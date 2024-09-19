// DO NOT EDIT: This file is auto-generated by scripts/generate-zod.ts
import { z } from "npm:zod";

export const ClientEvent = z.discriminatedUnion("$type", [
  z.object({ $type: z.literal("eval"), data: z.string() }),
  z.object({ $type: z.literal("setTitle"), data: z.string() }),
  z.object({ $type: z.literal("getTitle"), data: z.undefined().optional() }),
  z.object({
    $type: z.literal("openDevTools"),
    data: z.undefined().optional(),
  }),
]);

export type ClientEvent = z.infer<typeof ClientEvent>;

export const WebViewOptions = z.intersection(
  z.object({
    accept_first_mouse: z.boolean().optional(),
    autoplay: z.boolean().optional(),
    clipboard: z.boolean().optional(),
    decorations: z.boolean().optional().optional(),
    devtools: z.boolean().optional(),
    focused: z.boolean().optional(),
    fullscreen: z.boolean().optional(),
    incognito: z.boolean().optional(),
    title: z.string(),
    transparent: z.boolean().optional(),
  }),
  z.union([
    z.object({
      url: z.string(),
    }),
    z.object({
      html: z.string(),
    }),
  ]),
);

export type WebViewOptions = z.infer<typeof WebViewOptions>;

export const WebViewEvent = z.discriminatedUnion("$type", [
  z.object({ $type: z.literal("unknown"), data: z.string() }),
  z.object({ $type: z.literal("started"), data: z.undefined().optional() }),
  z.object({ $type: z.literal("closed"), data: z.undefined().optional() }),
  z.object({ $type: z.literal("getTitle"), data: z.string() }),
  z.object({
    $type: z.literal("setTitleDone"),
    data: z.undefined().optional(),
  }),
  z.object({
    $type: z.literal("openDevToolsDone"),
    data: z.undefined().optional(),
  }),
  z.object({ $type: z.literal("evalDone"), data: z.string().nullable() }),
]);

export type WebViewEvent = z.infer<typeof WebViewEvent>;
