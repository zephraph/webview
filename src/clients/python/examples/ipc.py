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

from justbe_webview import WebView, Options, ContentHtml, IpcNotification


async def main():
    print("Creating webview")
    config = Options(
        title="Simple",
        load=ContentHtml(
            html='<button onclick="window.ipc.postMessage(`button clicked ${Date.now()}`)">Click me</button>'
        ),
        ipc=True,
    )

    async with WebView(config) as webview:

        async def handle_ipc(event: IpcNotification):
            print(event.message)

        webview.on("ipc", handle_ipc)

    print("Webview closed")


if __name__ == "__main__":
    asyncio.run(main())
