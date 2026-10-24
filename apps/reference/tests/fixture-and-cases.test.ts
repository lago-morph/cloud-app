import { defineApp, eq, newId } from "@lago-morph/prototype-framework";
import { createTestApp, mockUsers } from "@lago-morph/prototype-framework/testing";
import { describe, expect, it } from "vitest";
import app from "../src/app";
import type { CaseSets } from "../src/server/case-types";
import { caseRoutes } from "../src/server/routes/cases";
import { authors } from "../src/server/schema";
import type { FixtureDump } from "../src/shared/types";
import { json, open, type ErrorBody } from "./support";

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("migration data fixture", () => {
  it("loads once and dumps every row and file, sorted", async () => {
    const t = await open({ user: mockUsers.user("fixture") });
    const empty: FixtureDump = await (await t.request("/api/fixture/dump")).json();
    expect(empty).toEqual({ version: "v1", parents: [], children: [], files: [] });

    const loaded = await t.request("/api/fixture/load", { method: "POST" });
    expect(loaded.status).toBe(201);
    expect(await loaded.json()).toEqual({ parents: 3, children: 5, files: 2 });

    const dump: FixtureDump = await (await t.request("/api/fixture/dump")).json();
    expect(dump.version).toBe("v1");
    expect(dump.parents).toEqual([
      { name: "alpha", note: "first parent" },
      { name: "beta", note: null },
      { name: "gamma", note: "Ünïcødé — ünd ‘quotes’" },
    ]);
    expect(dump.children).toEqual([
      { parent: "alpha", label: "a2" },
      { parent: "alpha", label: "shared" },
      { parent: "beta", label: "b2" },
      { parent: "beta", label: "shared" },
      { parent: "gamma", label: "g1" },
    ]);
    expect(dump.files).toEqual([
      { name: "fixture/all-bytes.bin", size: 256, contentType: "application/octet-stream", sha256: await sha256(Uint8Array.from({ length: 256 }, (_, i) => i)) },
      { name: "fixture/hello.txt", size: 14, contentType: "text/plain", sha256: await sha256(new TextEncoder().encode("hello fixture\n")) },
    ]);

    const again = await t.request("/api/fixture/load", { method: "POST" });
    expect(again.status).toBe(409);
    const body: ErrorBody = await again.json();
    expect(body.error.code).toBe("HTTP.CONFLICT");
  });

  it("refuses anonymous callers", async () => {
    const t = await open();
    expect((await t.request("/api/fixture/dump")).status).toBe(401);
  });
});

describe("case runner", () => {
  it("lists the sets C-T2 registered", async () => {
    const t = await open({ user: mockUsers.user("cases") });
    const listed: { sets: Record<string, string[]> } = await (await t.request("/api/cases")).json();
    expect(Object.keys(listed.sets).sort()).toEqual(["kv", "mig", "sql"]);
    const res = await t.request("/api/cases/run", json("POST", { set: "none", name: "none" }));
    expect(res.status).toBe(404);
  });

  it("runs a case: value, undefined, thrown framework error, unknown case", async () => {
    const sets: CaseSets = {
      demo: {
        value: async ({ sql }, input) => {
          const name = `case-${String(input)}`;
          await sql.insert(authors).values({ id: newId(), name });
          const rows = await sql.select({ name: authors.name }).from(authors).where(eq(authors.name, name));
          await sql.delete(authors).where(eq(authors.name, name));
          return rows;
        },
        nothing: async ({ kv }) => {
          await kv.put("case:x", "y");
          await kv.delete("case:x");
        },
        failing: async ({ kv }) => kv.get(""),
      },
    };
    const caseApp = defineApp({ ...app.definition, routes: (api) => caseRoutes(api, sets) });
    const t = await createTestApp(caseApp, { user: mockUsers.user("cases") });
    try {
      expect(await (await t.request("/api/cases")).json()).toEqual({ sets: { demo: ["value", "nothing", "failing"] } });
      const value = await t.request("/api/cases/run", json("POST", { set: "demo", name: "value", input: 7 }));
      expect(await value.json()).toEqual({ outcome: "value", value: [{ name: "case-7" }] });
      const nothing = await t.request("/api/cases/run", json("POST", { set: "demo", name: "nothing" }));
      expect(await nothing.json()).toEqual({ outcome: "undefined" });
      const failing = await t.request("/api/cases/run", json("POST", { set: "demo", name: "failing" }));
      expect(failing.status).toBe(400);
      const body: ErrorBody = await failing.json();
      expect(body.error.code).toBe("KV.INVALID_KEY");
      expect((await t.request("/api/cases/run", json("POST", { set: "demo", name: "missing" }))).status).toBe(404);
    } finally {
      await t.dispose();
    }
  });
});
