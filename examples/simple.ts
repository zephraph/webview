import { createWebView } from "../src/lib.ts";

using webview = await createWebView({
  title: "Simple",
  html: "<h1>Hello, World!</h1>",
  devtools: true,
  initializationScript:
    "console.log('This is printed from initializationScript!')",
});

webview.on("started", async () => {
  await webview.setTitle("Title set from Deno");
  await webview.getTitle();
  await webview.openDevTools();
  await webview.eval("console.log('This is printed from eval!')");
});

await webview.waitUntilClosed();
