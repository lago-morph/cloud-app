/** The once-per-isolate schema gate of the auth app's Worker (DEC-0656; review of PR 27a). */
import { describe, expect, it } from "vitest";
import { createSchemaGate } from "./schema-gate.js";

describe("createSchemaGate", () => {
  it("applies the schema once per database, sharing one promise between concurrent callers", async () => {
    let runs = 0;
    const gate = createSchemaGate(async () => {
      runs += 1;
    });
    const db = {};
    await Promise.all([gate(db), gate(db), gate(db)]);
    await gate(db);
    expect(runs).toBe(1);
    await gate({});
    expect(runs).toBe(2);
  });

  it("does not remember a failure: the next call tries again", async () => {
    let runs = 0;
    const gate = createSchemaGate(async () => {
      runs += 1;
      if (runs === 1) throw new Error("D1 down");
    });
    const db = {};
    await expect(gate(db)).rejects.toThrow("D1 down");
    await expect(gate(db)).resolves.toBeUndefined();
    await gate(db);
    expect(runs).toBe(2);
  });
});
