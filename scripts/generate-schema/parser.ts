import { walk } from "https://deno.land/std@0.190.0/fs/walk.ts";
import { basename } from "https://deno.land/std@0.190.0/path/mod.ts";
import { match, P } from "npm:ts-pattern";
import type { JSONSchema, JSONSchemaTypeName } from "../json-schema.d.ts";

const schemasDir = new URL("../schemas", import.meta.url).pathname;
const outputFile =
  new URL("../src/clients/deno/schemas.ts", import.meta.url).pathname;

// defining an IR
export interface Doc {
  type: "doc";
  title: string;
  description?: string;
  root: Node;
}
export type Node =
  & { description?: string }
  & (
    | {
      type: "descriminated-union";
      name?: string;
      descriminator: string;
      members: Node[];
    }
    | { type: "intersection"; name?: string; members: Node[] }
    | { type: "union"; name?: string; members: Node[] }
    | {
      type: "object";
      name?: string;
      properties: {
        key: string;
        required: boolean;
        description?: string;
        value: Node;
      }[];
    }
    | { type: "record"; name?: string; valueType: string }
    | { type: "boolean"; name?: string; optional?: boolean }
    | { type: "string"; name?: string; optional?: boolean }
    | { type: "literal"; name?: string; value: string }
    | { type: "int"; name?: string; minimum?: number; maximum?: number }
    | { type: "float"; name?: string; minimum?: number; maximum?: number }
    | { type: "unknown"; name?: string }
  );

export const isComplexType = (node: Node) => {
  return node.type === "descriminated-union" || node.type === "union" ||
    node.type === "intersection" || node.type === "object";
};

const isDescriminatedUnion = (def: JSONSchema[] | undefined) => {
  return def && typeof def[0] === "object" &&
    (def[0]?.required?.[0] + "").startsWith("$");
};

const isOptionalType =
  (typeOf: string) =>
  (type: JSONSchemaTypeName | JSONSchemaTypeName[] | undefined) => {
    if (type && Array.isArray(type) && type[0] === typeOf) {
      return true;
    }
    return false;
  };

const flattenUnion = (union: Node[], member: Node) => {
  if (member.type === "union") {
    return union.concat(member.members);
  }
  return union.concat(member);
};

export function parseSchema(schema: JSONSchema): Doc {
  const nodeToIR = (node: JSONSchema): Node => {
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
        { type: P.union("string", P.when(isOptionalType("string"))) },
        (node) => {
          const isOptional =
            Array.isArray(node.type) && node.type.includes("null") || false;
          if (node.enum) {
            if (node.enum.length === 1) {
              return {
                type: "literal" as const,
                value: node.enum[0] as string,
                name: node.title,
              };
            }
            return {
              type: "union" as const,
              name: node.title,
              members: node.enum.map((v) => ({
                type: "literal" as const,
                value: v as string,
              })),
            };
          }
          return ({
            type: "string" as const,
            name: node.title,
            optional: !!node.default || isOptional,
          });
        },
      )
      .with(
        { oneOf: P.when(isDescriminatedUnion) },
        (node) => ({
          type: "descriminated-union" as const,
          name: node.title,
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
      .with({ allOf: P.array() }, (node) => {
        if (node.allOf?.length === 1) {
          return nodeToIR(node.allOf[0] as JSONSchema);
        }
        return {
          type: "intersection" as const,
          name: node.title,
          members: node.allOf?.map((v) => nodeToIR(v as JSONSchema)) ?? [],
        };
      })
      .with(
        P.union({ oneOf: P.array() }, { anyOf: P.array() }),
        (node) => {
          const union = {
            type: "union" as const,
            name: node.title,
            members:
              ((node.oneOf ?? node.anyOf)?.map((v) =>
                nodeToIR(v as JSONSchema)
              ) ?? [])
                .filter((v) => v.type !== "unknown")
                .reduce(flattenUnion, [] as Node[]),
          };
          if (node.properties) {
            return ({
              type: "intersection" as const,
              name: node.title,
              members: [
                {
                  type: "object" as const,
                  properties: Object.entries(node.properties ?? {}).map((
                    [key, value],
                  ) => ({
                    key,
                    required: node.required?.includes(key) ?? false,
                    description: (value as JSONSchema).description,
                    value: {
                      ...nodeToIR(value as JSONSchema),
                      name: key,
                    },
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
        { type: P.union("object", P.when(isOptionalType("object"))) },
        () => {
          if (Object.keys(node.properties ?? {}).length === 0) {
            if (
              typeof node.additionalProperties === "object" &&
              "type" in node.additionalProperties
            ) {
              return {
                type: "record" as const,
                name: node.title,
                description: node.description,
                valueType: typeof node.additionalProperties.type === "string"
                  ? node.additionalProperties.type
                  : "unknown",
              };
            }
            return {
              type: "record" as const,
              name: node.title,
              description: node.description,
              valueType: "unknown",
            };
          }
          return ({
            type: "object" as const,
            name: node.title,
            description: node.description,
            properties: Object.entries(node.properties ?? {}).map((
              [key, value],
            ) => ({
              key,
              required: node.required?.includes(key) ?? false,
              description: (value as JSONSchema).description,
              value: {
                ...nodeToIR(value as JSONSchema),
                name: key,
              },
            })),
          });
        },
      )
      .otherwise(() => ({ type: "unknown", name: node.title }));
  };
  return {
    type: "doc",
    title: schema.title!,
    description: schema.description,
    root: nodeToIR(schema),
  };
}
