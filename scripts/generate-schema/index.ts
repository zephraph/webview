import { walk } from "https://deno.land/std@0.190.0/fs/walk.ts";
import { basename, join } from "https://deno.land/std@0.190.0/path/mod.ts";
import { parse } from "https://deno.land/std@0.190.0/flags/mod.ts";
import type { JSONSchema } from "../../json-schema.d.ts";
import { generateTypeScript } from "./gen-typescript.ts";
import { parseSchema } from "./parser.ts";

const schemasDir = new URL("../../schemas", import.meta.url).pathname;
const tsSchemaDir =
  new URL("../../src/clients/deno/schemas", import.meta.url).pathname;

async function ensureDir(dir: string) {
  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

async function main() {
  const flags = parse(Deno.args, {
    string: ["language"],
    alias: { language: "l" },
  });

  const language = flags.language?.toLowerCase();

  const relativePath = new URL(import.meta.url).pathname.split("/").slice(-2)
    .join("/");

  // Only ensure directories for the languages we'll generate
  if (!language || language === "typescript") {
    await ensureDir(tsSchemaDir);
  }

  const entries = [];
  for await (const entry of walk(schemasDir, { exts: [".json"] })) {
    if (entry.isFile) {
      entries.push(entry);
    }
  }

  // Sort files so that the generated code is deterministic
  const files = entries.sort((a, b) => a.path < b.path ? -1 : 1);

  for (const file of files) {
    const jsonSchema: JSONSchema = JSON.parse(
      await Deno.readTextFile(file.path),
    );

    const name = basename(file.name, ".json");
    const doc = parseSchema(jsonSchema);

    if (!language || language === "typescript") {
      const tsContent = generateTypeScript(
        doc,
        name,
        relativePath,
      );
      const tsFilePath = join(tsSchemaDir, `${name}.ts`);
      await Deno.writeTextFile(tsFilePath, tsContent);
      console.log(`Generated TypeScript schema: ${tsFilePath}`);
    }
  }

  // Run deno fmt on TypeScript files if they were generated
  if (!language || language === "typescript") {
    const command = new Deno.Command("deno", {
      args: ["fmt", tsSchemaDir],
    });
    await command.output();
  }
}

main().catch(console.error);
