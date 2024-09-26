import { createWebView } from "../src/lib.ts";

using webview = await createWebView({
  title: "Load Html Example",
  html: "<h1>Initial html</h1>",
});

webview.on("started", async () => {
  await webview.loadHtml("<h1>Updated html!</h1>");
});

await webview.waitUntilClosed();
