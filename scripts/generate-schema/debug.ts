import { parseSchema } from "./parser.ts";
import { printDocIR } from "./printer.ts";

const schemaFiles = [
  "WebViewOptions.json",
  "WebViewRequest.json",
  "WebViewResponse.json",
  "WebViewMessage.json",
];

async function main() {
  const targetSchema = Deno.args[0];
  const filesToProcess = targetSchema
    ? [targetSchema.endsWith(".json") ? targetSchema : `${targetSchema}.json`]
    : schemaFiles;

  for (const schemaFile of filesToProcess) {
    if (!schemaFiles.includes(schemaFile)) {
      console.error(`Invalid schema file: ${schemaFile}`);
      console.error(`Available schemas: ${schemaFiles.join(", ")}`);
      Deno.exit(1);
    }

    console.log(`Schema: ${schemaFile}`);

    const schema = JSON.parse(await Deno.readTextFile(`schemas/${schemaFile}`));
    const doc = parseSchema(schema);
    console.log(printDocIR(doc));
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
