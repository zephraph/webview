package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/justbe-engineering/webview-client-go/webview"
)

func main() {
	ctx := context.Background()

	loadContent := webview.ContentFrom(webview.NewUrlContent("https://example.com", map[string]string{
		"Content-Type": "text/html",
	}))
	
	options := webview.Options{
		Title:     "Load Url Example",
		Devtools:  boolPtr(true),
		UserAgent: strPtr("curl/7.81.0"),
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

		// Wait a bit then load a new URL
		time.Sleep(2 * time.Second)
		
		headers := map[string]string{
			"Content-Type": "text/html",
		}
		
		if err := wv.LoadURL("https://val.town/", headers); err != nil {
			log.Printf("Failed to load URL: %v", err)
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