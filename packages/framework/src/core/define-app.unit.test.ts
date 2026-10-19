import { describe, expect, it } from "vitest";
import { defineApp } from "./public.js";

describe("defineApp", () => {
  it("returns a definition, not a running app", () => {
    const definition = { name: "notes", config: {}, secrets: [], tables: {}, routes: () => {} };
    const app = defineApp(definition);
    expect(app.definition).toBe(definition);
    expect(Object.keys(app)).toEqual(["definition"]);
  });
});
