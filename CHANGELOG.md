# Changelog

## 0.0.9 (binary 0.1.8) -- 2024-09-23

- Adds a `getVersion` method to `Webview` that returns the binary version.
- Adds a check on startup that compares the expected version to the current version.
- Adds slightly more graceful error handling to deserialization errors in the deno code.

## 0.0.8 (binary 0.1.7) -- 2024-09-23

NOTE: The binary version was bumped this release, but it doesn't actually have changes.
This is just me forcing a new release to be published.

- Fixed the release URL to ensure the download comes from the correct place

## 0.0.7 (binary 0.1.6) -- 2024-09-23

- Added this changelog
- Add the ability to show and hide the webview window via `.setVisibility(true/false)`
- Added the ability to check if the webview window is visible via `.isVisible()`

## 0.0.6 (binary 0.1.5) -- 2024-09-23

- Fixed a bug where `.on` and `.once` weren't firing for the webview's lifecycle events

## 0.0.5 (binary 0.1.5) -- 2024-09-23

- Improved type generation to avoid publishing slow types to JSR

## 0.0.4 (binary 0.1.5) -- 2024-09-22

- Added examples, doc comments to code
