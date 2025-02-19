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

from justbe_webview import WebView, Options, ContentHtml, IpcNotification, Size


async def main():
    print("Creating webview")
    config = Options(
        title="Window Size",
        load=ContentHtml(
            html="""
            <h1>Window Sizes</h1>
            <div style="display: flex; gap: 10px;">
                <button onclick="window.ipc.postMessage('maximize')">Maximize</button>
                <button onclick="window.ipc.postMessage('minimize')">Minimize</button>
                <button onclick="window.ipc.postMessage('fullscreen')">Fullscreen</button>
            </div>
            """
        ),
        size=Size(width=800, height=200),
        ipc=True,
    )

    async with WebView(config) as webview:

        async def handle_ipc(event: IpcNotification):
            message = event.message
            if message == "maximize":
                await webview.maximize()
            elif message == "minimize":
                await webview.minimize()
            elif message == "fullscreen":
                await webview.fullscreen()
            else:
                print(f"Unknown message: {message}")

        webview.on("ipc", handle_ipc)

    print("Webview closed")


if __name__ == "__main__":
    asyncio.run(main())
