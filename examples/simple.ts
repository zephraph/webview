import { WebView } from "../src/lib.ts";

const webview = new WebView({
  title: "Simple",
  url: "https://example.com",
});

webview.on("started", async () => {
  webview.eval("window.location.href = 'https://google.com'");
  console.log("devtools open 1?", await webview.isDevToolsOpen());
  webview.openDevTools();
  console.log("devtools open 2?", await webview.isDevToolsOpen());
  webview.closeDevTools();
  console.log("devtools open 3?", await webview.isDevToolsOpen());
});

await webview.waitUntilClosed();
