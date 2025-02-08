import asyncio

from webview_python import WebView, WebViewOptions, WebViewContentHtml, IpcNotification


async def main():
    print("Creating webview")
    config = WebViewOptions(
        title="Window Size",
        load=WebViewContentHtml(
            html="""
            <h1>Window Sizes</h1>
            <div style="display: flex; gap: 10px;">
                <button onclick="window.ipc.postMessage('maximize')">Maximize</button>
                <button onclick="window.ipc.postMessage('minimize')">Minimize</button>
                <button onclick="window.ipc.postMessage('fullscreen')">Fullscreen</button>
            </div>
            """
        ),
        size={"width": 800, "height": 200},
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

