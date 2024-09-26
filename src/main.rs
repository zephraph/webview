use std::env;
use std::io::{self, BufRead, Write};
use std::sync::mpsc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json;
use tao::dpi::{LogicalSize, Size};
use tao::window::Fullscreen;

/// The version of the webview binary.
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct SimpleSize {
    width: f64,
    height: f64,
}

#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
enum WindowSizeStates {
    Maximized,
    Fullscreen,
}

#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(untagged)]
enum WindowSize {
    States(WindowSizeStates),
    Size { width: f64, height: f64 },
}

/// Options for creating a webview.
#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct WebViewOptions {
    /// Sets the title of the window.
    title: String,
    #[serde(flatten)]
    target: WebViewTarget,
    /// The size of the window.
    #[serde(default)]
    size: Option<WindowSize>,
    /// When true, the window will have a border, a title bar, etc. Default is true.
    #[serde(default = "default_true")]
    decorations: bool,
    /// Sets whether the window should be transparent.
    #[serde(default)]
    transparent: bool,
    /// When true, all media can be played without user interaction. Default is false.
    #[serde(default)]
    autoplay: bool,
    /// Enable or disable webview devtools.
    ///
    /// Note this only enables devtools to the webview. To open it, you can call `webview.open_devtools()`, or right click the page and open it from the context menu.
    #[serde(default)]
    devtools: bool,
    /// Run the WebView with incognito mode. Note that WebContext will be ingored if incognito is enabled.
    ///
    /// Platform-specific:
    /// - Windows: Requires WebView2 Runtime version 101.0.1210.39 or higher, does nothing on older versions, see https://learn.microsoft.com/en-us/microsoft-edge/webview2/release-notes/archive?tabs=dotnetcsharp#10121039
    #[serde(default)]
    incognito: bool,
    /// Enables clipboard access for the page rendered on Linux and Windows.
    ///
    /// macOS doesn’t provide such method and is always enabled by default. But your app will still need to add menu item accelerators to use the clipboard shortcuts.
    #[serde(default)]
    clipboard: bool,
    /// Sets whether the webview should be focused when created. Default is false.
    #[serde(default)]
    focused: bool,
    /// Sets whether clicking an inactive window also clicks through to the webview. Default is false.
    #[serde(default)]
    accept_first_mouse: bool,
    /// Sets whether host should be able to receive messages from the webview via `window.ipc.postMessage`.
    #[serde(default)]
    ipc: bool,
}

fn default_true() -> bool {
    true
}

#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
enum WebViewTarget {
    /// Url to load in the webview.
    Url(String),
    /// Html to load in the webview.
    Html(String),
}

// --- RPC Definitions ---

/// Complete definition of all outbound messages from the webview to the client.
#[derive(JsonSchema, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type", content = "data")]
enum Message {
    Notification(Notification),
    Response(Response),
}

/// Messages that are sent unbidden from the webview to the client.
#[derive(JsonSchema, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type")]
enum Notification {
    Started { version: String },
    Ipc { message: String },
    Closed,
}

/// Explicit requests from the client to the webview.
#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type")]
enum Request {
    GetVersion {
        id: String,
    },
    Eval {
        id: String,
        js: String,
    },
    SetTitle {
        id: String,
        title: String,
    },
    GetTitle {
        id: String,
    },
    SetVisibility {
        id: String,
        visible: bool,
    },
    IsVisible {
        id: String,
    },
    OpenDevTools {
        id: String,
    },
    GetSize {
        id: String,
        #[serde(default)]
        include_decorations: Option<bool>,
    },
    SetSize {
        id: String,
        size: SimpleSize,
    },
    Fullscreen {
        id: String,
        fullscreen: Option<bool>,
    },
    Maximize {
        id: String,
        maximized: Option<bool>,
    },
    Minimize {
        id: String,
        minimized: Option<bool>,
    },
}

/// Responses from the webview to the client.
#[derive(JsonSchema, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type")]
enum Response {
    Ack { id: String },
    Result { id: String, result: ResultType },
    Err { id: String, message: String },
}

