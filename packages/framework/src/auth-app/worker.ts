/**
 * The auth app's Worker entry (plan §3; DEC-0661). One ES module for workerd:
 * - `default.fetch` serves `/start` and `/callback` (app.ts);
 * - the named entrypoint `AuthApp` is what apps bind as `env.AUTH` (service binding with
 *   `entrypoint: "AuthApp"`), answering `redeem` and `role` (service.ts; contract
 *   docs/contracts/ts/internal/auth-app.d.ts). Its only methods are those two: every method of a
 *   WorkerEntrypoint class is callable over RPC, TypeScript's `private` included, so helpers live
 *   at module level.
 * Settings: config.ts (DEC-0658). The schema is applied once per isolate (DEC-0656). Logs are one
 * JSON line each on the console; never a code, state, token or secret.
 *
 * Deployed by bundling `dist/auth-app/worker.js` (esbuild, `cloudflare:workers` external). It is
 * not in the package's `exports`, and its `.d.ts` names `cloudflare:workers`, which only workerd
 * provides: nothing in Node imports it.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import type { AuthAppIdentity, AuthAppRole } from "../auth/auth-app-binding.js";
import { handleAuthAppRequest } from "./app.js";
import { readConfig } from "./config.js";
import { createSchemaGate } from "./schema-gate.js";
import { createAuthAppService } from "./service.js";
import { logLine } from "./sign-in.js";
import { ensureSchema, type D1Like } from "./store.js";

type Env = Record<string, unknown> & { DB: D1Like };

const log = (line: string): void => console.log(line);
const ensureReady = createSchemaGate<D1Like>(ensureSchema);

const unavailable = (status: number): Response =>
  new Response("<!doctype html><meta charset=\"utf-8\"><title>Sign-in</title><p>Sign-in is unavailable. Try again shortly.</p>", {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });

/** The binding service over `env.DB`, once its schema is in place; an outage rejects generically. */
async function serviceFor(env: Env) {
  try {
    await ensureReady(env.DB);
  } catch {
    log(logLine("error", "binding call failed: database unavailable"));
    throw new Error("auth app unavailable");
  }
  return createAuthAppService({ db: env.DB, now: Date.now, onError: () => log(logLine("error", "binding call failed: database unavailable")) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let config;
    try {
      config = await readConfig(env);
    } catch (e) {
      log(logLine("error", e instanceof Error ? e.message : "auth app misconfigured"));
      return unavailable(500);
    }
    try {
      await ensureReady(env.DB);
    } catch {
      log(logLine("error", "database unavailable"));
      return unavailable(503);
    }
    return handleAuthAppRequest(request, { db: env.DB, fetch: (input, init) => fetch(input, init), now: Date.now, log, config });
  },
};

export class AuthApp extends WorkerEntrypoint<Env> {
  async redeem(input: unknown): Promise<AuthAppIdentity | null> {
    return (await serviceFor(this.env)).redeem(input as { code: string; app: string });
  }

  async role(sub: unknown): Promise<AuthAppRole | null> {
    return (await serviceFor(this.env)).role(sub as string);
  }
}
