import { walk } from "https://deno.land/std@0.190.0/fs/walk.ts";
import { basename } from "https://deno.land/std@0.190.0/path/mod.ts";
import { match, P } from "npm:ts-pattern";
import type {
  JSONSchema7 as JSONSchema,
  JSONSchema7Definition as JSONSchemaDefinition,
  JSONSchema7TypeName,
} from "npm:@types/json-schema";

const schemasDir = new URL("../schemas", import.meta.url).pathname;
const outputFile = new URL("../src/schemas.ts", import.meta.url).pathname;

// defining an IR
interface DocIR {
  type: "doc";
  title: string;
  description?: string;
  root: NodeIR;
}
type NodeIR =
  | {
    type: "descriminated-union";
    descriminator: string;
    members: NodeIR[];
  }
  | { type: "intersection"; members: NodeIR[] }
  | { type: "union"; members: NodeIR[] }
  | {
    type: "object";
    properties: {
      key: string;
      required: boolean;
      description?: string;
      value: NodeIR;
    }[];
  }
  | { type: "boolean"; optional?: boolean }
  | { type: "string"; optional?: boolean }
  | { type: "literal"; value: string }
  | { type: "int"; minimum?: number; maximum?: number }
  | { type: "float"; minimum?: number; maximum?: number }
  | { type: "unknown" };

const isDescriminatedUnion = (def: JSONSchemaDefinition[] | undefined) => {
  return def && typeof def[0] === "object" &&
    (def[0]?.required?.[0] + "").startsWith("$");
};

const isOptionalType =
  (typeOf: string) =>
  (type: JSONSchema7TypeName | JSONSchema7TypeName[] | undefined) => {
    if (type && Array.isArray(type) && type[0] === typeOf) {
      return true;
    }
    return false;
  };

function jsonSchemaToIR(schema: JSONSchema): DocIR {
  const nodeToIR = (node: JSONSchema): NodeIR => {
    return match(node)
      .with(
        {
          type: P.union("boolean", P.when(isOptionalType("boolean"))),
        },
        (node) =>
          ({
            type: "boolean" as const,
            optional: !!node.default,
          }) as const,
      )
      .with({ type: "integer" }, (node) => ({
        type: "int" as const,
        minimum: node.minimum,
        maximum: node.maximum,
      }))
      .with({ type: "number", format: "double" }, (node) => ({
        type: "float" as const,
        minimum: node.minimum,
        maximum: node.maximum,
      }))
      .with(
        { type: "string" },
        (node) => {
          if (node.enum) {
            if (node.enum.length === 1) {
              return {
                type: "literal" as const,
                value: node.enum[0] as string,
              };
            }
            return {
              type: "union" as const,
              members: node.enum.map((v) => ({
                type: "literal" as const,
                value: v as string,
              })),
            };
          }
          return ({ type: "string" as const, optional: !!node.default });
        },
      )
      .with(
        { oneOf: P.when(isDescriminatedUnion) },
        (node) => ({
          type: "descriminated-union" as const,
          descriminator: (node.oneOf?.[0] as JSONSchema).required?.[0]!,
          members: node.oneOf?.map((v) => nodeToIR(v as JSONSchema)) ?? [],
        }),
      )
      .with(
        { $ref: P.string },
        (node) =>
          nodeToIR(
            schema.definitions![node.$ref.split("/").pop()!] as JSONSchema,
          ),
      )
      .with(
        { oneOf: P.array() },
        (node) => {
          const union = {
            type: "union" as const,
            members: node.oneOf?.map((v) => nodeToIR(v as JSONSchema)) ?? [],
          };
          if (node.properties) {
            return ({
              type: "intersection" as const,
              members: [
                {
                  type: "object" as const,
                  properties: Object.entries(node.properties ?? {}).map((
                    [key, value],
                  ) => ({
                    key,
                    required: node.required?.includes(key) ?? false,
                    description: (value as JSONSchema).description,
                    value: nodeToIR(value as JSONSchema),
                  })),
                },
                union,
              ],
            });
          }
          return union;
        },
      )
      .with(
        { anyOf: P.array() },
        () => ({
          type: "union" as const,
          members: (node.anyOf?.map((v) => nodeToIR(v as JSONSchema)) ?? [])
            .filter((v) => v.type !== "unknown")
            // flatten nested unions
            .reduce((union, member) => {
              if (member.type === "union") {
                return union.concat(member.members);
              }
              return union.concat(member);
            }, [] as NodeIR[]),
        }),
      )
      .with(
        { type: "object" },
        () => ({
          type: "object" as const,
          properties: Object.entries(node.properties ?? {}).map((
            [key, value],
          ) => {
            return ({
              key,
              required: node.required?.includes(key) ?? false,
              value: nodeToIR(value as JSONSchema),
            });
          }),
        }),
      )
      .otherwise(() => ({ type: "unknown" }));
  };
  return {
    type: "doc",
    title: schema.title!,
    description: schema.description,
    root: nodeToIR(schema),
  };
}

