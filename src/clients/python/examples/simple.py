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
        title="Simple",
        load=ContentHtml(html="<h1>Hello, World!</h1>"),
        devtools=True,
        initializationScript="console.log('This is printed from initializationScript!')",
    )

    async with WebView(config) as webview:

        async def handle_start(event: Notification):
            print("handle_start called")
            await webview.set_title("Title set from Python")
            current_title = await webview.get_title()
            print(f"Current title: {current_title}")
            await webview.open_devtools()
            await webview.eval("console.log('This is printed from eval!')")

        webview.on("started", handle_start)

    print("Webview closed")


if __name__ == "__main__":
    asyncio.run(main())
