package main

import (
	"context"
	"fmt"
	"log"

	"github.com/justbe-engineering/webview-client-go/webview"
)

func main() {
	ctx := context.Background()

	loadContent := webview.ContentFrom(webview.NewHtmlContent("<h1>Hello, World!</h1>"))
	
	options := webview.Options{
		Title:    "Simple",
		Devtools: boolPtr(true),
		Load: &loadContent,
		InitializationScript: strPtr("console.log('This is printed from initializationScript!')"),
	}

	wv, err := webview.NewWebView(ctx, options)
	if err != nil {
		log.Fatal(err)
	}
	defer wv.Close()

	// Register event handler for "started" event
	wv.On("started", func(event interface{}) {
		fmt.Println("WebView started!")
		
		// Set title
		if err := wv.SetTitle("Title set from Go"); err != nil {
			log.Printf("Failed to set title: %v", err)
		}

		// Open dev tools
		if err := wv.OpenDevTools(); err != nil {
			log.Printf("Failed to open dev tools: %v", err)
		}

		// Evaluate JavaScript
		result, err := wv.Eval("console.log('This is printed from eval!'); 'Hello from Go!'")
		if err != nil {
			log.Printf("Failed to eval JS: %v", err)
		} else {
			fmt.Printf("JS result: %v\n", result)
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