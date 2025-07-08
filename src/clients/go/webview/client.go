package webview

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
)

// BinVersion should match the cargo package version
const BinVersion = "0.3.1"

// EventHandler is a function type for handling webview events
type EventHandler func(event interface{})

// WebView represents a webview instance
type WebView struct {
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    io.ReadCloser
	stderr    io.ReadCloser
	messageID int
	mutex     sync.RWMutex
	handlers  map[string][]EventHandler
	responses map[int]chan Response
	ctx       context.Context
	cancel    context.CancelFunc
	done      chan struct{}
}

// NewWebView creates a new webview instance
func NewWebView(ctx context.Context, options Options) (*WebView, error) {
	binPath, err := getWebViewBin(options)
	if err != nil {
		return nil, fmt.Errorf("failed to get webview binary: %w", err)
	}

	optionsJSON, err := json.Marshal(options)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal options: %w", err)
	}

	cmd := exec.CommandContext(ctx, binPath, string(optionsJSON))
	
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	childCtx, cancel := context.WithCancel(ctx)

	wv := &WebView{
		cmd:       cmd,
		stdin:     stdin,
		stdout:    stdout,
		stderr:    stderr,
		handlers:  make(map[string][]EventHandler),
		responses: make(map[int]chan Response),
		ctx:       childCtx,
		cancel:    cancel,
		done:      make(chan struct{}),
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to start webview process: %w", err)
	}

	go wv.processMessages()
	go wv.processStderr()

	return wv, nil
}

// On registers an event handler for the specified event type
func (wv *WebView) On(eventType string, handler EventHandler) {
	wv.mutex.Lock()
	defer wv.mutex.Unlock()
	wv.handlers[eventType] = append(wv.handlers[eventType], handler)
}

// processMessages handles incoming messages from the webview process
func (wv *WebView) processMessages() {
	defer close(wv.done)
	defer wv.cancel()

	scanner := bufio.NewScanner(wv.stdout)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var message Message
		if err := json.Unmarshal([]byte(line), &message); err != nil {
			continue
		}

		wv.handleMessage(message)
	}
}

// processStderr handles stderr from the webview process
func (wv *WebView) processStderr() {
	scanner := bufio.NewScanner(wv.stderr)
	for scanner.Scan() {
		// For now, just print stderr to help with debugging
		fmt.Fprintf(os.Stderr, "webview stderr: %s\n", scanner.Text())
	}
}

// handleMessage processes incoming messages and dispatches events or responses
func (wv *WebView) handleMessage(message interface{}) {
	messageMap, ok := message.(map[string]interface{})
	if !ok {
		return
	}

	msgType, ok := messageMap["$type"].(string)
	if !ok {
		return
	}

	switch msgType {
	case "notification":
		wv.handleNotification(messageMap)
	case "response":
		wv.handleResponse(messageMap)
	}
}

// handleNotification processes notification messages
func (wv *WebView) handleNotification(messageMap map[string]interface{}) {
	data, ok := messageMap["data"].(map[string]interface{})
	if !ok {
		return
	}

	notificationType, ok := data["$type"].(string)
	if !ok {
		return
	}

	wv.mutex.RLock()
	handlers := wv.handlers[notificationType]
	wv.mutex.RUnlock()

	for _, handler := range handlers {
		go handler(data)
	}
}

// handleResponse processes response messages
func (wv *WebView) handleResponse(messageMap map[string]interface{}) {
	data, ok := messageMap["data"].(map[string]interface{})
	if !ok {
		return
	}

	idFloat, ok := data["id"].(float64)
	if !ok {
		return
	}
	id := int(idFloat)

	wv.mutex.RLock()
	responseChan, exists := wv.responses[id]
	wv.mutex.RUnlock()

	if exists {
		responseChan <- data
		close(responseChan)
		
		wv.mutex.Lock()
		delete(wv.responses, id)
		wv.mutex.Unlock()
	}
}

// send sends a request to the webview process and returns the response
func (wv *WebView) send(request map[string]interface{}) (Response, error) {
	wv.mutex.Lock()
	id := wv.messageID
	wv.messageID++
	responseChan := make(chan Response, 1)
	wv.responses[id] = responseChan
	wv.mutex.Unlock()

	request["id"] = id

	requestJSON, err := json.Marshal(request)
	if err != nil {
		wv.mutex.Lock()
		delete(wv.responses, id)
		wv.mutex.Unlock()
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	if _, err := wv.stdin.Write(append(requestJSON, '\n')); err != nil {
		wv.mutex.Lock()
		delete(wv.responses, id)
		wv.mutex.Unlock()
		return nil, fmt.Errorf("failed to write request: %w", err)
	}

	select {
	case response := <-responseChan:
		return response, nil
	case <-wv.ctx.Done():
		return nil, wv.ctx.Err()
	}
}

// Eval executes JavaScript in the webview
func (wv *WebView) Eval(js string) (interface{}, error) {
	request := map[string]interface{}{
		"$type": "eval",
		"js":    js,
	}

	response, err := wv.send(request)
	if err != nil {
		return nil, err
	}

	responseMap, ok := response.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("invalid response format")
	}

	responseType, ok := responseMap["$type"].(string)
	if !ok {
		return nil, fmt.Errorf("missing response type")
	}

	switch responseType {
	case "result":
		result, ok := responseMap["result"].(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("invalid result format")
		}
		return result["value"], nil
	case "err":
		message, _ := responseMap["message"].(string)
		return nil, fmt.Errorf("webview error: %s", message)
	default:
		return nil, fmt.Errorf("unexpected response type: %s", responseType)
	}
}

