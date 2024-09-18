use std::env;
use std::io::{self, BufRead, Write};
use std::sync::mpsc;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json;

#[derive(JsonSchema, Deserialize, Debug)]
struct WebViewOptions {
    title: String,
    url: String,
}

#[derive(JsonSchema, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type")]
enum WebViewEvent {
    Started,
    Closed,
}

#[derive(JsonSchema, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "$type", content = "data")]
enum ClientEvent {
    Eval(String),
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
    let window = WindowBuilder::new()
        .with_title(webview_options.title)
        .build(&event_loop)
        .unwrap();
    let webview = WebViewBuilder::new(&window)
        .with_url(webview_options.url)
        .build()?;

    let (tx, to_deno) = mpsc::channel::<WebViewEvent>();
    let (from_deno, rx) = mpsc::channel::<ClientEvent>();

    std::thread::spawn(move || {
        let stdout = std::io::stdout();
        let mut stdout_lock = stdout.lock();

        while let Ok(event) = to_deno.recv() {
            if let Ok(json) = serde_json::to_string(&event) {
                let mut buffer = json.replace("\0", "").into_bytes();
                buffer.push(0); // Add null byte
                stdout_lock.write_all(&buffer).unwrap();
                stdout_lock.flush().unwrap();
            } else {
                eprintln!("Failed to serialize event: {:?}", event);
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
                            webview.evaluate_script(&js).unwrap();
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
