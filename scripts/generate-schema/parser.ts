import { match, P } from "npm:ts-pattern";
import type { JSONSchema, JSONSchemaTypeName } from "../../json-schema.d.ts";
import { assert } from "jsr:@std/assert";

// defining an IR
export interface Doc {
  type: "doc";
  title: string;
  description?: string;
  root: Node;
  definitions: Record<string, Node & { description?: string }>;
}
export type Node =
  & { name?: string; description?: string }
  & (
    | {
      type: "descriminated-union";
      name?: string;
      descriminator: string;
      members: Record<string, {
        key: string;
        required: boolean;
        description?: string;
        value: Node;
      }[]>;
    }
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
    | { type: "intersection"; name?: string; members: Node[] }
    | { type: "union"; name?: string; members: Node[] }
    | { type: "enum"; members: string[] }
    | { type: "record"; valueType: string }
    | { type: "boolean"; optional?: boolean }
    | { type: "string"; optional?: boolean }
    | { type: "literal"; value: string }
    | { type: "int"; minimum?: number; maximum?: number }
    | { type: "float"; minimum?: number; maximum?: number }
    | { type: "reference"; name: string }
    | { type: "unknown" }
  );

// Find all references in a node recursively
function findReferences(node: Node): Set<string> {
  const refs = new Set<string>();

  if (node.type === "reference") {
    refs.add(node.name);
  } else if (node.type === "descriminated-union") {
    for (const member of Object.values(node.members).flat()) {
      for (const ref of findReferences(member.value)) {
        refs.add(ref);
      }
    }
  } else if (
    node.type === "union" ||
    node.type === "intersection"
  ) {
    for (const member of node.members) {
      for (const ref of findReferences(member)) {
        refs.add(ref);
      }
    }
  } else if (node.type === "object") {
    for (const prop of node.properties) {
      for (const ref of findReferences(prop.value)) {
        refs.add(ref);
      }
    }
  }

  return refs;
}

// Detect cycles in the dependency graph
function detectCycle(
  graph: Map<string, Set<string>>,
  node: string,
  visited: Set<string>,
  path: Set<string>,
): string[] | null {
  if (path.has(node)) {
    const cycle = Array.from(path);
    const startIdx = cycle.indexOf(node);
    return cycle.slice(startIdx).concat(node);
  }

  if (visited.has(node)) return null;

  visited.add(node);
  path.add(node);

  const deps = graph.get(node) || new Set();
  for (const dep of deps) {
    const cycle = detectCycle(graph, dep, visited, path);
    if (cycle) return cycle;
  }

  path.delete(node);
  return null;
}

// Sort definitions topologically
function sortDefinitions(
  definitions: Record<string, Node>,
): Record<string, Node> {
  // Build dependency graph
  const graph = new Map<string, Set<string>>();
  for (const [name, def] of Object.entries(definitions)) {
    graph.set(name, findReferences(def));
  }

  // Check for cycles
  const cycle = detectCycle(
    graph,
    Object.keys(definitions)[0],
    new Set(),
    new Set(),
  );
  if (cycle) {
    throw new Error(`Circular reference detected: ${cycle.join(" -> ")}`);
  }

  // Topological sort
  const sorted: string[] = [];
  const visited = new Set<string>();

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);

    const deps = graph.get(name) || new Set();
    for (const dep of deps) {
      visit(dep);
    }

    sorted.push(name);
  }

  for (const name of Object.keys(definitions)) {
    visit(name);
  }

  // Reconstruct definitions object in sorted order
  return Object.fromEntries(
    sorted.map((name) => [name, { ...definitions[name], name }]),
  );
}

export const isComplexType = (node: Node) => {
  return node.type === "descriminated-union" || node.type === "union" ||
    node.type === "intersection" || node.type === "object";
};

