import { assertEquals } from "jsr:@std/assert";
import dedent from "npm:dedent";
import { extractExportedNames } from "./gen-python.ts";

Deno.test("extractExportedNames - extracts class names", () => {
  const content = dedent`
    class MyClass:
        pass

    class AnotherClass(msgspec.Struct):
        field: str

    def not_a_class():
        pass
  `;
  assertEquals(extractExportedNames(content), ["AnotherClass", "MyClass"]);
});

Deno.test("extractExportedNames - extracts enum assignments", () => {
  const content = dedent`
    MyEnum = Union[ClassA, ClassB]
    AnotherEnum = Union[ClassC, ClassD, ClassE]

    not_an_enum = "something else"
  `;
  assertEquals(extractExportedNames(content), ["AnotherEnum", "MyEnum"]);
});

Deno.test("extractExportedNames - extracts both classes and enums", () => {
  const content = dedent`
    class MyClass:
        pass

    MyEnum = Union[ClassA, ClassB]

    class AnotherClass:
        field: str

    AnotherEnum = Union[ClassC, ClassD]
  `;
  assertEquals(extractExportedNames(content), [
    "AnotherClass",
    "AnotherEnum",
    "MyClass",
    "MyEnum",
  ]);
});

Deno.test("extractExportedNames - handles empty content", () => {
  assertEquals(extractExportedNames(""), []);
});

Deno.test("extractExportedNames - ignores indented class definitions and enum assignments", () => {
  const content = dedent`
    def some_function():
        class IndentedClass:
            pass
        
        IndentedEnum = Union[ClassA, ClassB]

    class TopLevelClass:
        pass

    TopLevelEnum = Union[ClassC, ClassD]
  `;
  assertEquals(extractExportedNames(content), [
    "TopLevelClass",
    "TopLevelEnum",
  ]);
});
