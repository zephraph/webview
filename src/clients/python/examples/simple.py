import sys
import asyncio
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))
from main import create_webview


async def main():
    webview = await create_webview(
        title="Simple", html="<h1>Hello, World!</h1>", devtools=True
    )

    @webview.on("started")
    async def on_started():
        await webview.set_title("Title set from Python")
        await webview.get_title()
        await webview.open_dev_tools()
        await webview.eval("console.log('This is printed from eval!')")

    await webview.wait_until_closed()


asyncio.run(main())
