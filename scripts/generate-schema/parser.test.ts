import { assertEquals, assertThrows } from "jsr:@std/assert";
import { parseSchema } from "./parser.ts";
import type { JSONSchema } from "../../json-schema.d.ts";

// Helper to wrap a schema in a document with title and optional description
function makeSchema(
  schema: Partial<JSONSchema>,
  title = "Test",
  description?: string,
): JSONSchema {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title,
    description,
    ...schema,
  } as JSONSchema;
}

Deno.test("parses primitive types", () => {
  // String type
  assertEquals(
    parseSchema(makeSchema({ type: "string" })),
    {
      type: "doc",
      title: "Test",
      root: { type: "string", optional: false },
      definitions: {},
    },
  );

  // Boolean type
  assertEquals(
    parseSchema(makeSchema({ type: "boolean" })),
    {
      type: "doc",
      title: "Test",
      root: { type: "boolean", optional: false },
      definitions: {},
    },
  );

  // Integer type
  assertEquals(
    parseSchema(makeSchema({ type: "integer", minimum: 0, maximum: 100 })),
    {
      type: "doc",
      title: "Test",
      root: { type: "int", minimum: 0, maximum: 100 },
      definitions: {},
    },
  );

  // Float type
  assertEquals(
    parseSchema(makeSchema({ type: "number", format: "double" })),
    {
      type: "doc",
      title: "Test",
      root: { type: "float" },
      definitions: {},
    },
  );
});

Deno.test("parses string enums", () => {
  // Single value enum becomes literal
  assertEquals(
    parseSchema(makeSchema({ type: "string", enum: ["test"] })),
    {
      type: "doc",
      title: "Test",
      root: { type: "literal", value: "test" },
      definitions: {},
    },
  );

  // Multiple values become union
  assertEquals(
    parseSchema(makeSchema({ type: "string", enum: ["a", "b"] })),
    {
      type: "doc",
      title: "Test",
      root: {
        type: "union",
        members: [
          { type: "literal", value: "a" },
          { type: "literal", value: "b" },
        ],
      },
      definitions: {},
    },
  );
});

Deno.test("parses simple objects", () => {
  assertEquals(
    parseSchema(makeSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name"],
    })),
    {
      type: "doc",
      title: "Test",
      root: {
        type: "object",
        properties: [
          {
            key: "name",
            required: true,
            value: { type: "string", optional: false },
          },
          {
            key: "age",
            required: false,
            value: {
              type: "int",
            },
          },
        ],
      },
      definitions: {},
    },
  );
});

Deno.test("parses discriminated unions", () => {
  assertEquals(
    parseSchema(makeSchema({
      oneOf: [
        {
          type: "object",
          required: ["$type"],
          properties: {
            $type: { type: "string", enum: ["a"] },
            value: { type: "string" },
          },
        },
        {
          type: "object",
          required: ["$type"],
          properties: {
            $type: { type: "string", enum: ["b"] },
            count: { type: "integer" },
          },
        },
      ],
    })),
    {
      type: "doc",
      title: "Test",
      root: {
        type: "descriminated-union",
        descriminator: "$type",
        members: [
          {
            type: "object",
            properties: [
              {
                key: "$type",
                required: true,
                value: { type: "literal", value: "a" },
              },
              {
                key: "value",
                required: false,
                value: { type: "string", optional: false },
              },
            ],
          },
          {
            type: "object",
            properties: [
              {
                key: "$type",
                required: true,
                value: { type: "literal", value: "b" },
              },
              {
                key: "count",
                required: false,
                value: {
                  type: "int",
                },
              },
            ],
          },
        ],
      },
      definitions: {},
    },
  );
});

Deno.test("parses references", () => {
  assertEquals(
    parseSchema(makeSchema({
      definitions: {
        Point: {
          description: "A point in 2D space",
          type: "object",
          properties: {
            x: { type: "integer", description: "The x coordinate" },
            y: { type: "integer", description: "The y coordinate" },
          },
          required: ["x", "y"],
        },
      },
      $ref: "#/definitions/Point",
    })),
    {
      type: "doc",
      title: "Test",
      root: {
        type: "reference",
        name: "Point",
      },
      definitions: {
        Point: {
          description: "A point in 2D space",
          type: "object",
          properties: [
            {
              description: "The x coordinate",
              key: "x",
              required: true,
              value: {
                type: "int",
              },
            },
            {
              description: "The y coordinate",
              key: "y",
              required: true,

              value: {
                type: "int",
              },
            },
          ],
        },
      },
    },
  );
});

Deno.test("sorts definitions topologically", () => {
  assertEquals(
    parseSchema(makeSchema({
      definitions: {
        Container: {
          type: "object",
          properties: {
            point: { $ref: "#/definitions/Point" },
            size: { $ref: "#/definitions/Size" },
          },
        },
        Size: {
          type: "object",
          properties: {
            width: { type: "integer" },
            height: { type: "integer" },
          },
        },
        Point: {
          type: "object",
          properties: {
            x: { type: "integer" },
            y: { type: "integer" },
          },
        },
      },
      $ref: "#/definitions/Container",
    })),
    {
      type: "doc",
      title: "Test",
      root: {
        type: "reference",
        name: "Container",
      },
      definitions: {
        // Point and Size should come before Container since Container depends on them
        Point: {
          type: "object",
          properties: [
            {
              key: "x",
              required: false,
              value: { type: "int" },
            },
            {
              key: "y",
              required: false,
              value: { type: "int" },
            },
          ],
        },
        Size: {
          type: "object",
          properties: [
            {
              key: "width",
              required: false,
              value: { type: "int" },
            },
            {
              key: "height",
              required: false,
              value: { type: "int" },
            },
          ],
        },
        Container: {
          type: "object",
          properties: [
            {
              key: "point",
              required: false,
              value: { type: "reference", name: "Point" },
            },
            {
              key: "size",
              required: false,
              value: { type: "reference", name: "Size" },
            },
          ],
        },
      },
    },
  );
});

Deno.test("detects circular references", () => {
  assertThrows(
    () =>
      parseSchema(makeSchema({
        definitions: {
          A: {
            type: "object",
            properties: {
              b: { $ref: "#/definitions/B" },
            },
          },
          B: {
            type: "object",
            properties: {
              a: { $ref: "#/definitions/A" },
            },
          },
        },
        $ref: "#/definitions/A",
      })),
    Error,
    "Circular reference detected",
  );
});
