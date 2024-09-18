import { WebView } from "../src/lib.ts";

const webview = new WebView({
  title: "Simple",
  url: "data:text/html,%3Ch1%3EHello%2C%20World%21%3C%2Fh1%3E",
});

webview.on("started", async () => {
  await webview.setTitle("Title set from Deno");
  await webview.getTitle();
  await webview.openDevTools();
  await webview.eval("console.log('This is printed from eval!')");
});

await webview.waitUntilClosed();