const isDescriminatedUnion = (def: JSONSchema[] | undefined) => {
  return def?.[0]?.required?.[0]?.startsWith("$");
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
      .with({ $ref: P.string }, (node) => ({
        type: "reference" as const,
        name: node.$ref.split("/").pop()!,
      }))
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
        ...(node.minimum !== undefined && { minimum: node.minimum }),
        ...(node.maximum !== undefined && { maximum: node.maximum }),
      }))
      .with({ type: "number", format: "double" }, (node) => ({
        type: "float" as const,
        ...(node.minimum !== undefined && { minimum: node.minimum }),
        ...(node.maximum !== undefined && { maximum: node.maximum }),
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
              };
            }
            return {
              type: "enum" as const,
              members: node.enum as string[],
            };
          }
          return ({
            type: "string" as const,
            optional: !!node.default || isOptional,
          });
        },
      )
      .with(
        { oneOf: P.when(isDescriminatedUnion) },
        (node) => {
          const descriminator = (node.oneOf?.[0] as JSONSchema).required?.[0]!;
          return ({
            type: "descriminated-union" as const,
            descriminator,
            members: Object.fromEntries(
              node.oneOf?.map((v) => {
                assert(
                  v.type === "object",
                  "Descriminated union must have an object member",
                );
                assert(
                  v.properties,
                  "Descriminated union arms must have properties",
                );
                const name = v.properties[descriminator]?.enum?.[0] as string;
                delete v.properties[descriminator];
                assert(name, "Descriminated union must have a name");
                return [
                  name,
                  Object.entries(v.properties ?? {}).map((
                    [key, value],
                  ) => ({
                    key,
                    required: v.required?.includes(key) ?? false,
                    ...(value.description &&
                      { description: value.description }),
                    value: nodeToIR(value as JSONSchema),
                  })),
                ];
              }) ?? [],
            ),
          });
        },
      )
      .with({ allOf: P.array() }, (node) => {
        if (node.allOf?.length === 1) {
          return nodeToIR(node.allOf[0] as JSONSchema);
        }
        return {
          type: "intersection" as const,
          members: node.allOf?.map((v) => nodeToIR(v as JSONSchema)) ?? [],
        };
      })
      .with(
        P.union({ oneOf: P.array() }, { anyOf: P.array() }),
        (node) => {
          if (
            node.anyOf && node.anyOf.length === 2 &&
            node.anyOf[1].type === "null"
          ) {
            return nodeToIR(node.anyOf[0] as JSONSchema);
          }
          const union = {
            type: "union" as const,
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
              members: [
                {
                  type: "object" as const,
                  properties: Object.entries(node.properties ?? {}).map((
                    [key, value],
                  ) => ({
                    key,
                    required: node.required?.includes(key) ?? false,
                    ...(value.description &&
                      { description: value.description }),
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
        { type: P.union("object", P.when(isOptionalType("object"))) },
        () => {
          if (Object.keys(node.properties ?? {}).length === 0) {
            if (
              typeof node.additionalProperties === "object" &&
              "type" in node.additionalProperties
            ) {
              return {
                type: "record" as const,
                ...(node.description && { description: node.description }),
                valueType: typeof node.additionalProperties.type === "string"
                  ? node.additionalProperties.type
                  : "unknown",
              };
            }
            return {
              type: "record" as const,
              ...(node.description && { description: node.description }),
              valueType: "unknown",
            };
          }
          return ({
            type: "object" as const,
            ...(node.description && { description: node.description }),
            properties: Object.entries(node.properties ?? {}).map((
              [key, value],
            ) => ({
              key,
              required: Boolean(
                node.required?.includes(key) ||
                  "anyOf" in value &&
                    !value.anyOf?.some((v) => v.type === "null"),
              ) || false,
              ...(value.description && { description: value.description }),
              value: nodeToIR(value as JSONSchema),
            })),
          });
        },
      )
      .otherwise(() => ({ type: "unknown" }));
  };

  const definitions = Object.fromEntries(
    Object.entries(schema.definitions ?? {}).map((
      [name, type],
    ) => [name, {
      ...(type.description && {
        description: type.description,
        name,
      }),
      ...nodeToIR(type as JSONSchema),
    }]),
  ) ?? {};

  return {
    type: "doc",
    title: schema.title!,
    ...(schema.description && { description: schema.description }),
    root: { ...nodeToIR(schema), name: schema.title! },
    definitions: sortDefinitions(definitions),
  };
}
