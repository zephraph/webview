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

#[derive(JsonSchema, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type", content = "data")]
enum WebViewEvent {
    Started,
    Closed,
    GetTitle(String),

    // Responses
    SetTitleDone,
    OpenDevToolsDone,
    EvalDone(Option<String>),
}

#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type", content = "data")]
enum ClientEvent {
    Eval(String),
    SetTitle(String),
    GetTitle,
    OpenDevTools,
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

    eprintln!("transparent: {:?}", webview_options.transparent);

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

    let (tx, to_deno) = mpsc::channel::<WebViewEvent>();
    let (from_deno, rx) = mpsc::channel::<ClientEvent>();

    std::thread::spawn(move || {
        let stdout = std::io::stdout();
        let mut stdout_lock = stdout.lock();

        while let Ok(event) = to_deno.recv() {
            eprintln!("Sending event: {:?}", event);
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

            match serde_json::from_slice::<ClientEvent>(&buf) {
                Ok(event) => from_deno.send(event).unwrap(),
                Err(e) => eprintln!("Failed to deserialize: {:?}", e),
            }
            buf.clear()
        }
    });

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::NewEvents(StartCause::Init) => tx.send(WebViewEvent::Started).unwrap(),
            Event::UserEvent(event) => {
                eprintln!("User event: {:?}", event);
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                tx.send(WebViewEvent::Closed).unwrap();
                *control_flow = ControlFlow::Exit
            }
            Event::MainEventsCleared => {
                if let Ok(event) = rx.try_recv() {
                    eprintln!("Received event: {:?}", event);
                    match event {
                        ClientEvent::Eval(js) => {
                            let result = webview.evaluate_script(&js);
                            tx.send(WebViewEvent::EvalDone(match result {
                                Ok(_) => None,
                                Err(err) => Some(err.to_string()),
                            }))
                            .unwrap();
                        }
                        ClientEvent::OpenDevTools => {
                            webview.open_devtools();
                            tx.send(WebViewEvent::OpenDevToolsDone).unwrap();
                        }
                        ClientEvent::SetTitle(title) => {
                            window.set_title(title.as_str());
                            tx.send(WebViewEvent::SetTitleDone).unwrap();
                        }
                        ClientEvent::GetTitle => {
                            tx.send(WebViewEvent::GetTitle(window.title())).unwrap();
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
            ("WebViewEvent", schema_for!(WebViewEvent)),
            ("ClientEvent", schema_for!(ClientEvent)),
        ];

        for (name, schema) in schemas {
            let schema_json = serde_json::to_string_pretty(&schema).unwrap();
            let mut file = File::create(format!("schemas/{}.json", name)).unwrap();
            file.write_all(schema_json.as_bytes()).unwrap();
        }
    }
}
