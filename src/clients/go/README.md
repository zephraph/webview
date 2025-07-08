# @justbe/webview Go Client

A light, cross-platform library for building web-based desktop apps with Go.

## Installation

```bash
go get github.com/justbe-engineering/webview-client-go
```

## Example

```go
package main

import (
    "context"
    "log"

    "github.com/justbe-engineering/webview-client-go/webview"
)

func main() {
    ctx := context.Background()

    loadContent := webview.Content(map[string]interface{}{
        "html": "<h1>Hello, World!</h1>",
    })
    
    options := webview.Options{
        Title:    "Example",
        Devtools: &[]bool{true}[0], // pointer to true
        Load: &loadContent,
    }

    wv, err := webview.NewWebView(ctx, options)
    if err != nil {
        log.Fatal(err)
    }
    defer wv.Close()

    wv.On("started", func(event interface{}) {
        wv.OpenDevTools()
        wv.Eval("console.log('This is printed from eval!')")
    })

    // Wait for the webview to close
    wv.Wait()
}
```

Check out the [examples directory](examples/) for more examples.

## Binary Management

When using the Go client, it will check for the required binary for interfacing with the OS's webview. If it doesn't exist, it downloads it to a cache directory and executes it.

### Cache Directory Locations

The binary is cached in OS-specific locations:

- **macOS**: `~/Library/Caches/webview/`
- **Linux**: `~/.cache/webview/`
- **Windows**: `%LOCALAPPDATA%/webview/Cache/`

### Using a Custom Binary

You can specify a custom binary path using the `WEBVIEW_BIN` environment variable. When set, this will bypass the default binary resolution process and use the specified path instead.

```bash
export WEBVIEW_BIN=/path/to/custom/webview
```

## API Reference

### WebView

The main WebView type provides methods for controlling the webview window.

#### Methods

- `Eval(js string) (interface{}, error)` - Execute JavaScript code
- `OpenDevTools() error` - Open developer tools
- `SetTitle(title string) error` - Set window title
- `LoadHTML(html string, origin string) error` - Load HTML content
- `LoadURL(url string, headers map[string]string) error` - Load URL
- `On(eventType string, handler EventHandler)` - Register event handler
- `Wait() error` - Wait for webview to close
- `Close() error` - Close the webview

#### Events

- `"started"` - Fired when the webview starts
- `"closed"` - Fired when the webview closes
- `"ipc"` - Fired when receiving IPC messages from JavaScript

### Options

Configuration options for creating a webview:

```go
type Options struct {
    Title                string     // required
    Devtools             *bool      // optional
    Load                 *Content   // optional (Content is interface{})
    InitializationScript *string    // optional
    Ipc                  *bool      // optional
    UserAgent            *string    // optional
    // ... and more options
}
```

Most optional fields are pointers. For Content, use type conversion:

```go
// Helper functions for pointer types
func boolPtr(b bool) *bool { return &b }
func strPtr(s string) *string { return &s }

// Content should be a map for union types
loadContent := webview.Content(map[string]interface{}{
    "html": "<h1>Hello</h1>",
    // or for URLs:
    // "url": "https://example.com",
    // "headers": map[string]string{"Content-Type": "text/html"},
})

options := webview.Options{
    Title:    "My App",
    Devtools: boolPtr(true),
    Load:     &loadContent,
}
```