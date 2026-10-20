/**
 * Reading a Worker's `env` (cloudflare.md §2 "Worker settings"; config.md §2 "Delivery"): the
 * D1 binding `DB`, the R2 binding `FILES`, the framework variable `FRAMEWORK_PUBLIC_ORIGIN`,
 * and secrets as `SECRET_<NAME>` (SEC-REQ-003). Shared by the local and Cloudflare Workers
 * (local.md §2). Missing bindings are `CORE.MISCONFIGURED`, raised on first use.
 */
import type { AnyD1Database } from "drizzle-orm/d1";
import type { RuntimeEnv } from "../../core/assemble.js";
import { FrameworkError } from "../../core/errors.js";
import type { FilesStore } from "../../files/service.js";
import type { LogService } from "../../log/public.js";
import type { LogBucket } from "../../log/cloudflare/sink.js";
import { sqliteDb } from "../../sql/d1.js";
import type { PortableDb } from "../../sql/types.js";

type Env = RuntimeEnv["Bindings"];

/** Binding and variable names the build writes into the Worker settings. */
export const BINDINGS = Object.freeze({
  database: "DB",
  files: "FILES",
  /** R2 write binding to the account's shared log bucket (`prototype-logs`, LOG-REQ-004). */
  logs: "LOGS",
  publicOrigin: "FRAMEWORK_PUBLIC_ORIGIN",
} as const);

function binding(env: Env, name: string, what: string): unknown {
  const value = env[name];
  if (value === undefined || value === null) {
    throw new FrameworkError("CORE.MISCONFIGURED", `the Worker has no ${what} binding ${JSON.stringify(name)}`);
  }
  return value;
}

/** The app's SQL handle (with the request's log) and KV's own handle, over the D1 binding. */
export function workerSql(env: Env, log: LogService): { readonly sql: PortableDb; readonly kv: PortableDb } {
  const db = binding(env, BINDINGS.database, "D1") as AnyD1Database;
  return { sql: sqliteDb(db, { log }), kv: sqliteDb(db) };
}

export function workerStore(env: Env): FilesStore {
  return binding(env, BINDINGS.files, "R2") as FilesStore;
}

/** The shared log bucket's write binding, or undefined when the Worker has none (LOG never fails the caller). */
export function workerLogBucket(env: Env): LogBucket | undefined {
  const value = env[BINDINGS.logs];
  return value === undefined || value === null ? undefined : (value as LogBucket);
}

/** The public origin from the Worker variable set at deploy (or by `dev`). */
export function workerPublicOrigin(env: Env): string {
  const value = env[BINDINGS.publicOrigin];
  if (typeof value !== "string" || value === "") {
    throw new FrameworkError("CORE.MISCONFIGURED", `the Worker variable ${BINDINGS.publicOrigin} (the stage's public origin) is not set`);
  }
  return value;
}

/** Every secret value in the Worker env, for redaction. */
export function workerSecretValues(env: Env): string[] {
  return Object.entries(env)
    .filter(([name, value]) => name.startsWith("SECRET_") && typeof value === "string" && value !== "")
    .map(([, value]) => value as string);
}

/** The minimal Workers `fetch` handler shape the generated entry exports. */
export interface WorkerHandler {
  fetch(request: Request, env: Env, ctx: unknown): Response | Promise<Response>;
}
