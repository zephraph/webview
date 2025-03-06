import asyncio
import os
import platform
import subprocess
from typing import Any, Callable, Literal, Union, cast, TypeVar
from pathlib import Path
import aiofiles
import httpx
from pyee.asyncio import AsyncIOEventEmitter
import msgspec
import sys

from .schemas import *

# Import schemas
from .schemas import (
    NotificationMessage,
    ResponseMessage,
    StartedNotification,
    ClosedNotification,
    StringResultType,
    BooleanResultType,
    SizeResultType,
    ResultType,
    AckResponse,
    ResultResponse,
    ErrResponse,
    Response as WebViewResponse,
    Notification as WebViewNotification,
    Message as WebViewMessage,
    Request as WebViewRequest,
    Options as WebViewOptions,
    GetVersionRequest,
    EvalRequest,
    SetTitleRequest,
    GetTitleRequest,
    SetVisibilityRequest,
    IsVisibleRequest,
    OpenDevToolsRequest,
    GetSizeRequest,
    SetSizeRequest,
    FullscreenRequest,
    MaximizeRequest,
    MinimizeRequest,
    LoadHtmlRequest,
    LoadUrlRequest,
    Size,
)

# Constants
BIN_VERSION = "0.3.1"

T = TypeVar("T", bound=WebViewNotification)


def return_result(
    result: Union[AckResponse, ResultResponse, ErrResponse],
    expected_type: type[ResultType],
) -> Any:
    print(f"Return result: {result}")
    if isinstance(result, ResultResponse) and isinstance(result.result, expected_type):
        return result.result.value
    raise ValueError(f"Expected {expected_type.__name__} result got: {result}")


def return_ack(result: Union[AckResponse, ResultResponse, ErrResponse]) -> None:
    print(f"Return ack: {result}")
    if isinstance(result, AckResponse):
        return
    if isinstance(result, ErrResponse):
        raise ValueError(result.message)
    raise ValueError(f"Unexpected response type: {type(result).__name__}")


async def get_webview_bin(options: WebViewOptions) -> str:
    if "WEBVIEW_BIN" in os.environ:
        return os.environ["WEBVIEW_BIN"]

    flags = "-devtools" if cast(bool, getattr(options, "devtools", False)) else ""
    if (
        not flags
        and cast(bool, getattr(options, "transparent", False))
        and platform.system() == "Darwin"
    ):
        flags = "-transparent"

    cache_dir = get_cache_dir()
    file_name = f"webview-{BIN_VERSION}{flags}"
    if platform.system() == "Windows":
        file_name += ".exe"
    file_path = cache_dir / file_name

    if file_path.exists():
        return str(file_path)

    url = f"https://github.com/zephraph/webview/releases/download/webview-v{BIN_VERSION}/webview"
    if platform.system() == "Darwin":
        url += "-mac"
        if platform.machine() == "arm64":
            url += "-arm64"
    elif platform.system() == "Linux":
        url += "-linux"
    elif platform.system() == "Windows":
        url += "-windows"
    else:
        raise ValueError("Unsupported OS")

    url += flags

    if platform.system() == "Windows":
        url += ".exe"

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

    if platform.system() == "Linux":
        return Path.home() / ".cache" / "python-webview"

    if platform.system() == "Windows":
        return Path(os.environ["LOCALAPPDATA"]) / "python-webview" / "Cache"

    raise ValueError("Unsupported OS")


