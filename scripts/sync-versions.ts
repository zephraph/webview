/**
 * Keeps the version of the WebView binary in sync with the version in Cargo.toml.
 */

import { parse } from "jsr:@std/toml";

const latestVersion = await Deno
  .readTextFile("./Cargo.toml").then((text) =>
    parse(text) as { package: { version: string } }
  ).then((config) => config.package.version);

// Read the content of src/lib.ts
const libPath = "./src/lib.ts";
const libContent = await Deno.readTextFile(libPath);

// Replace the version in the URL
const updatedContent = libContent.replace(
  /const BIN_VERSION = "[^"]+"/,
  `const BIN_VERSION = "${latestVersion}"`,
);

// Write the updated content back to src/lib.ts
await Deno.writeTextFile(libPath, updatedContent);

console.log(`Updated WebView binary version to ${latestVersion} in src/lib.ts`);
