# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "webview-python",
# ]
#
# [tool.uv.sources]
# webview-python = { path = "../" }
# ///
import asyncio

from webview_python import (
    WebView,
    WebViewOptions,
    WebViewContentHtml,
    WebViewNotification,
)


async def main():
    print("Creating webview")
    config = WebViewOptions(
        title="Simple",
        load=WebViewContentHtml(html="<h1>Hello, World!</h1>"),
        devtools=True,
        initializationScript="console.log('This is printed from initializationScript!')",
    )

    async with WebView(config) as webview:

        async def handle_start(event: WebViewNotification):
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
