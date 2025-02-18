/**
 * Synchronizes version numbers across the project:
 * - Updates BIN_VERSION in Deno client (main.ts)
 * - Updates package version in Python client (pyproject.toml)
 * - Updates BIN_VERSION in Python client (__init__.py)
 *
 * All versions are synchronized with the main version from Cargo.toml
 */

import { parse } from "jsr:@std/toml";

// Read the source version from Cargo.toml
const latestVersion = await Deno
  .readTextFile("./Cargo.toml").then((text) =>
    parse(text) as { package: { version: string } }
  ).then((config) => config.package.version);

// ===== Update Deno Client Version =====
const denoPath = "./src/clients/deno/main.ts";
const denoContent = await Deno.readTextFile(denoPath);

const updatedDenoContent = denoContent.replace(
  /const BIN_VERSION = "[^"]+"/,
  `const BIN_VERSION = "${latestVersion}"`,
);

await Deno.writeTextFile(denoPath, updatedDenoContent);
console.log(`✓ Updated Deno BIN_VERSION to ${latestVersion}`);

// ===== Update Python Client BIN_VERSION =====
const pythonInitPath = "./src/clients/python/src/webview_python/__init__.py";
const pythonInitContent = await Deno.readTextFile(pythonInitPath);

const updatedPythonInitContent = pythonInitContent.replace(
  /BIN_VERSION = "[^"]+"/,
  `BIN_VERSION = "${latestVersion}"`,
);

await Deno.writeTextFile(pythonInitPath, updatedPythonInitContent);
console.log(`✓ Updated Python BIN_VERSION to ${latestVersion}`);

console.log(`\n🎉 Successfully synchronized all versions to ${latestVersion}`);
