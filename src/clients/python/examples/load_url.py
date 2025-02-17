# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "webview-python",
# ]
#
# [tool.uv.sources]
# webview-python = { path = "../" }
# ///
import sys
import asyncio
import time
from pathlib import Path

from webview_python import (
    WebView,
    WebViewOptions,
    WebViewContentUrl,
    WebViewNotification,
)


async def main():
    print("Creating webview")
    config = WebViewOptions(
        title="Load Url Example",
        load=WebViewContentUrl(
            url="https://example.com",
            headers={
                "Content-Type": "text/html",
            },
        ),
        userAgent="curl/7.81.0",
        devtools=True,
    )

    async with WebView(config) as webview:

        async def handle_start(event: WebViewNotification):
            await webview.open_devtools()
            await asyncio.sleep(2)  # Sleep for 2 seconds
            await webview.load_url(
                "https://val.town/",
                headers={
                    "Content-Type": "text/html",
                },
            )

        webview.on("started", handle_start)

    print("Webview closed")


if __name__ == "__main__":
    asyncio.run(main())