/// Types that can be returned from webview results.
#[derive(JsonSchema, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type", content = "value")]
#[allow(dead_code)]
enum ResultType {
    String(String),
    Boolean(bool),
    Float(f64),
    Size {
        width: f64,
        height: f64,
        /// The ratio between physical and logical sizes.
        scale_factor: f64,
    },
}

impl From<String> for ResultType {
    fn from(value: String) -> Self {
        ResultType::String(value)
    }
}

impl From<bool> for ResultType {
    fn from(value: bool) -> Self {
        ResultType::Boolean(value)
    }
}

fn main() -> wry::Result<()> {
    let args: Vec<String> = env::args().collect();
    let webview_options: WebViewOptions = serde_json::from_str(&args[1]).unwrap();

    use tao::{
        event::{Event, StartCause, WindowEvent},
        event_loop::{ControlFlow, EventLoop},
        window::WindowBuilder,
    };
    use wry::WebViewBuilder;

    let (tx, to_deno) = mpsc::channel::<Message>();
    let (from_deno, rx) = mpsc::channel::<Request>();

    let event_loop = EventLoop::new();
    let mut window_builder = WindowBuilder::new()
        .with_title(webview_options.title)
        .with_transparent(webview_options.transparent)
        .with_decorations(webview_options.decorations);
    match webview_options.size {
        Some(WindowSize::States(WindowSizeStates::Maximized)) => {
            window_builder = window_builder.with_maximized(true)
        }
        Some(WindowSize::States(WindowSizeStates::Fullscreen)) => {
            window_builder = window_builder.with_fullscreen(Some(Fullscreen::Borderless(None)))
        }
        Some(WindowSize::Size { width, height }) => {
            window_builder =
                window_builder.with_inner_size(Size::Logical(LogicalSize::new(width, height)))
        }
        None => (),
    }
    let window = window_builder.build(&event_loop).unwrap();

    let mut webview_builder = match webview_options.target {
        WebViewTarget::Url(url) => WebViewBuilder::new(&window).with_url(url),
        WebViewTarget::Html(html) => WebViewBuilder::new(&window).with_html(html),
    }
    .with_transparent(webview_options.transparent)
    .with_autoplay(webview_options.autoplay)
    .with_incognito(webview_options.incognito)
    .with_clipboard(webview_options.clipboard)
    .with_focused(webview_options.focused)
    .with_devtools(webview_options.devtools)
    .with_accept_first_mouse(webview_options.accept_first_mouse);
    let ipc_tx = tx.clone();
    if webview_options.ipc {
        webview_builder = webview_builder.with_ipc_handler(move |message| {
            ipc_tx
                .send(Message::Notification(Notification::Ipc {
                    message: message.body().to_string(),
                }))
                .unwrap()
        })
    }
    let webview = webview_builder.build()?;

    let notify_tx = tx.clone();
    let notify = move |notification: Notification| {
        notify_tx.send(Message::Notification(notification)).unwrap();
    };

    let res_tx = tx.clone();
    let res = move |response: Response| {
        res_tx.send(Message::Response(response)).unwrap();
    };

    // Handle messages from the webview to the client.
    std::thread::spawn(move || {
        let stdout = std::io::stdout();
        let mut stdout_lock = stdout.lock();

        while let Ok(event) = to_deno.recv() {
            match serde_json::to_string(&event) {
                Ok(json) => {
                    let mut buffer = json.replace("\0", "").into_bytes();
                    buffer.push(0); // Add null byte
                    stdout_lock.write_all(&buffer).unwrap();
                    stdout_lock.flush().unwrap();
                }
                Err(err) => {
                    eprintln!("Failed to serialize event: {:?} {:?}", event, err);
                }
            }
        }
    });

    // Handle messages from the client to the webview.
    std::thread::spawn(move || {
        let stdin = io::stdin();
        let mut stdin = stdin.lock();
        let mut buf = Vec::<u8>::new();

        while stdin.read_until(b'\0', &mut buf).is_ok() {
            if buf.is_empty() {
                break; // EOF reached
            }
            // Remove null byte
            buf.pop();

            match serde_json::from_slice::<Request>(&buf) {
                Ok(event) => from_deno.send(event).unwrap(),
                Err(e) => eprintln!("Failed to deserialize: {:?}", e),
            }
            buf.clear()
        }
    });

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::NewEvents(StartCause::Init) => notify(Notification::Started {
                version: VERSION.into(),
            }),
            Event::UserEvent(event) => {
                eprintln!("User event: {:?}", event);
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                notify(Notification::Closed);
                *control_flow = ControlFlow::Exit
            }
            Event::MainEventsCleared => {
                if let Ok(req) = rx.try_recv() {
                    match req {
                        Request::Eval { id, js } => {
                            let result = webview.evaluate_script(&js);
                            res(match result {
                                Ok(_) => Response::Ack { id },
                                Err(err) => Response::Err {
                                    id,
                                    message: err.to_string(),
                                },
                            });
                        }
                        Request::SetTitle { id, title } => {
                            window.set_title(title.as_str());
                            res(Response::Ack { id });
                        }
                        Request::GetTitle { id } => res(Response::Result {
                            id,
                            result: window.title().into(),
                        }),
                        Request::OpenDevTools { id } => {
                            #[cfg(feature = "devtools")]
                            {
                                webview.open_devtools();
                                res(Response::Ack { id });
                            }
                            #[cfg(not(feature = "devtools"))]
                            {
                                res(Response::Err {
                                    id,
                                    message: "DevTools not enabled".to_string(),
                                });
                            }
                        }
                        Request::SetVisibility { id, visible } => {
                            window.set_visible(visible);
                            res(Response::Ack { id });
                        }
                        Request::IsVisible { id } => res(Response::Result {
                            id,
                            result: window.is_visible().into(),
                        }),
                        Request::GetVersion { id } => {
                            res(Response::Result {
                                id,
                                result: VERSION.to_string().into(),
                            });
                        }
                        Request::GetSize {
                            id,
                            include_decorations,
                        } => {
                            let size = if include_decorations.unwrap_or(false) {
                                window.outer_size().to_logical(window.scale_factor())
                            } else {
                                window.inner_size().to_logical(window.scale_factor())
                            };
                            res(Response::Result {
                                id,
                                result: ResultType::Size {
                                    width: size.width,
                                    height: size.height,
                                    scale_factor: window.scale_factor(),
                                },
                            });
                        }
                        Request::SetSize { id, size } => {
                            window.set_inner_size(Size::Logical(LogicalSize::new(
                                size.width,
                                size.height,
                            )));
                            res(Response::Ack { id });
                        }
                        Request::Fullscreen { id, fullscreen } => {
                            let fullscreen = fullscreen.unwrap_or(!window.fullscreen().is_some());
                            eprintln!("Fullscreen: {:?}", fullscreen);
                            if fullscreen {
                                window.set_fullscreen(Some(Fullscreen::Borderless(None)));
                            } else {
                                window.set_fullscreen(None);
                            }
                            res(Response::Ack { id });
                        }
                        Request::Maximize { id, maximized } => {
                            let maximized = maximized.unwrap_or(!window.is_maximized());
                            eprintln!("Maximize: {:?}", maximized);
                            window.set_maximized(maximized);
                            res(Response::Ack { id });
                        }
                        Request::Minimize { id, minimized } => {
                            let minimized = minimized.unwrap_or(!window.is_minimized());
                            eprintln!("Minimize: {:?}", minimized);
                            window.set_minimized(minimized);
                            res(Response::Ack { id });
                        }
                    }
                }
            }
            _ => (),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use schemars::schema_for;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn generate_json_schemas() {
        let schemas = [
            ("WebViewOptions", schema_for!(WebViewOptions)),
            ("WebViewMessage", schema_for!(Message)),
            ("WebViewRequest", schema_for!(Request)),
            ("WebViewResponse", schema_for!(Response)),
        ];

        for (name, schema) in schemas {
            let schema_json = serde_json::to_string_pretty(&schema).unwrap();
            let mut file = File::create(format!("schemas/{}.json", name)).unwrap();
            file.write_all(schema_json.as_bytes()).unwrap();
        }
    }
}
