# @justbe/webview

A light, cross-platform library for building web-based desktop apps with [Deno](https://deno.com/).

> [!NOTE]  
> This is alpha level software that's rapidly changing. Things might break. Please let me know if you notice anything missing or not working.

## Example

```typescript
import { createWebView } from "jsr:@justbe/webview";

using webview = await createWebView({
  title: "Example",
  html: "<h1>Hello, World!</h1>",
  devtools: true
});

webview.on("started", async () => {
  await webview.openDevTools();
  await webview.eval("console.log('This is printed from eval!')");
});

await webview.waitUntilClosed();
```

You can run this yourself with

```sh
deno run https://raw.githubusercontent.com/zephraph/webview/refs/heads/main/examples/simple.ts
```

Checkout the [examples directory](https://github.com/zephraph/webview/tree/main/examples) for more.

## Permissions

When executing this package, it checks to see if you have the required binary for interfacing with the OS's webview. If it doesn't exist, it downloads it to a cache directory and executes it. This yields a few different permission code paths to be aware of.

### Binary not in cache

This will be true of a first run of the package. These are the following permission requests you can expect to see:

- Read HOME env -- Used to locate the cache directory
- Read <cache>/deno-webview/deno-webview-<version> -- Tries to read the binary from cache
- net to github.com:443 -- Connects to GitHub releases to try to download the binary (will be redirected)
- net to objects.githubusercontent.com:443 -- GitHub's CDN for the actual download
- Read <cache>/deno-webview/ -- Reads the cache directory
- Write <cache>/deno-webview/deno-webview-<version> -- Writes the binary
- Run <cache>/deno-webview/deno-webview-<version> -- Runs the binary

### Binary cached

On subsequent runs you can expect fewer permission requests:

- Read HOME env -- Use to locate the cache directory
- Read <cache>/deno-webview/deno-webview-<version>
- Run <cache>/deno-webview/deno-webview-<version>

### Allowed `WEBVIEW_BIN`

`WEBVIEW_BIN` is a special environment variable that, if present and allowed, will short circuit
the binary resolution process in favor of the path specified. In this case there will be only one permission:

- Run <WEBVIEW_BIN>

Note that this environment variable will never be _explicitly_ requested. If the script detects it's not allowed to read this env var it just skips this code path altogether.

## Contributing

This project uses [mise](https://mise.jdx.dev/) to manage runtimes (like deno, rust) and run scripts. If you'd like
to contribute, you'll need to install it. 

Use the `mise tasks` command to see what you can do. 