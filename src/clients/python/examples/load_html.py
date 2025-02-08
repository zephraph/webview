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
from pathlib import Path

from webview_python import (
    WebView,
    WebViewOptions,
    WebViewContentHtml,
    WebViewNotification,
)


async def main():
    print("Creating webview")
    config = WebViewOptions(
        title="Load Html Example",
        load=WebViewContentHtml(
            html="<h1>Initial html</h1>",
            # Note: This origin is used with a custom protocol so it doesn't match
            # https://example.com. This doesn't need to be set, but can be useful if
            # you want to control resources that are scoped to a specific origin like
            # local storage or indexeddb.
            origin="example.com",
        ),
        devtools=True,
    )

    async with WebView(config) as webview:

        async def handle_start(event: WebViewNotification):
            await webview.open_devtools()
            await webview.load_html("<h1>Updated html!</h1>")

        webview.on("started", handle_start)

    print("Webview closed")


if __name__ == "__main__":
    asyncio.run(main())

