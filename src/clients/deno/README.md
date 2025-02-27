# @justbe/webview Deno Client

A light, cross-platform library for building web-based desktop apps with
[Deno](https://deno.com/).

## Installation

```typescript
import { createWebView } from "jsr:@justbe/webview";
```

## Example

```typescript
import { createWebView } from "jsr:@justbe/webview";

using webview = await createWebView({
  title: "Example",
  html: "<h1>Hello, World!</h1>",
  devtools: true,
});

webview.on("started", async () => {
  await webview.openDevTools();
  await webview.eval("console.log('This is printed from eval!')");
});

await webview.waitUntilClosed();
```

You can run this yourself with:

```sh
deno run https://raw.githubusercontent.com/zephraph/webview/refs/heads/main/examples/simple.ts
```

Check out the [examples directory](examples/) for more examples.

## Permissions

When executing this package, it checks to see if you have the required binary
for interfacing with the OS's webview. If it doesn't exist, it downloads it to a
cache directory and executes it. This yields a few different permission code
paths to be aware of.

### Binary not in cache

This will be true of a first run of the package. These are the following
permission requests you can expect to see:

- Read HOME env -- Used to locate the cache directory
- Read <cache>/webview/webview-<version> -- Tries to read the binary from cache
- net to github.com:443 -- Connects to GitHub releases to try to download the
  binary (will be redirected)
- net to objects.githubusercontent.com:443 -- GitHub's CDN for the actual
  download
- Read <cache>/webview/ -- Reads the cache directory
- Write <cache>/webview/webview-<version> -- Writes the binary
- Run <cache>/webview/webview-<version> -- Runs the binary

### Binary cached

On subsequent runs you can expect fewer permission requests:

- Read HOME env -- Use to locate the cache directory
- Read <cache>/deno-webview/deno-webview-<version>
- Run <cache>/deno-webview/deno-webview-<version>

### Using a Custom Binary

You can specify a custom binary path using the `WEBVIEW_BIN` environment
variable. When set and allowed, this will bypass the default binary resolution
process. In this case, only one permission is needed:

- Run <WEBVIEW_BIN>

Note that this environment variable will never be _explicitly_ requested. If the
script detects it's not allowed to read this env var it just skips this code
path altogether.
