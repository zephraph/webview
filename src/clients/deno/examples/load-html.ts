import { createWebView } from "../main.ts";

using webview = await createWebView({
  title: "Load Html Example",
  html: "<h1>Initial html</h1>",
  // Note: This origin is used with a custom protocol so it doesn't match
  // https://example.com. This doesn't need to be set, but can be useful if
  // you want to control resources that are scoped to a specific origin like
  // local storage or indexeddb.
  origin: "example.com",
  devtools: true,
});

webview.on("started", async () => {
  await webview.openDevTools();
  await webview.loadHtml("<h1>Updated html!</h1>");
});

await webview.waitUntilClosed();
