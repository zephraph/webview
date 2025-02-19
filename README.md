# @justbe/webview

A light, cross-platform library for building web-based desktop apps. The project consists of a Rust backend that provides the core webview functionality, with multiple client libraries available for different languages and runtimes.

## Available Clients

- [Deno Client](src/clients/deno/README.md) - Build desktop apps using Deno and TypeScript
- [Python Client](src/clients/python/README.md) - Build desktop apps using Python

## Architecture

This project is structured into two main components:

1. A Rust backend that provides the core webview functionality, compiled into a native binary for each platform
2. Client libraries that interface with the binary, available for multiple languages

Each client library handles binary management, communication with the webview process over stdio (standard input/output), and provides a idiomatic API for its respective language/runtime.

## Binary Management

When using any of the clients, they will check for the required binary for interfacing with the OS's webview. If it doesn't exist, it downloads it to a cache directory and executes it. The specific behavior and permissions required may vary by client - please see the respective client's documentation for details.

### Using a Custom Binary

All clients support using a custom binary via the `WEBVIEW_BIN` environment variable. If present and allowed, this will override the default binary resolution process in favor of the path specified.

## Examples

<details>
<summary>Deno Example</summary>

```typescript
import { createWebView } from "jsr:@justbe/webview";

using webview = await createWebView({
  title: "Example",
  html: "<h1>Hello, World!</h1>",
  devtools: true
});

webview.on("started", async () => {
  await webview.openDevTools();
  await webview.eval("console.log('This is printed from eval!')");
});

await webview.waitUntilClosed();
```

</details>

<details>
<summary>Python Example</summary>

```python
import asyncio
from justbe_webview import WebView, WebViewOptions, WebViewContentHtml, WebViewNotification

async def main():
    config = WebViewOptions(
        title="Example",
        load=WebViewContentHtml(html="<h1>Hello, World!</h1>"),
        devtools=True
    )

    async with WebView(config) as webview:
        async def handle_start(event: WebViewNotification):
            await webview.open_devtools()
            await webview.eval("console.log('This is printed from eval!')")

        webview.on("started", handle_start)

if __name__ == "__main__":
    asyncio.run(main())
```

</details>

## Contributing

This project uses [mise](https://mise.jdx.dev/) to manage runtimes (like deno, python, rust) and run scripts. If you'd like to contribute, you'll need to install it. 

Use the `mise tasks` command to see what you can do. 