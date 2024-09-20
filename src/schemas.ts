// DO NOT EDIT: This file is auto-generated by scripts/generate-zod.ts
import { z } from "npm:zod";

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

export const WebViewRequest = z.discriminatedUnion("$type", [
  z.object({ $type: z.literal("eval"), id: z.string(), js: z.string() }),
  z.object({ $type: z.literal("setTitle"), id: z.string(), title: z.string() }),
  z.object({ $type: z.literal("getTitle"), id: z.string() }),
  z.object({ $type: z.literal("openDevTools"), id: z.string() }),
]);

export type WebViewRequest = z.infer<typeof WebViewRequest>;

export const WebViewMessage = z.union([
  z.discriminatedUnion("$type", [
    z.object({ $type: z.literal("started") }),
    z.object({ $type: z.literal("closed") }),
  ]),
  z.discriminatedUnion("$type", [
    z.object({
      $type: z.literal("ack"),
      data: z.object({
        id: z.string(),
      }),
    }),
    z.object({
      $type: z.literal("result"),
      data: z.object({
        id: z.string(),
        result: z.union([
          z.object({
            string: z.string(),
          }),
          z.object({
            jSON: z.string(),
          }),
        ]),
      }),
    }),
    z.object({
      $type: z.literal("err"),
      data: z.object({
        id: z.string(),
        message: z.string(),
      }),
    }),
    z.object({
      $type: z.literal("unsupported"),
      data: z.object({
        id: z.string(),
        message: z.string(),
      }),
    }),
  ]),
]);

export type WebViewMessage = z.infer<typeof WebViewMessage>;