function generateTypes(ir: DocIR) {
  let result = "";
  const w = (...t: (string | false | undefined | null | 0)[]) => {
    result += t.filter((t) => t).join(" ");
  };
  const wn = (...t: (string | false | undefined | null | 0)[]) => w(...t, "\n");

  wn("/**");
  wn(` * ${ir.description}`);
  wn(" */");
  wn("export type", ir.title, " = ");
  generateNode(ir.root);

  function generateNode(node: NodeIR) {
    match(node)
      .with({ type: "int" }, () => w("number"))
      .with({ type: "float" }, () => w("number"))
      .with({ type: "boolean" }, () => w("boolean"))
      .with({ type: "string" }, () => w("string"))
      .with({ type: "literal" }, (node) => w(`"${node.value}"`))
      .with({ type: "object" }, (node) => {
        wn("{");
        for (const { key, required, description, value } of node.properties) {
          if (description) {
            if (description.includes("\n")) {
              wn(`/**`);
              for (const line of description.split("\n")) {
                wn(` * ${line}`);
              }
              wn(` */`);
            } else {
              wn(`/** ${description} */`);
            }
          }
          w(key, required ? ": " : "? : ");
          generateNode(value);
          wn(",");
        }
        wn("}");
      })
      .with({ type: "intersection" }, (node) => {
        wn("(");
        for (const member of node.members) {
          w("& ");
          generateNode(member);
        }
        wn(")");
      })
      .with({ type: P.union("union", "descriminated-union") }, (node) => {
        wn("(");
        for (const member of node.members) {
          w("| ");
          generateNode(member);
        }
        wn(")");
      })
      .with({ type: "unknown" }, () => w("unknown"))
      .exhaustive();
  }
  return result;
}

function generateZodSchema(ir: DocIR) {
  let result = "";
  const w = (...t: (string | false | undefined | null | 0)[]) => {
    result += t.filter((t) => t).join(" ");
  };
  const wn = (...t: (string | false | undefined | null | 0)[]) => w(...t, "\n");

  wn("export const", ir.title, `: z.ZodType<${ir.title}> =`);
  generateNode(ir.root);
  wn("");

  function generateNode(node: NodeIR) {
    match(node)
      .with({ type: "int" }, (node) => {
        w("z.number().int()");
        if (typeof node.minimum === "number") {
          w(`.min(${node.minimum})`);
        }
        if (typeof node.maximum === "number") {
          w(`.max(${node.maximum})`);
        }
      })
      .with({ type: "float" }, (node) => {
        w("z.number()");
        if (typeof node.minimum === "number") {
          w(`.min(${node.minimum})`);
        }
        if (typeof node.maximum === "number") {
          w(`.max(${node.maximum})`);
        }
      })
      .with(
        { type: "boolean" },
        (node) => w("z.boolean()", node.optional && ".optional()"),
      )
      .with(
        { type: "string" },
        (node) => w("z.string()", node.optional && ".optional()"),
      )
      .with(
        { type: "literal" },
        (node) => w(`z.literal("${node.value}")`),
      )
      .with({ type: "object" }, (node) => {
        w("z.object({");
        for (const { key, required, value } of node.properties) {
          w(key, ":");
          generateNode(value);
          if (!required && !("optional" in value && value.optional)) {
            w(".optional()");
          }
          w(",");
        }
        wn("})");
      })
      .with({ type: "descriminated-union" }, (node) => {
        w(`z.discriminatedUnion("${node.descriminator}", [`);
        for (const member of node.members) {
          generateNode(member);
          w(",");
        }
        wn("])");
      })
      .with({ type: "intersection" }, (node) => {
        w("z.intersection(");
        for (const member of node.members) {
          generateNode(member);
          w(",");
        }
        wn(")");
      })
      .with({ type: "union" }, (node) => {
        w("z.union([");
        for (const member of node.members) {
          generateNode(member);
          w(",");
        }
        wn("])");
      })
      .with({ type: "unknown" }, () => w("z.unknown()"))
      .exhaustive();
  }

  return result;
}

async function main() {
  let output =
    "// DO NOT EDIT: This file is auto-generated by scripts/generate-zod.ts\n" +
    "import { z } from 'npm:zod';\n\n";

  for await (const entry of walk(schemasDir, { exts: [".json"] })) {
    if (entry.isFile) {
      const jsonSchema: JSONSchema = JSON.parse(
        await Deno.readTextFile(entry.path),
      );
      jsonSchema.title = basename(entry.name, ".json");

      const ir = jsonSchemaToIR(jsonSchema);
      output += generateTypes(ir);
      output += generateZodSchema(ir);
    }
  }

  await Deno.writeTextFile(outputFile, output);
  console.log(`Generated Zod schemas: ${outputFile}`);

  // Run deno fmt on the generated file
  const command = new Deno.Command("deno", {
    args: ["fmt", outputFile],
  });
  await command.output();
}

main().catch(console.error);
