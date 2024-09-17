import { WebView } from "../src/lib.ts";

const webview = new WebView({
  title: "Simple",
  url: "https://example.com",
});

webview.on("started", () => {
  webview.eval("window.location.href = 'https://google.com'");
});

await webview.waitUntilClosed();
