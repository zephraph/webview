import { createWebView } from "../src/lib.ts";

using webview = await createWebView({
  title: "Load Url Example",
  url: "https://example.com",
  headers: {
    "Content-Type": "text/html",
  },
  devtools: true,
});

webview.on("started", async () => {
  await webview.openDevTools();
  await sleep(2000);
  await webview.loadUrl("https://val.town/", {
    "Content-Type": "text/html",
  });
});

await webview.waitUntilClosed();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
