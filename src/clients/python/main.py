import asyncio
import json
import os
import platform
import subprocess
from typing import Any, Callable, Literal, TypedDict, Union
from enum import Enum
from dataclasses import dataclass
from pathlib import Path
import aiofiles
import httpx
from pyee.asyncio import AsyncIOEventEmitter

# Constants
BIN_VERSION = "0.1.14"


class WebViewOptions(TypedDict, total=False):
    title: str
    url: str
    html: str
    width: int
    height: int
    resizable: bool
    transparent: bool
    devtools: bool
    ipc: bool


class WebViewNotificationType(Enum):
    STARTED = "started"
    CLOSED = "closed"
    IPC = "ipc"


@dataclass
class WebViewNotification:
    type: WebViewNotificationType
    data: Any


class WebViewResponse:
    class ResultType(Enum):
        STRING = "string"
        BOOLEAN = "boolean"
        SIZE = "size"

    def __init__(self, type: str, id: str, data: Any):
        self.type = type
        self.id = id
        self.data = data


def return_result(
    result: WebViewResponse, expected_type: WebViewResponse.ResultType
) -> Any:
    if result.type == "result":
        if result.data["$type"] == expected_type.value:
            return result.data["value"]
        raise ValueError(f"Unexpected result type: {result.data['$type']}")
    raise ValueError(f"Unexpected response: {result.type}")


def return_ack(result: WebViewResponse) -> None:
    if result.type == "ack":
        return
    if result.type == "err":
        raise ValueError(result.data["message"])
    raise ValueError(f"Unexpected response: {result.type}")


async def get_webview_bin(options: WebViewOptions) -> str:
    if "WEBVIEW_BIN" in os.environ:
        return os.environ["WEBVIEW_BIN"]

    flags = "-devtools" if options.get("devtools") else ""
    if not flags and options.get("transparent") and platform.system() == "Darwin":
        flags = "-transparent"

    cache_dir = get_cache_dir()
    file_name = f"deno-webview-{BIN_VERSION}{flags}"
    if platform.system() == "Windows":
        file_name += ".exe"
    file_path = cache_dir / file_name

    if file_path.exists():
        return str(file_path)

    url = f"https://github.com/zephraph/webview/releases/download/webview-v{BIN_VERSION}/deno-webview"
    if platform.system() == "Darwin":
        url += "-mac"
        if platform.machine() == "arm64":
            url += "-arm64"
    elif platform.system() == "Linux":
        url += "-linux"
    elif platform.system() == "Windows":
        url += "-windows.exe"
    else:
        raise ValueError("Unsupported OS")

    url += flags

    async with httpx.AsyncClient() as client:
        response = await client.get(url, follow_redirects=True)
        response.raise_for_status()

    cache_dir.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(response.content)

    os.chmod(file_path, 0o755)
    return str(file_path)


def get_cache_dir() -> Path:
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Caches" / "python-webview"
    elif platform.system() == "Linux":
        return Path.home() / ".cache" / "python-webview"
    elif platform.system() == "Windows":
        return Path(os.environ["LOCALAPPDATA"]) / "python-webview" / "Cache"
    else:
        raise ValueError("Unsupported OS")


