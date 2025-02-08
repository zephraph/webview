import asyncio

from webview_python import WebView, WebViewOptions, WebViewContentHtml
from webview_python.schemas.WebViewMessage import IpcNotification


async def main():
    print("Creating webview")
    config = WebViewOptions(
        title="Simple",
        load=WebViewContentHtml(
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
