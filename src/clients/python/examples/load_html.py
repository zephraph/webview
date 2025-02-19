# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "justbe-webview",
# ]
#
# [tool.uv.sources]
# justbe-webview = { path = "../" }
# ///
import asyncio

from justbe_webview import (
    WebView,
    Options,
    ContentHtml,
    Notification,
)


async def main():
    print("Creating webview")
    config = Options(
        title="Load Html Example",
        load=ContentHtml(
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

        async def handle_start(event: Notification):
            await webview.open_devtools()
            await webview.load_html("<h1>Updated html!</h1>")

        webview.on("started", handle_start)

    print("Webview closed")


if __name__ == "__main__":
    asyncio.run(main())
