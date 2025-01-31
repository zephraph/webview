use std::env;
use tracing::error;
use webview::{run, WebViewOptions};

fn main() {
    let args: Vec<String> = env::args().collect();
    let webview_options: WebViewOptions = match serde_json::from_str(&args[1]) {
        Ok(options) => options,
        Err(e) => {
            error!("Failed to parse webview options: {:?}", e);
            std::process::exit(1);
        }
    };
    if let Err(e) = run(webview_options) {
        error!("Webview error: {:?}", e);
        std::process::exit(1);
    }
}
