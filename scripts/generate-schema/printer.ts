import { match } from "npm:ts-pattern";
import { Doc, Node } from "./parser.ts";
import {
  blue,
  bold,
  dimmed,
  type Formatter,
  green,
  mix,
  yellow,
} from "jsr:@coven/terminal";

const comment = mix(yellow, dimmed);
const string = green;
const type = blue;
const kind = bold;

function wrapText(
  text: string,
  maxLength: number,
  indent: string,
  formatter?: Formatter,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= maxLength) {
      currentLine += (currentLine.length === 0 ? "" : " ") + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }
  return lines
    .map((line) => formatter ? formatter`${line}` : line)
    .map((line, i) => i === 0 ? line : indent + line);
}

function printNodeIR(
  node: Node,
  prefix: string = "",
  isLast: boolean = true,
): string {
  const marker = isLast ? "└── " : "├── ";
  const childPrefix = prefix + (isLast ? "    " : "│   ");

  return prefix + marker + match(node)
    .with({ type: "reference" }, ({ name }) => kind`${name}\n`)
    .with({ type: "descriminated-union" }, ({ descriminator, members }) => {
      let output = kind`discriminated-union` + ` (by ${descriminator})\n`;
      Object.entries(members).forEach(([name, properties], index) => {
        output += printNodeIR(
          { type: "object", name, properties },
          childPrefix,
          index === Object.values(members).length - 1,
        );
      });
      return output;
    })
    .with({ type: "intersection" }, ({ members }) => {
      let output = kind`intersection\n`;
      members.forEach((member, index) => {
        output += printNodeIR(
          member,
          childPrefix,
          index === members.length - 1,
        );
      });
      return output;
    })
    .with({ type: "union" }, ({ members }) => {
      let output = kind`union\n`;
      members.forEach((member, index) => {
        output += printNodeIR(
          member,
          childPrefix,
          index === members.length - 1,
        );
      });
      return output;
    })
    .with({ type: "object" }, ({ name, properties }) => {
      let output = kind`${name ?? "object"}\n`;
      properties.forEach(({ key, required, value, description }, index) => {
        description = description?.split("\n")[0];
        const propDesc = `${key}${required ? "" : "?"}: `;

        if (description) {
          const wrappedDesc = wrapText(
            description,
            96,
            childPrefix + "│   ",
            comment,
          )
            .join("\n");
          output += childPrefix + "│   " + `${wrappedDesc}\n`;
          output += childPrefix +
            (index === properties.length - 1 ? "└── " : "├── ");
        } else {
          output += childPrefix +
            (index === properties.length - 1 ? "└── " : "├── ");
        }

        const valueStr = match(value)
          .with(
            { type: "boolean" },
            ({ optional }) => type`boolean${optional ? "?" : ""}`,
          )
          .with(
            { type: "string" },
            ({ optional }) => type`string${optional ? "?" : ""}`,
          )
          .with({ type: "literal" }, ({ value }) => string`"${value}"`)
          .with(
            { type: "int" },
            ({ minimum, maximum }) =>
              type`int${minimum !== undefined ? ` min(${minimum})` : ""}${
                maximum !== undefined ? ` max(${maximum})` : ""
              }`,
          )
          .with(
            { type: "float" },
            ({ minimum, maximum }) =>
              type`float${minimum !== undefined ? ` min(${minimum})` : ""}${
                maximum !== undefined ? ` max(${maximum})` : ""
              }`,
          )
          .with(
            { type: "record" },
            ({ valueType }) => type`record<string, ${valueType}>`,
          )
          .with({ type: "unknown" }, () => "unknown")
          .with({ type: "reference" }, ({ name }) => name)
          .otherwise(() => {
            output += propDesc + "\n";
            return printNodeIR(
              value,
              childPrefix + (index === properties.length - 1 ? "    " : "│   "),
              true,
            );
          });

        if (
          value.type === "union" || value.type === "intersection" ||
          value.type === "descriminated-union" || value.type === "object"
        ) {
          output += valueStr;
        } else {
          output += propDesc + valueStr + "\n";
        }
      });
      return output;
    })
    .with({ type: "enum" }, ({ members }) => {
      return kind`enum` + `[${members.join(",")}]\n`;
    })
    .with(
      { type: "record" },
      ({ valueType }) => `record<string, ${valueType}>\n`,
    )
    .with(
      { type: "boolean" },
      ({ optional }) => `boolean${optional ? "?" : ""}\n`,
    )
    .with(
      { type: "string" },
      ({ optional }) => `string${optional ? "?" : ""}\n`,
    )
    .with({ type: "literal" }, ({ value }) => `"${value}"\n`)
    .with(
      { type: "int" },
      ({ minimum, maximum }) =>
        `int${minimum !== undefined ? ` min(${minimum})` : ""}${
          maximum !== undefined ? ` max(${maximum})` : ""
        }\n`,
    )
    .with(
      { type: "float" },
      ({ minimum, maximum }) =>
        `float${minimum !== undefined ? ` min(${minimum})` : ""}${
          maximum !== undefined ? ` max(${maximum})` : ""
        }\n`,
    )
    .with({ type: "unknown" }, () => "unknown\n")
    .exhaustive();
}

export function printDocIR(doc: Doc): string {
  let result = `${doc.title}\n`;
  const description = doc.description?.split("\n")[0];
  if (description) {
    const wrappedDesc = wrapText(description, 96, "│   description: ", comment)
      .join("\n");
    result += "│   description: " + `${wrappedDesc}\n`;
  }
  result += printNodeIR(doc.root, "", true);
  for (const [name, definition] of Object.entries(doc.definitions)) {
    result += `${name}\n`;
    const description = definition.description?.split("\n")[0];
    if (description) {
      const wrappedDesc = wrapText(
        description,
        96,
        "│   description: ",
        comment,
      ).join(
        "\n",
      );
      result += "│   description: " + `${wrappedDesc}\n`;
    }
    result += printNodeIR(definition, "", true);
  }
  return result;
}
