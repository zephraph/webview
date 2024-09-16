# @justbe/webview

This package is a webview binding for Deno using [Wry](https://github.com/tauri-apps/wry) to interface with the webview and [Tao](https://github.com/tauri-apps/tao) to handle window management.

When Wry initializes on OSX it takes over the main thread of the process it's running in. To ensure creating the webview doesn't lock up the Deno process the webview will be created in a separate process.
