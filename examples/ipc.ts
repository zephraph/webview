import { createWebView } from "../src/lib.ts";

using webview = await createWebView({
  title: "Simple",
  html:
    '<button onclick="window.ipc.postMessage(`button clicked ${Date.now()}`)">Click me</button>',
  ipc: true,
});

// @ts-expect-error event emitter types still need to be corrected
webview.on("ipc", ({ message }) => {
  console.log(message);
});

await webview.waitUntilClosed();