import { WebView } from "../src/lib.ts";

const webview = new WebView({
  title: "Simple",
  url: "data:text/html,%3Ch1%3EHello%2C%20World%21%3C%2Fh1%3E",
});

webview.on("started", async () => {
  await webview.setTitle("Hello World");
  await webview.getTitle();
});

await webview.waitUntilClosed();
