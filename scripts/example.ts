import $ from "jsr:@david/dax";

const [example] = Deno.args;

if (!example) {
  throw new Error("Example not provided");
}

await $`deno task build`;
await $`export WEBVIEW_BIN=./target/debug/deno-webview && deno run -E -R --allow-run examples/${example}.ts`;
