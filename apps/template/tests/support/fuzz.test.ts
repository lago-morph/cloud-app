import { z } from "@lago-morph/prototype-framework";
import { describe, expect, it } from "vitest";
import { fuzzJsonRoute, type Requester } from "./fuzz";

/**
 * The fuzz helper's own tests: fake routes that answer by rule, so each way a route can break the
 * helper's oracle is shown to fail the run, and a correct route is shown to pass. Small runs with a
 * fixed seed: these check the helper, not a route.
 */
const schema = z.object({ text: z.string().trim().min(1).max(20) });
const RUNS = { numRuns: 100, seed: 7 };

function route(answer: (body: unknown, valid: boolean) => Response): Requester {
  return {
    async request(_path, init) {
      const raw = typeof init?.body === "string" ? init.body : "";
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return Response.json({ error: { code: "HTTP.INVALID_INPUT" } }, { status: 400 });
      }
      return answer(body, schema.safeParse(body).success);
    },
  };
}

const invalidInput = (): Response => Response.json({ error: { code: "HTTP.INVALID_INPUT", message: "bad" } }, { status: 400 });
const created = (): Response => Response.json({ id: "n1" }, { status: 201 });

describe("fuzzJsonRoute", () => {
  it("passes a route that refuses exactly the bodies its schema refuses", async () => {
    await expect(fuzzJsonRoute(route((_b, valid) => (valid ? created() : invalidInput())), { path: "/api/x", schema, examples: [{ text: "hi" }], ...RUNS })).resolves.toBeUndefined();
  });

  it("passes when the route's own rules refuse a schema-valid body with another status", async () => {
    await expect(fuzzJsonRoute(route((_b, valid) => (valid ? Response.json({ error: { code: "HTTP.CONFLICT" } }, { status: 409 }) : invalidInput())), { path: "/api/x", schema, examples: [{ text: "hi" }], ...RUNS })).resolves.toBeUndefined();
  });

  it("fails a route that answers a server error", async () => {
    const r = route((body, valid) => (Array.isArray(body) ? new Response("boom", { status: 500 }) : valid ? created() : invalidInput()));
    await expect(fuzzJsonRoute(r, { path: "/api/x", schema, examples: [{ text: "hi" }], ...RUNS })).rejects.toThrow(/500/);
  });

  it("fails a route that accepts a body its schema refuses", async () => {
    await expect(fuzzJsonRoute(route(() => created()), { path: "/api/x", schema, examples: [{ text: "hi" }], ...RUNS })).rejects.toThrow(/schema refuses/);
  });

  it("fails a route that answers HTTP.INVALID_INPUT for a body its schema accepts", async () => {
    await expect(fuzzJsonRoute(route(() => invalidInput()), { path: "/api/x", schema, examples: [{ text: "hi" }], ...RUNS })).rejects.toThrow(/schema accepts/);
  });

  it("sends the method and path given, as JSON", async () => {
    const seen: string[] = [];
    const correct = route((_b, valid) => (valid ? created() : invalidInput()));
    const r: Requester = {
      request(path, init) {
        seen.push(`${init?.method ?? "GET"} ${path} ${new Headers(init?.headers).get("content-type") ?? ""}`);
        return correct.request(path, init);
      },
    };
    await fuzzJsonRoute(r, { path: "/api/y", method: "PUT", schema, examples: [{ text: "hi" }], numRuns: 5, seed: 1 });
    expect(new Set(seen)).toEqual(new Set(["PUT /api/y application/json"]));
  });

  it("refuses an example the schema refuses, before sending anything", async () => {
    const seen: string[] = [];
    const r: Requester = { request: (path) => (seen.push(path), Promise.resolve(created())) };
    await expect(fuzzJsonRoute(r, { path: "/api/x", schema, examples: [{ text: "" }], ...RUNS })).rejects.toThrow(/example .* is refused by the schema/);
    expect(seen).toEqual([]);
  });
});
