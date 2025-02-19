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
    ContentUrl,
    Notification,
)


async def main():
    print("Creating webview")
    config = Options(
        title="Load Url Example",
        load=ContentUrl(
            url="https://example.com",
            headers={
                "Content-Type": "text/html",
            },
        ),
        userAgent="curl/7.81.0",
        devtools=True,
    )

    async with WebView(config) as webview:

        async def handle_start(event: Notification):
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
