# justbe-webview

A light, cross-platform library for building web-based desktop apps with Python.

## Installation

You can install justbe-webview using either `uv` (recommended) or `pip`:

```bash
# Using uv (recommended)
uv pip install justbe-webview

# Using pip
pip install justbe-webview
```

## Example

```python
import asyncio
from justbe_webview import (
    WebView,
    Options,
    ContentHtml,
    Notification,
)

async def main():
    config = Options(
        title="Simple",
        load=ContentHtml(html="<h1>Hello, World!</h1>"),
    )

    async with WebView(config) as webview:
        async def handle_start(event: Notification):
            await webview.eval("console.log('This is printed from eval!')")

        webview.on("started", handle_start)

if __name__ == "__main__":
    asyncio.run(main())
```

You can find more examples in the [examples directory](examples/), including:
- Loading URLs
- Loading HTML content
- Window size management
- IPC (Inter-Process Communication)

### Binary Management

On first run, the client will:
1. Check for a cached binary in the user's cache directory
2. If not found, download the appropriate binary for the current platform
3. Cache the binary for future use

The exact cache location depends on your operating system:
- Linux: `~/.cache/justbe-webview/`
- macOS: `~/Library/Caches/justbe-webview/`
- Windows: `%LOCALAPPDATA%\justbe-webview\Cache\`

### Using a Custom Binary

You can specify a custom binary path using the `WEBVIEW_BIN` environment variable:

```bash
export WEBVIEW_BIN=/path/to/webview/binary
python your_app.py
```

When set, this will bypass the default binary resolution process.
