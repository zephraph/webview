import { createWebView } from "../src/lib.ts";

using webview = await createWebView({
  title: "Window Size",
  html: "<h1>Window Size</h1>",
  size: {
    height: 200,
    width: 800,
  },
});

await webview.waitUntilClosed();
