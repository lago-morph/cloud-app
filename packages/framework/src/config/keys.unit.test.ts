import { describe, expect, it } from "vitest";
import { keyDefinition } from "./keys.js";
import { configBoolean, configInteger, configString, configStringList } from "./public.js";

describe("config key declarations (CFG-REQ-001)", () => {
  it("each declaration function records its type", () => {
    expect(keyDefinition(configString()).kind).toBe("string");
    expect(keyDefinition(configInteger()).kind).toBe("integer");
    expect(keyDefinition(configBoolean()).kind).toBe("boolean");
    expect(keyDefinition(configStringList()).kind).toBe("stringList");
  });

  it("records an optional default, including falsy ones", () => {
    expect(keyDefinition(configString()).hasDefault).toBe(false);
    expect(keyDefinition(configString({ default: "" }))).toMatchObject({ hasDefault: true, default: "" });
    expect(keyDefinition(configInteger({ default: 0 }))).toMatchObject({ hasDefault: true, default: 0 });
    expect(keyDefinition(configBoolean({ default: false }))).toMatchObject({ hasDefault: true, default: false });
    expect(keyDefinition(configStringList({ default: ["a"] }))).toMatchObject({ hasDefault: true, default: ["a"] });
  });

  it("a key definition is immutable", () => {
    const list = ["a"];
    const key = configStringList({ default: list });
    list.push("b");
    expect(keyDefinition(key).default).toEqual(["a"]);
    expect(Object.isFrozen(key)).toBe(true);
    expect(Object.isFrozen(keyDefinition(key).default)).toBe(true);
  });

  it("rejects a value that is not a key declaration", () => {
    expect(() => keyDefinition({ $type: "x" } as never)).toThrow(/not a configuration key/);
  });
});
