use actson::options::JsonParserOptionsBuilder;
use parking_lot::Mutex;
use std::borrow::Cow;
use std::collections::HashMap;
use std::env;
use std::io::{BufReader, Read, Write};
use std::str::FromStr;
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use tao::dpi;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tao::window::Fullscreen;
use tracing::{debug, error, info};

use tao::{
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::http::header::{HeaderName, HeaderValue};
use wry::http::Response as HttpResponse;
use wry::WebViewBuilder;

use actson::feeder::BufReaderJsonFeeder;
use actson::{JsonEvent, JsonParser};

/// The version of the webview binary.
const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(JsonSchema, Deserialize, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Size {
    /// The width of the window in logical pixels.
    width: f64,
    /// The height of the window in logical pixels.
    height: f64,
}

#[derive(JsonSchema, Deserialize, Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SizeWithScale {
    /// The width of the window in logical pixels.
    width: f64,
    /// The height of the window in logical pixels.
    height: f64,
    /// The ratio between physical and logical sizes.
    scale_factor: f64,
}

#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub enum WindowSizeStates {
    Maximized,
    Fullscreen,
}

#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(untagged)]
pub enum WindowSize {
    States(WindowSizeStates),
    Size(Size),
}

/// Options for creating a webview.
#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    /// Sets the title of the window.
    title: String,
    /// The content to load into the webview.
    #[serde(default)]
    load: Option<Content>,
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
    #[serde(default)]
    /// Run JavaScript code when loading new pages. When the webview loads a new page, this code will be executed. It is guaranteed that the code is executed before window.onload.
    initialization_script: Option<String>,
    /// Sets the user agent to use when loading pages.
    #[serde(default)]
    user_agent: Option<String>,
}

fn default_true() -> bool {
    true
}

/// The content to load into the webview.
#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(untagged)]
pub enum Content {
    Url {
        /// Url to load in the webview. Note: Don't use data URLs here, as they are not supported. Use the `html` field instead.
        url: String,
        /// Optional headers to send with the request.
        headers: Option<HashMap<String, String>>,
    },
    Html {
        /// Html to load in the webview.
        html: String,
        /// What to set as the origin of the webview when loading html.
        #[serde(default = "default_origin")]
        origin: String,
    },
}

/// The default origin to use when loading html.
fn default_origin() -> String {
    "init".to_string()
}

// --- RPC Definitions ---

/// Complete definition of all outbound messages from the webview to the client.
#[derive(JsonSchema, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type", content = "data")]
pub enum Message {
    Notification(Notification),
    Response(Response),
}

/// Messages that are sent unbidden from the webview to the client.
#[derive(JsonSchema, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type")]
pub enum Notification {
    Started {
        /// The version of the webview binary
        version: String,
    },
    Ipc {
        /// The message sent from the webview UI to the client.
        message: String,
    },
    Closed,
}

/// Explicit requests from the client to the webview.
#[derive(JsonSchema, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type")]
pub enum Request {
    GetVersion {
        /// The id of the request.
        id: i64,
    },
    Eval {
        /// The id of the request.
        id: i64,
        /// The javascript to evaluate.
        js: String,
    },
    SetTitle {
        /// The id of the request.
        id: i64,
        /// The title to set.
        title: String,
    },
    GetTitle {
        /// The id of the request.
        id: i64,
    },
    SetVisibility {
        /// The id of the request.
        id: i64,
        /// Whether the window should be visible or hidden.
        visible: bool,
    },
    IsVisible {
        /// The id of the request.
        id: i64,
    },
    OpenDevTools {
        /// The id of the request.
        id: i64,
    },
    GetSize {
        /// The id of the request.
        id: i64,
        /// Whether to include the title bar and borders in the size measurement.
        #[serde(default)]
        include_decorations: Option<bool>,
    },
    SetSize {
        /// The id of the request.
        id: i64,
        /// The size to set.
        size: Size,
    },
    Fullscreen {
        /// The id of the request.
        id: i64,
        /// Whether to enter fullscreen mode.
        /// If left unspecified, the window will enter fullscreen mode if it is not already in fullscreen mode
        /// or exit fullscreen mode if it is currently in fullscreen mode.
        fullscreen: Option<bool>,
    },
    Maximize {
        /// The id of the request.
        id: i64,
        /// Whether to maximize the window.
        /// If left unspecified, the window will be maximized if it is not already maximized
        /// or restored if it was previously maximized.
        maximized: Option<bool>,
    },
    Minimize {
        /// The id of the request.
        id: i64,
        /// Whether to minimize the window.
        /// If left unspecified, the window will be minimized if it is not already minimized
        /// or restored if it was previously minimized.
        minimized: Option<bool>,
    },
    LoadHtml {
        /// The id of the request.
        id: i64,
        /// HTML to set as the content of the webview.
        html: String,
        /// What to set as the origin of the webview when loading html.
        /// If not specified, the origin will be set to the value of the `origin` field when the webview was created.
        origin: Option<String>,
    },
    LoadUrl {
        /// The id of the request.
        id: i64,
        /// URL to load in the webview.
        url: String,
        /// Optional headers to send with the request.
        headers: Option<HashMap<String, String>>,
    },
}

