import { createWebView } from "../src/lib.ts";
import * as esbuild from "https://deno.land/x/esbuild@v0.24.0/wasm.js";

const tldrawApp = `
import { Tldraw } from "tldraw";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <>
      <div style={{ position: "absolute", inset: 0 }}>
        <Tldraw cameraOptions={{ wheelBehavior: "zoom" }} />
      </div>
    </>
  );
}

createRoot(document.querySelector("main")).render(<App />);
`;

const app = await esbuild.transform(tldrawApp, {
  loader: "jsx",
  jsx: "automatic",
  target: "esnext",
  format: "esm",
  minify: false,
  sourcemap: false,
});

using webview = await createWebView({
  title: "TLDraw",
  html: `
    <!DOCTYPE html>
    <html lang="en">
      <head>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700&display=swap"/>
        <link rel="stylesheet" href="https://esm.sh/tldraw@2.3.0/tldraw.css"/>
        <style> body { font-family: "Inter"; } </style>
      </head>
      <body>
        <main></main>
        <script type="importmap">
          {
            "imports": {
              "tldraw": "https://esm.sh/tldraw@2.3.0?bundle-deps",
              "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime?bundle-deps",
              "react-dom/client": "https://esm.sh/react-dom@18.3.1/client?bundle-deps"
            }
          }
        </script>
        <script type="module">
          ${app.code}
        </script>
      </body>
    </html>
  `,
});

await webview.waitUntilClosed();