class WebView:
    def __init__(self, options: WebViewOptions, webview_binary_path: str):
        self.options = options
        self.process = subprocess.Popen(
            [webview_binary_path, json.dumps(options)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self.internal_event = AsyncIOEventEmitter()
        self.external_event = AsyncIOEventEmitter()
        self.buffer = ""

    async def send(self, request: dict) -> WebViewResponse:
        request_id = "unique_id"  # Replace with actual ULID implementation
        future = asyncio.Future()
        self.internal_event.once(request_id, lambda event: future.set_result(event))

        self.process.stdin.write(json.dumps({**request, "id": request_id}) + "\0")
        self.process.stdin.flush()

        result = await future
        return WebViewResponse(**json.loads(result))

    async def recv(self) -> Union[WebViewNotification, None]:
        while True:
            chunk = await asyncio.to_thread(self.process.stdout.read, 1)
            if not chunk:
                return None
            self.buffer += chunk
            if "\0" in self.buffer:
                message, self.buffer = self.buffer.split("\0", 1)
                try:
                    data = json.loads(message)
                    if data["$type"] == "notification":
                        return WebViewNotification(
                            type=WebViewNotificationType(data["data"]["$type"]),
                            data=data["data"],
                        )
                    elif data["$type"] == "response":
                        self.internal_event.emit(data["id"], json.dumps(data["data"]))
                except json.JSONDecodeError:
                    print(f"Error parsing message: {message}")

    async def process_message_loop(self):
        while True:
            notification = await self.recv()
            if not notification:
                return

            if notification.type == WebViewNotificationType.STARTED:
                version = notification.data["version"]
                if version != BIN_VERSION:
                    print(
                        f"Warning: Expected webview version {BIN_VERSION} but got {version}"
                    )

            self.external_event.emit(notification.type.value, notification.data)

            if notification.type == WebViewNotificationType.CLOSED:
                return

    async def wait_until_closed(self):
        await self.process_message_loop()

    def on(self, event: str):
        if event == "ipc" and not self.options.get("ipc"):
            raise ValueError("IPC is not enabled for this webview")

        def decorator(callback: Callable):
            self.external_event.on(event, callback)
            return callback

        return decorator

    def once(self, event: str):
        if event == "ipc" and not self.options.get("ipc"):
            raise ValueError("IPC is not enabled for this webview")

        def decorator(callback: Callable):
            self.external_event.once(event, callback)
            return callback

        return decorator

    async def get_version(self) -> str:
        result = await self.send({"$type": "getVersion"})
        return return_result(result, WebViewResponse.ResultType.STRING)

    async def set_size(self, size: dict[Literal["width", "height"], int]):
        result = await self.send({"$type": "setSize", "size": size})
        return_ack(result)

    async def get_size(
        self, include_decorations: bool = False
    ) -> dict[Literal["width", "height", "scaleFactor"], Union[int, float]]:
        result = await self.send(
            {"$type": "getSize", "include_decorations": include_decorations}
        )
        size_data = return_result(result, WebViewResponse.ResultType.SIZE)
        return {
            "width": size_data["width"],
            "height": size_data["height"],
            "scaleFactor": size_data["scale_factor"],
        }

    async def fullscreen(self, fullscreen: bool | None = None):
        result = await self.send({"$type": "fullscreen", "fullscreen": fullscreen})
        return_ack(result)

    async def maximize(self, maximized: bool | None = None):
        result = await self.send({"$type": "maximize", "maximized": maximized})
        return_ack(result)

    async def minimize(self, minimized: bool | None = None):
        result = await self.send({"$type": "minimize", "minimized": minimized})
        return_ack(result)

    async def set_title(self, title: str):
        result = await self.send({"$type": "setTitle", "title": title})
        return_ack(result)

    async def get_title(self) -> str:
        result = await self.send({"$type": "getTitle"})
        return return_result(result, WebViewResponse.ResultType.STRING)

    async def set_visibility(self, visible: bool):
        result = await self.send({"$type": "setVisibility", "visible": visible})
        return_ack(result)

    async def is_visible(self) -> bool:
        result = await self.send({"$type": "isVisible"})
        return return_result(result, WebViewResponse.ResultType.BOOLEAN)

    async def eval(self, code: str):
        result = await self.send({"$type": "eval", "js": code})
        return_ack(result)

    async def open_dev_tools(self):
        result = await self.send({"$type": "openDevTools"})
        return_ack(result)

    async def load_html(self, html: str):
        result = await self.send({"$type": "loadHtml", "html": html})
        return_ack(result)

    async def load_url(self, url: str, headers: dict[str, str] | None = None):
        result = await self.send({"$type": "loadUrl", "url": url, "headers": headers})
        return_ack(result)

    def destroy(self):
        self.process.terminate()
        self.process.wait()


async def create_webview(
    *,
    title: str = None,
    url: str = None,
    html: str = None,
    width: int = None,
    height: int = None,
    resizable: bool = None,
    transparent: bool = None,
    devtools: bool = None,
    ipc: bool = None,
) -> WebView:
    options = {
        k: v
        for k, v in {
            "title": title,
            "url": url,
            "html": html,
            "width": width,
            "height": height,
            "resizable": resizable,
            "transparent": transparent,
            "devtools": devtools,
            "ipc": ipc,
        }.items()
        if v is not None
    }
    bin_path = await get_webview_bin(options)
    return WebView(options, bin_path)


async def main():
    options: WebViewOptions = {
        "title": "Example",
        "html": "<h1>Hello, World!</h1>",
        "devtools": True,
    }

    webview = await create_webview(options)

    @webview.on("started")
    async def on_started():
        await webview.open_dev_tools()
        await webview.eval("console.log('This is printed from eval!')")

    await webview.wait_until_closed()


if __name__ == "__main__":
    asyncio.run(main())