/// Responses from the webview to the client.
#[derive(JsonSchema, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type")]
pub enum Response {
    Ack { id: i64 },
    Result { id: i64, result: ResultType },
    Err { id: i64, message: String },
}

/// Types that can be returned from webview results.
#[derive(JsonSchema, Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type", content = "value")]
#[allow(dead_code)]
pub enum ResultType {
    String(String),
    Boolean(bool),
    Float(f64),
    Size(SizeWithScale),
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

/// Incrementally parses JSON input from a reader and sends the parsed requests to a sender.
///
/// This is used in the main program to read JSON input from stdin and send it to the webview
/// event loop.
fn process_input<R: Read + std::marker::Send + 'static>(
    reader: BufReader<R>,
    sender: Sender<Request>,
) {
    std::thread::spawn(move || {
        let feeder = BufReaderJsonFeeder::new(reader);
        let mut parser = JsonParser::new_with_options(
            feeder,
            JsonParserOptionsBuilder::default()
                .with_streaming(true)
                .build(),
        );

        let mut json_string = String::new();
        let mut depth = 0;

        while let Some(event) = parser.next_event().unwrap() {
            match event {
                JsonEvent::NeedMoreInput => parser.feeder.fill_buf().unwrap(),
                JsonEvent::StartObject => {
                    depth += 1;
                    json_string.push('{');
                }
                JsonEvent::EndObject => {
                    depth -= 1;
                    json_string.push('}');

                    // If we're back at depth 0, we have a complete JSON object
                    if depth == 0 {
                        match serde_json::from_str::<Request>(&json_string) {
                            Ok(request) => {
                                debug!(request = ?request, "Received request from client");
                                sender.send(request).unwrap()
                            }
                            Err(e) => error!("Failed to deserialize request: {:?}", e),
                        }
                        json_string.clear();
                    }
                }
                JsonEvent::StartArray => {
                    depth += 1;
                    json_string.push('[');
                }
                JsonEvent::EndArray => {
                    depth -= 1;
                    json_string.push(']');
                }
                JsonEvent::FieldName => {
                    if json_string.ends_with('{') {
                        json_string.push('"');
                    } else {
                        json_string.push_str(",\"");
                    }
                    json_string.push_str(parser.current_str().unwrap());
                    json_string.push_str("\":");
                }
                JsonEvent::ValueString => {
                    json_string.push('"');
                    json_string.push_str(parser.current_str().unwrap());
                    json_string.push('"');
                }
                JsonEvent::ValueInt => {
                    json_string.push_str(&parser.current_int::<i64>().unwrap().to_string());
                }
                JsonEvent::ValueFloat => {
                    json_string.push_str(&parser.current_float().unwrap().to_string());
                }
                JsonEvent::ValueTrue => json_string.push_str("true"),
                JsonEvent::ValueFalse => json_string.push_str("false"),
                JsonEvent::ValueNull => json_string.push_str("null"),
            }
        }
    });
}

/// Incrementally writes messages to a writer.
///
/// This is used in the main program to write messages to stdout.
fn process_output<W: Write + std::marker::Send + 'static>(
    writer: W,
    receiver: mpsc::Receiver<Message>,
) {
    std::thread::spawn(move || {
        let mut writer = std::io::BufWriter::new(writer);

        while let Ok(event) = receiver.recv() {
            debug!(message = ?event, "Sending message to client");
            match serde_json::to_string(&event) {
                Ok(json) => {
                    let mut buffer = json.into_bytes();
                    buffer.push(b'\n');
                    writer.write_all(&buffer).unwrap();
                    writer.flush().unwrap();
                }
                Err(err) => {
                    error!("Failed to serialize event: {:?} {:?}", event, err);
                }
            }
        }
    });
}

