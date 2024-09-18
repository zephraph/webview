import { WebView } from "../src/lib.ts";

const webview = new WebView({
  title: "Simple",
  html: "<h1>Hello, World!</h1>",
});

webview.on("started", async () => {
  await webview.setTitle("Title set from Deno");
  await webview.getTitle();
  await webview.openDevTools();
  await webview.eval("console.log('This is printed from eval!')");
});

await webview.waitUntilClosed();
