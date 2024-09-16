choice ToWebView {
    create_webview: WebViewOptions = 0
}

choice ToDeno {
    event: WebViewEvent = 0
}

struct WebViewOptions {
    title: String = 0
    url: String = 1
}

choice WebViewEvent {
    stared = 0
}