pub fn run(webview_options: Options) -> wry::Result<()> {
    info!("Starting webview with options: {:?}", webview_options);

    // These two mutexes are used to store the html and origin if the webview is created with html.
    // The html mutex is needed to provide a value to the custom protocol and origin is needed
    // as a fallback if `load_html` is called without an origin.
    let html_mutex = Arc::new(Mutex::new("".to_string()));
    let origin_mutex = Arc::new(Mutex::new(default_origin().to_string()));

    let (tx, from_webview) = mpsc::channel::<Message>();
    let (to_eventloop, rx) = mpsc::channel::<Request>();

    let event_loop = EventLoop::new();
    let mut window_builder = WindowBuilder::new()
        .with_title(webview_options.title.clone())
        .with_transparent(webview_options.transparent)
        .with_decorations(webview_options.decorations);
    match webview_options.size {
        Some(WindowSize::States(WindowSizeStates::Maximized)) => {
            window_builder = window_builder.with_maximized(true)
        }
        Some(WindowSize::States(WindowSizeStates::Fullscreen)) => {
            window_builder = window_builder.with_fullscreen(Some(Fullscreen::Borderless(None)))
        }
        Some(WindowSize::Size(Size { width, height })) => {
            window_builder = window_builder
                .with_inner_size(dpi::Size::Logical(dpi::LogicalSize::new(width, height)))
        }
        None => (),
    }
    let window = window_builder.build(&event_loop).unwrap();

    let html_mutex_init = html_mutex.clone();
    let mut webview_builder = match webview_options.load {
        Some(Content::Url { url, headers }) => {
            let mut webview_builder = WebViewBuilder::new().with_url(url);
            if let Some(headers) = headers {
                let headers = headers
                    .into_iter()
                    .map(|(k, v)| {
                        (
                            HeaderName::from_str(&k).unwrap(),
                            HeaderValue::from_str(&v).unwrap(),
                        )
                    })
                    .collect();
                webview_builder = webview_builder.with_headers(headers);
            }
            webview_builder
        }
        Some(Content::Html { html, origin }) => {
            origin_mutex.lock().clone_from(&origin);
            *html_mutex.lock() = html;
            WebViewBuilder::new().with_url(format!("load-html://{}", origin))
        }
        None => WebViewBuilder::new(),
    }
    .with_custom_protocol("load-html".into(), move |_id, _req| {
        HttpResponse::builder()
            .header("Content-Type", "text/html")
            .body(Cow::Owned(html_mutex_init.lock().as_bytes().to_vec()))
            .unwrap()
    })
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
    if let Some(initialization_script) = webview_options.initialization_script {
        webview_builder =
            webview_builder.with_initialization_script(initialization_script.as_str());
    }
    if let Some(user_agent) = webview_options.user_agent {
        webview_builder = webview_builder.with_user_agent(user_agent.as_str());
    }
    #[cfg(not(target_os = "linux"))]
    let webview = webview_builder.build(&window)?;

    #[cfg(target_os = "linux")]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let vbox = window.default_vbox().unwrap();
        webview_builder.build_gtk(vbox)?
    };

    let notify_tx = tx.clone();
    let notify = move |notification: Notification| {
        debug!(notification = ?notification, "Sending notification to client");
        notify_tx.send(Message::Notification(notification)).unwrap();
    };

    let res_tx = tx.clone();
    let res = move |response: Response| {
        debug!(response = ?response, "Sending response to client");
        res_tx.send(Message::Response(response)).unwrap();
    };

    // Handle messages from the webview to the client.
    process_output(std::io::stdout(), from_webview);

    // Handle messages from the client to the webview.
    process_input(BufReader::new(std::io::stdin()), to_eventloop);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::NewEvents(StartCause::Init) => {
                info!("Webview initialized");
                notify(Notification::Started {
                    version: VERSION.into(),
                });
            }
            Event::UserEvent(event) => {
                eprintln!("User event: {:?}", event);
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                info!("Webview close requested");
                notify(Notification::Closed);
                *control_flow = ControlFlow::Exit
            }
            Event::MainEventsCleared => {
                if let Ok(req) = rx.try_recv() {
                    debug!(request = ?req, "Processing request");
                    match req {
                        Request::Eval { id, js } => {
                            let result = webview.evaluate_script(&js);
                            res(match result {
                                Ok(_) => Response::Ack { id },
                                Err(err) => {
                                    error!("Eval error: {:?}", err);
                                    Response::Err {
                                        id,
                                        message: err.to_string(),
                                    }
                                }
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
                                result: ResultType::Size(SizeWithScale {
                                    width: size.width,
                                    height: size.height,
                                    scale_factor: window.scale_factor(),
                                }),
                            });
                        }
                        Request::SetSize { id, size } => {
                            window.set_inner_size(dpi::Size::Logical(dpi::LogicalSize::new(
                                size.width,
                                size.height,
                            )));
                            res(Response::Ack { id });
                        }
                        Request::Fullscreen { id, fullscreen } => {
                            let fullscreen = fullscreen.unwrap_or(window.fullscreen().is_none());
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
                        Request::LoadHtml { id, html, origin } => {
                            *html_mutex.lock() = html;
                            let origin = match origin {
                                Some(origin) => {
                                    origin_mutex.lock().clone_from(&origin);
                                    origin
                                }
                                None => origin_mutex.lock().clone(),
                            };

                            webview
                                .load_url(&format!("load-html://{}?{}", origin, id))
                                .unwrap();
                            res(Response::Ack { id });
                        }
                        Request::LoadUrl { id, url, headers } => {
                            let resp = match headers {
                                Some(headers) => {
                                    let headers = headers
                                        .into_iter()
                                        .map(|(k, v)| {
                                            (
                                                HeaderName::from_str(&k).unwrap(),
                                                HeaderValue::from_str(&v).unwrap(),
                                            )
                                        })
                                        .collect();
                                    webview.load_url_with_headers(&url, headers)
                                }
                                None => webview.load_url(&url),
                            };
                            match resp {
                                Ok(_) => res(Response::Ack { id }),
                                Err(err) => res(Response::Err {
                                    id,
                                    message: err.to_string(),
                                }),
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
    use std::io::Cursor;

    #[test]
    fn test_process_input_simple() {
        // Create a GetVersion request
        let request = Request::GetVersion { id: 0 };

        // Serialize to JSON
        let json = serde_json::to_vec(&request).unwrap();
        let cursor = Cursor::new(json);
        let reader = BufReader::new(cursor);
        let (sender, receiver) = mpsc::channel();

        // Capture stderr output
        let stderr = std::io::stderr();
        let _handle = stderr.lock();

        process_input(reader, sender);

        // Give the thread a moment to process
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Try to receive the message
        match receiver.try_recv() {
            Ok(received) => {
                assert!(matches!(
                    received,
                    Request::GetVersion { id } if id == 0
                ));
            }
            Err(e) => panic!("Failed to receive message: {:?}", e),
        }
    }

    #[test]
    fn test_process_input_complex() {
        // Create a SetSize request with nested SimpleSize
        let request = Request::SetSize {
            id: 0,
            size: Size {
                width: 800.0,
                height: 600.0,
            },
        };

        // Serialize to JSON
        let json = serde_json::to_vec(&request).unwrap();
        let cursor = Cursor::new(json);
        let reader = BufReader::new(cursor);
        let (sender, receiver) = mpsc::channel();

        process_input(reader, sender);

        // Give the thread a moment to process
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Try to receive the message
        match receiver.try_recv() {
            Ok(received) => match received {
                Request::SetSize { id, size } => {
                    assert_eq!(id, 0);
                    assert_eq!(size.width, 800.0);
                    assert_eq!(size.height, 600.0);
                }
                other => panic!("Unexpected request type: {:?}", other),
            },
            Err(e) => panic!("Failed to receive message: {:?}", e),
        }
    }

    #[test]
    fn test_process_output() {
        let output = Arc::new(Mutex::new(Vec::new()));
        let output_clone = output.clone();
        let (sender, receiver) = mpsc::channel();

        // Start processing output
        process_output(WriteGuard(output_clone), receiver);

        // Create and send a test message
        let message = Message::Response(Response::Ack { id: 0 });
        sender.send(message).unwrap();

        // Give the thread a moment to process
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Check the output
        let output_str = String::from_utf8(output.lock().clone()).unwrap();
        let expected = serde_json::json!({
            "$type": "response",
            "data": {
                "$type": "ack",
                "id": 0
            }
        });
        let expected_str = expected.to_string() + "\n";
        assert_eq!(output_str, expected_str);
    }

    // Helper struct to implement Write for our Arc<Mutex<Vec<u8>>>
    struct WriteGuard(Arc<Mutex<Vec<u8>>>);

    impl Write for WriteGuard {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().write(buf)
        }

        fn flush(&mut self) -> std::io::Result<()> {
            self.0.lock().flush()
        }
    }

    #[test]
    fn test_process_input_multiple() {
        // Create multiple requests
        let requests = vec![
            Request::GetVersion { id: 0 },
            Request::SetSize {
                id: 0,
                size: Size {
                    width: 1024.0,
                    height: 768.0,
                },
            },
            Request::LoadUrl {
                id: 0,
                url: "https://example.com".to_string(),
                headers: Some(HashMap::from([
                    ("User-Agent".to_string(), "test-agent".to_string()),
                    ("Accept".to_string(), "text/html".to_string()),
                ])),
            },
        ];

        // Serialize each request and concatenate
        let mut json = Vec::new();
        for request in &requests {
            json.extend(serde_json::to_vec(request).unwrap());
        }

        let cursor = Cursor::new(json);
        let reader = BufReader::new(cursor);
        let (sender, receiver) = mpsc::channel();

        process_input(reader, sender);

        // Give the thread a moment to process
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Try to receive all messages in order
        for expected in requests {
            match receiver.try_recv() {
                Ok(received) => match (received, expected) {
                    (Request::GetVersion { id: rid }, Request::GetVersion { id: eid }) => {
                        assert_eq!(rid, eid);
                    }
                    (
                        Request::SetSize {
                            id: rid,
                            size: rsize,
                        },
                        Request::SetSize {
                            id: eid,
                            size: esize,
                        },
                    ) => {
                        assert_eq!(rid, eid);
                        assert_eq!(rsize.width, esize.width);
                        assert_eq!(rsize.height, esize.height);
                    }
                    (
                        Request::LoadUrl {
                            id: rid,
                            url: rurl,
                            headers: rheaders,
                        },
                        Request::LoadUrl {
                            id: eid,
                            url: eurl,
                            headers: eheaders,
                        },
                    ) => {
                        assert_eq!(rid, eid);
                        assert_eq!(rurl, eurl);
                        assert_eq!(rheaders, eheaders);
                    }
                    _ => panic!("Unexpected request type mismatch"),
                },
                Err(e) => panic!("Failed to receive message: {:?}", e),
            }
        }

        // Verify no more messages
        assert!(
            receiver.try_recv().is_err(),
            "Should not have any more messages"
        );
    }

    #[test]
    fn test_process_output_multiple() {
        let output = Arc::new(Mutex::new(Vec::new()));
        let output_clone = output.clone();
        let (sender, receiver) = mpsc::channel();

        // Start processing output
        process_output(WriteGuard(output_clone), receiver);

        // Create and send multiple test messages
        let messages = vec![
            Message::Response(Response::Ack { id: 0 }),
            Message::Notification(Notification::Started {
                version: "1.0.0".to_string(),
            }),
            Message::Response(Response::Result {
                id: 0,
                result: ResultType::Size(SizeWithScale {
                    width: 800.0,
                    height: 600.0,
                    scale_factor: 1.0,
                }),
            }),
        ];

        // Send all messages
        for message in messages.clone() {
            sender.send(message).unwrap();
        }

        // Give the thread a moment to process
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Get the output and split by newlines
        let output_str = String::from_utf8(output.lock().clone()).unwrap();
        let received_messages: Vec<Message> = output_str
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();

        // Verify we got all messages in order
        assert_eq!(received_messages.len(), messages.len());
        for (received, expected) in received_messages.iter().zip(messages.iter()) {
            match (received, expected) {
                (
                    Message::Response(Response::Ack { id: rid }),
                    Message::Response(Response::Ack { id: eid }),
                ) => {
                    assert_eq!(rid, eid);
                }
                (
                    Message::Notification(Notification::Started { version: rver }),
                    Message::Notification(Notification::Started { version: ever }),
                ) => {
                    assert_eq!(rver, ever);
                }
                (
                    Message::Response(Response::Result {
                        id: rid,
                        result: rres,
                    }),
                    Message::Response(Response::Result {
                        id: eid,
                        result: eres,
                    }),
                ) => {
                    assert_eq!(rid, eid);
                    match (rres, eres) {
                        (
                            ResultType::Size(SizeWithScale {
                                width: rw,
                                height: rh,
                                scale_factor: rs,
                            }),
                            ResultType::Size(SizeWithScale {
                                width: ew,
                                height: eh,
                                scale_factor: es,
                            }),
                        ) => {
                            assert_eq!(rw, ew);
                            assert_eq!(rh, eh);
                            assert_eq!(rs, es);
                        }
                        _ => panic!("Unexpected result type"),
                    }
                }
                _ => panic!("Message type mismatch"),
            }
        }

        // Verify each line is valid JSON
        for line in output_str.lines() {
            assert!(serde_json::from_str::<Message>(line).is_ok());
        }
    }
}
