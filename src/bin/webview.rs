use std::env;
use webview::{run, WebViewOptions};
fn main() {
    let args: Vec<String> = env::args().collect();
    let webview_options: WebViewOptions = serde_json::from_str(&args[1]).unwrap();
    run(webview_options).unwrap();
}
