import { createWebView } from "../main.ts";

using webview = await createWebView({
  title: "Window Size",
  html: `
    <h1>Window Sizes</h1>
    <div style="display: flex; gap: 10px;">
      <button onclick="window.ipc.postMessage('maximize')">Maximize</button>
      <button onclick="window.ipc.postMessage('minimize')">Minimize</button>
      <button onclick="window.ipc.postMessage('fullscreen')">Fullscreen</button>
    </div>
  `,
  size: {
    height: 200,
    width: 800,
  },
  ipc: true,
});

webview.on("ipc", ({ message }) => {
  switch (message) {
    case "maximize":
      webview.maximize();
      break;
    case "minimize":
      webview.minimize();
      break;
    case "fullscreen":
      webview.fullscreen();
      break;
    default:
      console.error("Unknown message", message);
  }
});

await webview.waitUntilClosed();