// OpenDevTools opens the developer tools
func (wv *WebView) OpenDevTools() error {
	request := map[string]interface{}{
		"$type": "openDevTools",
	}

	response, err := wv.send(request)
	if err != nil {
		return err
	}

	responseMap, ok := response.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid response format")
	}

	responseType, ok := responseMap["$type"].(string)
	if !ok {
		return fmt.Errorf("missing response type")
	}

	switch responseType {
	case "ack":
		return nil
	case "err":
		message, _ := responseMap["message"].(string)
		return fmt.Errorf("webview error: %s", message)
	default:
		return fmt.Errorf("unexpected response type: %s", responseType)
	}
}

// SetTitle sets the window title
func (wv *WebView) SetTitle(title string) error {
	request := map[string]interface{}{
		"$type": "setTitle",
		"title": title,
	}

	response, err := wv.send(request)
	if err != nil {
		return err
	}

	responseMap, ok := response.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid response format")
	}

	responseType, ok := responseMap["$type"].(string)
	if !ok {
		return fmt.Errorf("missing response type")
	}

	switch responseType {
	case "ack":
		return nil
	case "err":
		message, _ := responseMap["message"].(string)
		return fmt.Errorf("webview error: %s", message)
	default:
		return fmt.Errorf("unexpected response type: %s", responseType)
	}
}

// LoadHTML loads HTML content into the webview
func (wv *WebView) LoadHTML(html string, origin string) error {
	request := map[string]interface{}{
		"$type": "loadHtml",
		"html":  html,
	}

	if origin != "" {
		request["origin"] = origin
	}

	response, err := wv.send(request)
	if err != nil {
		return err
	}

	responseMap, ok := response.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid response format")
	}

	responseType, ok := responseMap["$type"].(string)
	if !ok {
		return fmt.Errorf("missing response type")
	}

	switch responseType {
	case "ack":
		return nil
	case "err":
		message, _ := responseMap["message"].(string)
		return fmt.Errorf("webview error: %s", message)
	default:
		return fmt.Errorf("unexpected response type: %s", responseType)
	}
}

// LoadURL loads a URL into the webview
func (wv *WebView) LoadURL(url string, headers map[string]string) error {
	request := map[string]interface{}{
		"$type": "loadUrl",
		"url":   url,
	}

	if headers != nil {
		request["headers"] = headers
	}

	response, err := wv.send(request)
	if err != nil {
		return err
	}

	responseMap, ok := response.(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid response format")
	}

	responseType, ok := responseMap["$type"].(string)
	if !ok {
		return fmt.Errorf("missing response type")
	}

	switch responseType {
	case "ack":
		return nil
	case "err":
		message, _ := responseMap["message"].(string)
		return fmt.Errorf("webview error: %s", message)
	default:
		return fmt.Errorf("unexpected response type: %s", responseType)
	}
}

// Wait waits for the webview process to finish
func (wv *WebView) Wait() error {
	<-wv.done
	return wv.cmd.Wait()
}

// Close closes the webview
func (wv *WebView) Close() error {
	wv.cancel()
	if err := wv.stdin.Close(); err != nil {
		// Stdin close errors are not critical for cleanup
		_ = err
	}
	return wv.cmd.Process.Kill()
}

// getWebViewBin gets the path to the webview binary, downloading it if necessary
func getWebViewBin(options Options) (string, error) {
	// Check for WEBVIEW_BIN environment variable
	if binPath := os.Getenv("WEBVIEW_BIN"); binPath != "" {
		return binPath, nil
	}

	flags := ""
	if options.Devtools != nil && *options.Devtools {
		flags = "-devtools"
	} else if options.Transparent != nil && *options.Transparent && runtime.GOOS == "darwin" {
		flags = "-transparent"
	}

	cacheDir := getCacheDir()
	fileName := fmt.Sprintf("webview-%s%s", BinVersion, flags)
	if runtime.GOOS == "windows" {
		fileName += ".exe"
	}
	filePath := filepath.Join(cacheDir, fileName)

	// Check if the file already exists in cache
	if _, err := os.Stat(filePath); err == nil {
		return filePath, nil
	}

	// If not in cache, download it
	url := fmt.Sprintf("https://github.com/zephraph/webview/releases/download/webview-v%s/webview", BinVersion)
	
	switch runtime.GOOS {
	case "darwin":
		url += "-mac"
		if runtime.GOARCH == "arm64" {
			url += "-arm64"
		}
		url += flags
	case "linux":
		url += "-linux" + flags
	case "windows":
		url += "-windows" + flags + ".exe"
	default:
		return "", fmt.Errorf("unsupported OS: %s", runtime.GOOS)
	}

	// Download the binary
	resp, err := http.Get(url)
	if err != nil {
		return "", fmt.Errorf("failed to download webview binary: %w", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			// Response body close errors are typically not critical
			_ = err
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download webview binary: HTTP %d", resp.StatusCode)
	}

	// Ensure the cache directory exists
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create cache directory: %w", err)
	}

	// Write the binary to disk
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return "", fmt.Errorf("failed to create binary file: %w", err)
	}
	defer func() {
		if err := file.Close(); err != nil {
			// File close errors are typically not critical
			_ = err
		}
	}()

	if _, err := io.Copy(file, resp.Body); err != nil {
		return "", fmt.Errorf("failed to write binary file: %w", err)
	}

	return filePath, nil
}

// getCacheDir returns the OS-specific cache directory
func getCacheDir() string {
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(os.Getenv("HOME"), "Library", "Caches", "webview")
	case "linux":
		return filepath.Join(os.Getenv("HOME"), ".cache", "webview")
	case "windows":
		return filepath.Join(os.Getenv("LOCALAPPDATA"), "webview", "Cache")
	default:
		return filepath.Join(os.TempDir(), "webview")
	}
}