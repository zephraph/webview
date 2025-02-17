use std::env;
use tracing::error;
use webview::{run, Options};

fn main() {
    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string()))
        .with_writer(std::io::stderr)
        .finish();
    tracing::subscriber::set_global_default(subscriber).unwrap();

    let args: Vec<String> = env::args().collect();

    let webview_options: Options = match serde_json::from_str(&args[1]) {
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
