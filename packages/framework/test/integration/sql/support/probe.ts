/**
 * Runs a function inside a real request of an in-process test app, with the request's
 * `c.var` (contract: core.d.ts `RequestVars`), and hands its outcome back to the test.
 *
 * `createTestApp` runs app code in the test runner's process (core.md §2 "Testing"), so a
 * route registered by the test app can call a closure owned by the test. The outcome
 * (value or thrown error) is passed back in memory, not through JSON, so `undefined`,
 * JS types and the thrown `FrameworkError` itself are observed exactly as app code sees
 * them. Only public, contracted names are used: `defineApp` routes, `c.var`, `TestApp`.
 */
import type { Hono } from "hono";
import type { AppEnv, RequestVars } from "../../../../src/index.js";
import type { TestApp } from "../../../../src/testing/index.js";

export type Vars = RequestVars<{}, never>;

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

const pending = new Map<string, (vars: Vars) => Promise<unknown>>();
const outcomes = new Map<string, Outcome<unknown>>();
let counter = 0;

/** Registers the probe route; call from the test app's `routes`. */
export function probeRoutes(api: Hono<AppEnv<{}, never>>): void {
  api.post("/__probe/:id", async (c) => {
    const id = c.req.param("id");
    const fn = pending.get(id);
    if (fn === undefined) return c.body(null, 404);
    pending.delete(id);
    try {
      outcomes.set(id, { ok: true, value: await fn(c.var) });
    } catch (error) {
      outcomes.set(id, { ok: false, error });
    }
    return c.body(null, 204);
  });
}

/** Runs `fn` with the services of one request of `app` and returns what it returned or threw. */
export async function probe<T>(app: TestApp, fn: (vars: Vars) => Promise<T>): Promise<Outcome<T>> {
  const id = `p${++counter}`;
  pending.set(id, fn);
  const response = await app.request(`/api/__probe/${id}`, { method: "POST" });
  const outcome = outcomes.get(id);
  outcomes.delete(id);
  pending.delete(id);
  if (response.status !== 204 || outcome === undefined) {
    throw new Error(`probe route did not run (HTTP ${response.status}): ${await response.text()}`);
  }
  return outcome as Outcome<T>;
}

/** Like `probe`, but fails the test if `fn` threw. */
export async function run<T>(app: TestApp, fn: (vars: Vars) => Promise<T>): Promise<T> {
  const outcome = await probe(app, fn);
  if (!outcome.ok) {
    const e = outcome.error;
    const code = typeof e === "object" && e !== null && "code" in e ? ` (${String((e as { code: unknown }).code)})` : "";
    throw new Error(`expected success, got error${code}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  }
  return outcome.value;
}