class WebView:
    process: subprocess.Popen[bytes] | None = None
    __message_id = 0

    def __init__(self, options: WebViewOptions, webview_binary_path: str | None = None):
        self.options = options
        if webview_binary_path is not None:
            self.__start_process(webview_binary_path)
        self.internal_event = AsyncIOEventEmitter()
        self.external_event = AsyncIOEventEmitter()
        self.buffer = b""

    @property
    def message_id(self) -> int:
        current_id = self.__message_id
        self.__message_id += 1
        return current_id

    def __start_process(self, webview_binary_path: str):
        encoded_options = str(msgspec.json.encode(self.options), "utf-8")
        self.process = subprocess.Popen(
            [webview_binary_path, encoded_options],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,  # Capture stderr properly
            text=False,
            bufsize=0,
            env=os.environ,
        )
        assert self.process.stdin is not None
        assert self.process.stdout is not None
        assert self.process.stderr is not None

        # Create StreamReader for non-blocking reads
        loop = asyncio.get_event_loop()
        self.stdout_reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(self.stdout_reader)
        loop.create_task(loop.connect_read_pipe(lambda: protocol, self.process.stdout))

        # Also handle stderr
        self.stderr_reader = asyncio.StreamReader()
        stderr_protocol = asyncio.StreamReaderProtocol(self.stderr_reader)
        loop.create_task(
            loop.connect_read_pipe(lambda: stderr_protocol, self.process.stderr)
        )
        loop.create_task(self._pipe_stderr())

    async def _pipe_stderr(self):
        """Pipe stderr from the subprocess to Python's stderr"""
        while True:
            try:
                line = await self.stderr_reader.readline()
                if not line:
                    break
                sys.stderr.buffer.write(line)
                sys.stderr.buffer.flush()
            except Exception:
                break

    async def __aenter__(self):
        bin_path = await get_webview_bin(self.options)
        if self.process is None:
            self.__start_process(bin_path)
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any | None,
    ) -> None:
        await self.wait_until_closed()
        self.destroy()

    async def send(self, request: WebViewRequest) -> WebViewResponse:
        if self.process is None:
            raise RuntimeError("Webview process not started")
        future: asyncio.Future[Union[AckResponse, ResultResponse, ErrResponse]] = (
            asyncio.Future()
        )

        def set_result(event: Union[AckResponse, ResultResponse, ErrResponse]) -> None:
            future.set_result(event)

        self.internal_event.once(str(request.id), set_result)  # type: ignore

        assert self.process.stdin is not None
        encoded = msgspec.json.encode(request)
        self.process.stdin.write(encoded + b"\n")
        self.process.stdin.flush()

        result = await future
        return result

    async def recv(self) -> Union[WebViewNotification, None]:
        if self.process is None:
            raise RuntimeError("Webview process not started")

        print("Receiving messages from webview process...", flush=True)

        while True:
            try:
                # Non-blocking read using StreamReader
                chunk = await self.stdout_reader.read(8192)
                print(
                    f"Read chunk size: {len(chunk) if chunk else 0} bytes", flush=True
                )
                if not chunk:
                    print(
                        "Received empty chunk, process may have closed stdout",
                        flush=True,
                    )
                    return None

                self.buffer += chunk
                while b"\n" in self.buffer:
                    message, self.buffer = self.buffer.split(b"\n", 1)
                    print(f"Received raw message: {message}", flush=True)
                    try:
                        msg = msgspec.json.decode(message, type=WebViewMessage)
                        print(f"Decoded message: {msg}", flush=True)
                        if isinstance(msg, NotificationMessage):
                            return msg.data
                        elif isinstance(msg, ResponseMessage):
                            self.internal_event.emit(str(msg.data.id), msg.data)
                    except msgspec.DecodeError as e:
                        print(f"Error parsing message: {message}", flush=True)
                        print(f"Parse error details: {str(e)}", flush=True)
            except Exception as e:
                print(f"Error reading from stdout: {str(e)}", flush=True)
                return None

    async def process_message_loop(self):
        print("Processing message loop", flush=True)
        while True:
            notification = await self.recv()
            print(f"Received notification: {notification}", flush=True)
            if not notification:
                return

            if isinstance(notification, StartedNotification):
                version = notification.version
                if version != BIN_VERSION:
                    print(
                        f"Warning: Expected webview version {BIN_VERSION} but got {version}",
                        flush=True,
                    )

            tag = notification.__struct_config__.tag
            assert isinstance(tag, str)
            self.external_event.emit(tag, notification)

            if isinstance(notification, ClosedNotification):
                return

    async def wait_until_closed(self):
        await self.process_message_loop()

    def on(
        self,
        event: str,
        callback: Callable[[T], Any],
    ) -> None:
        if event == "ipc" and not getattr(self.options, "ipc", False):
            raise ValueError("IPC is not enabled for this webview")

        self.external_event.on(event, callback)

    def once(self, event: str, callback: Callable[[WebViewNotification], Any]):
        if event == "ipc" and not getattr(self.options, "ipc", False):
            raise ValueError("IPC is not enabled for this webview")

        self.external_event.once(event, callback)  # type: ignore

    async def get_version(self) -> str:
        result = await self.send(GetVersionRequest(id=self.message_id))
        return return_result(result, StringResultType)

    async def set_size(self, size: dict[Literal["width", "height"], float]):
        result = await self.send(SetSizeRequest(id=self.message_id, size=Size(**size)))
        return_ack(result)

    async def get_size(
        self, include_decorations: bool = False
    ) -> dict[Literal["width", "height", "scaleFactor"], Union[int, float]]:
        result = await self.send(
            GetSizeRequest(id=self.message_id, include_decorations=include_decorations)
        )
        size_data = return_result(result, SizeResultType)
        return {
            "width": size_data.width,
            "height": size_data.height,
            "scaleFactor": size_data.scale_factor,
        }

    async def fullscreen(self, fullscreen: bool | None = None):
        result = await self.send(
            FullscreenRequest(id=self.message_id, fullscreen=fullscreen)
        )
        return_ack(result)

    async def maximize(self, maximized: bool | None = None):
        result = await self.send(
            MaximizeRequest(id=self.message_id, maximized=maximized)
        )
        return_ack(result)

    async def minimize(self, minimized: bool | None = None):
        result = await self.send(
            MinimizeRequest(id=self.message_id, minimized=minimized)
        )
        return_ack(result)

    async def set_title(self, title: str):
        result = await self.send(SetTitleRequest(id=self.message_id, title=title))
        return_ack(result)

    async def get_title(self) -> str:
        result = await self.send(GetTitleRequest(id=self.message_id))
        return return_result(result, StringResultType)

    async def set_visibility(self, visible: bool):
        result = await self.send(
            SetVisibilityRequest(id=self.message_id, visible=visible)
        )
        return_ack(result)

    async def is_visible(self) -> bool:
        result = await self.send(IsVisibleRequest(id=self.message_id))
        return return_result(result, BooleanResultType)

    async def eval(self, code: str):
        result = await self.send(EvalRequest(id=self.message_id, js=code))
        return_ack(result)

    async def open_devtools(self):
        result = await self.send(OpenDevToolsRequest(id=self.message_id))
        return_ack(result)

    async def load_html(self, html: str):
        result = await self.send(LoadHtmlRequest(id=self.message_id, html=html))
        return_ack(result)

    async def load_url(self, url: str, headers: dict[str, str] | None = None):
        result = await self.send(
            LoadUrlRequest(id=self.message_id, url=url, headers=headers)
        )
        return_ack(result)

    def destroy(self):
        if self.process is None:
            raise RuntimeError("Webview process not started")
        self.process.terminate()
        self.process.wait()


async def create_webview(
    options: WebViewOptions,
) -> WebView:
    bin_path = await get_webview_bin(options)
    print(f"Created webview with bin path: {bin_path}")
    return WebView(options, bin_path)
