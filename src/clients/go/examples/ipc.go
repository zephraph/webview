package main

import (
	"context"
	"fmt"
	"log"

	"github.com/justbe-engineering/webview-client-go/webview"
)

func main() {
	ctx := context.Background()

	html := `<button onclick="window.ipc.postMessage('button clicked ' + Date.now())">Click me</button>`

	loadContent := webview.ContentFrom(webview.NewHtmlContent(html))
	
	options := webview.Options{
		Title: "IPC Example",
		Load: &loadContent,
		Ipc: boolPtr(true),
	}

	wv, err := webview.NewWebView(ctx, options)
	if err != nil {
		log.Fatal(err)
	}
	defer wv.Close()

	// Register event handler for IPC messages
	wv.On("ipc", func(event interface{}) {
		eventMap, ok := event.(map[string]interface{})
		if !ok {
			log.Printf("Invalid IPC event format")
			return
		}

		message, ok := eventMap["message"].(string)
		if !ok {
			log.Printf("Invalid IPC message format")
			return
		}

		fmt.Printf("Received IPC message: %s\n", message)
	})

	// Register event handler for window close
	wv.On("closed", func(event interface{}) {
		fmt.Println("WebView closed!")
	})

	// Wait for the webview to close
	if err := wv.Wait(); err != nil {
		log.Printf("WebView exited with error: %v", err)
	}
}

// Helper functions for pointer types
func boolPtr(b bool) *bool {
	return &b
}