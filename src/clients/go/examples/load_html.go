package main

import (
	"context"
	"fmt"
	"log"

	"github.com/justbe-engineering/webview-client-go/webview"
)

func main() {
	ctx := context.Background()

	loadContent := webview.ContentFrom(webview.NewHtmlContent("<h1>Initial html</h1>", "example.com"))
	
	options := webview.Options{
		Title:    "Load Html Example",
		Devtools: boolPtr(true),
		Load: &loadContent,
	}

	wv, err := webview.NewWebView(ctx, options)
	if err != nil {
		log.Fatal(err)
	}
	defer wv.Close()

	// Register event handler for "started" event
	wv.On("started", func(event interface{}) {
		fmt.Println("WebView started!")

		// Open dev tools
		if err := wv.OpenDevTools(); err != nil {
			log.Printf("Failed to open dev tools: %v", err)
		}

		// Load new HTML content
		if err := wv.LoadHTML("<h1>Updated html!</h1>", ""); err != nil {
			log.Printf("Failed to load HTML: %v", err)
		}
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

func strPtr(s string) *string {
	return &s
}