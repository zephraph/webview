import sys
import asyncio
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))
from main import WebView, WebViewOptions, WebViewContentHtml
from schemas.WebViewMessage import IpcNotification


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
