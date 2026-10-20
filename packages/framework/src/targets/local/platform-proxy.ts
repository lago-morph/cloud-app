/**
 * Local emulated storage (local.md: "local emulations of storage") for the framework's
 * in-process tools: Wrangler's getPlatformProxy (DEC-0105) started outside Miniflare's
 * host-wide dev registry. Used by
 * `createTestApp` (testing/test-app.ts), the migration checker's local D1
 * (check/migrations/databases.ts) and the fake D1 HTTP API (provision/cloudflare/d1/fake-d1-api.ts).
 * `dev` (cli/dev/*) does not use it: there joining the registry is ordinary `wrangler dev`
 * behaviour. Node only; never part of a Worker bundle, and not on the `./targets/local` subpath.
 */
import { getPlatformProxy } from "wrangler";

/**
 * These callers never join Miniflare's host-wide dev registry (~/.config/.wrangler/registry):
 * they have no cross-Worker bindings, and joining it under a fixed Worker name makes instances in
 * different processes interfere (root cause 2026-10-20-testing-dev-registry.md). getPlatformProxy
 * has no option for this; Wrangler reads WRANGLER_REGISTRY_PATH (an empty value disables the
 * registry) synchronously inside the call when remote bindings are off, so the override is
 * restored before any await and no other code sees it.
 * Guard: the "… and the dev registry" tests in testing/test-app.unit.test.ts,
 * check/migrations/databases.unit.test.ts and provision/cloudflare/d1/fake-d1-api.unit.test.ts
 * fail if a Wrangler upgrade moves that read after an await; do not delete them as redundant.
 */
export function startPlatformProxy<Env extends Record<string, unknown>>(configPath: string): ReturnType<typeof getPlatformProxy<Env>> {
  const had = Object.hasOwn(process.env, "WRANGLER_REGISTRY_PATH");
  const prior = process.env.WRANGLER_REGISTRY_PATH;
  process.env.WRANGLER_REGISTRY_PATH = "";
  try {
    return getPlatformProxy<Env>({ configPath, persist: false, remoteBindings: false });
  } finally {
    if (had) process.env.WRANGLER_REGISTRY_PATH = prior;
    else delete process.env.WRANGLER_REGISTRY_PATH;
  }
}
