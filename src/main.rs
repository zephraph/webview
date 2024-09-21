use std::env;
use std::io::{self, BufRead, Write};
use std::sync::mpsc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json;
use tao::window::Fullscreen;

#[derive(JsonSchema, Deserialize, Debug)]
struct WebViewOptions {
    /// Sets the title of the window.
    title: String,
    #[serde(flatten)]
    target: WebViewTarget,
    /// Sets whether the window should be fullscreen.
    #[serde(default)]
    fullscreen: bool,
    /// Sets whether the window should have a border, a title bar, etc.
    #[serde(default = "default_true")]
    decorations: bool,
    #[serde(default)]
    transparent: bool,
    /// Sets whether all media can be played without user interaction.
    #[serde(default)]
    autoplay: bool,
    /// Enable or disable web inspector which is usually called devtools.
    ///
    /// Note this only enables devtools to the webview. To open it, you can call WebView::open_devtools, or right click the page and open it from the context menu.
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
}

fn default_true() -> bool {
    true
}

#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
enum WebViewTarget {
    Url(String),
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
    Started,
    Closed,
}

/// Explicit requests from the client to the webview.
#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type")]
enum Request {
    Eval { id: String, js: String },
    SetTitle { id: String, title: String },
    GetTitle { id: String },
    OpenDevTools { id: String },
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
    Json(String),
}

impl From<String> for ResultType {
    fn from(value: String) -> Self {
        ResultType::String(value)
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

    let event_loop = EventLoop::new();
    let mut window_builder = WindowBuilder::new()
        .with_title(webview_options.title)
        .with_transparent(webview_options.transparent)
        .with_decorations(webview_options.decorations);
    if webview_options.fullscreen {
        window_builder = window_builder.with_fullscreen(Some(Fullscreen::Borderless(None)));
    }
    let window = window_builder.build(&event_loop).unwrap();

    let webview_builder = match webview_options.target {
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
    let webview = webview_builder.build()?;

    let (tx, to_deno) = mpsc::channel::<Message>();
    let (from_deno, rx) = mpsc::channel::<Request>();

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
            Event::NewEvents(StartCause::Init) => notify(Notification::Started),
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
                    eprintln!("Received event: {:?}", event);
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
