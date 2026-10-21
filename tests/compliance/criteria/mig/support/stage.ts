/**
 * A stage of the reference app that a migration criterion deploys, redeploys and inspects
 * itself (MIG-AC-002, -003, -006), separate from the run's shared stage: these criteria change
 * the app's schema version (compliance.md "Test stages": stage-lifecycle criteria create and
 * remove their own stages).
 *
 * The app is a scratch copy of `apps/reference` with one of its migration overlays applied
 * (ROUTES.md "Migration overlays": `v1` is the app as committed, `versions/v2`,
 * `versions/unique-fail`). What "deploy" means per target:
 *
 * - local (DEC-0144): a `dev` start on the copy; it applies pending migrations in place to the
 *   copy's persistent local D1 database. A failing migration makes `dev` exit with failure
 *   status before serving; "the old app answers again" is a `dev` start with the previous
 *   version's sources, which this harness performs after a failed deploy, as the CLI restarts
 *   the previous version on a cloud. The database is read straight from Miniflare's SQLite file.
 * - cloudflare: `deploy --target cloudflare --stage test-<random>` from the copy; the database
 *   is read through the D1 HTTP API (the proxy injects the token; no Authorization header).
 *   Removed with `remove` afterwards.
 *
 * Inspection is read-only (`query` runs SELECTs only).
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { CLOUD_WAITS, createClient, newTestStage, prerequisiteMissing, REFERENCE_APP, target, waitFor, type ComplianceClient } from "../../../harness/index.js";

export type Version = "v1" | "v2" | "unique-fail";

export interface DeployResult {
  readonly ok: boolean;
  /** Exit status of `dev` (local, when it exited before serving) or of `deploy`. */
  readonly status: number | null;
  readonly output: string;
}

export interface StageUnderTest {
  /** The stage name (local: `local`). */
  readonly stage: string;
  /** The app's current base URL; locally it changes with every `dev` start. */
  baseUrl(): string;
  /** A new client on the current base URL, logged in as a user. */
  user(): Promise<ComplianceClient>;
  /** Sets a declared secret on this stage (value on standard input). */
  setSecret(name: string, value: string): Promise<void>;
  /** Deploys `version`; `during` runs while the deploy runs and is awaited before returning. */
  deploy(version: Version, during?: (signal: AbortSignal) => Promise<void>): Promise<DeployResult>;
  /** The stage's current version's app migration files (sqlite history), base names in order. */
  appMigrations(): string[];
  /** Runs one read-only SELECT on the stage's current database. */
  query(sql: string): Promise<Record<string, unknown>[]>;
  /** Names of the stage's databases (local: D1 database files; cloud: D1 databases of the stage). */
  databases(): Promise<string[]>;
  /** Stops and removes everything this stage created. */
  remove(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "../../../../..");
const REFERENCE_DIR = join(REPO_ROOT, "apps/reference");
const FRAMEWORK_BIN = join(REPO_ROOT, "packages/framework/bin/prototype-framework.js");
/** Framework migration base names (the framework's own sqlite history), in order. */
export function frameworkMigrations(): string[] {
  return sqlFiles(join(REPO_ROOT, "packages/framework/migrations/sqlite"));
}

/**
 * A failed deploy's output for an assertion message: the first workerd fatal line (`*** …`, e.g.
 * `*** Fatal uncaught kj::Exception: … bind(): Address already in use`) and the first
 * `Runtime stderr:` block, when the output has them and they are not already in the tail, then the
 * last `tailChars` characters. A bare tail lost exactly that line in the MIG-AC-002 failure of
 * run r5nndia2aediccu (ai/implementation/root-causes/2026-10-20-mig-ac-002-workerd-crash.md).
 */
export function failureOutput(output: string, tailChars = 1500): string {
  const tail = output.slice(-tailChars);
  const head = output.slice(0, Math.max(0, output.length - tailChars));
  const lines = head.split("\n");
  const kept: string[] = [];
  const fatal = lines.find((l) => /^(\[wrangler\] )?\*\*\* /.test(l));
  if (fatal !== undefined) kept.push(fatal.slice(0, 2000));
  const runtime = lines.findIndex((l) => l.includes("Runtime stderr:"));
  if (runtime >= 0) {
    const block: string[] = [];
    for (const l of lines.slice(runtime, runtime + 20)) {
      if (block.length > 0 && l.trim() === "") break;
      block.push(l.slice(0, 2000));
    }
    const text = block.join("\n");
    if (fatal === undefined || !text.includes(fatal.slice(0, 2000))) kept.push(text);
  }
  if (kept.length === 0) return tail;
  return `${kept.join("\n")}\n[…]\n${tail}`;
}

function sqlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => basename(f, ".sql"));
}

const NOT_COPIED = new Set(["node_modules", ".wrangler", ".framework", ".logs", ".dev.vars", "dist", "tests", "versions"]);

/** A scratch copy of the reference app, resolving the framework through the workspace's node_modules. */
function copyReferenceApp(): string {
  const dir = mkdtempSync(join(tmpdir(), "c-t2-mig-"));
  for (const entry of readdirSync(REFERENCE_DIR)) {
    if (NOT_COPIED.has(entry)) continue;
    cpSync(join(REFERENCE_DIR, entry), join(dir, entry), { recursive: true });
  }
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

/** Replaces the copy's version-dependent files (`src/server/evolution.ts`, `migrations/`) with `version`'s. */
function applyVersion(dir: string, version: Version): void {
  const source = version === "v1" ? REFERENCE_DIR : join(REFERENCE_DIR, "versions", version);
  rmSync(join(dir, "migrations"), { recursive: true, force: true });
  cpSync(join(source, "migrations"), join(dir, "migrations"), { recursive: true });
  cpSync(join(source, "src/server/evolution.ts"), join(dir, "src/server/evolution.ts"));
}

function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // The scratch app's CLI chooses its own dialects; test-process variables must not leak in.
  for (const name of ["PROTOTYPE_FRAMEWORK_DIALECT", "VITEST", "VITEST_POOL_ID", "VITEST_WORKER_ID", "NODE_ENV", "TEST"]) delete env[name];
  return env;
}

interface CliResult {
  readonly status: number | null;
  readonly output: string;
}

function runCli(dir: string, args: readonly string[], options: { stdin?: string; timeoutMs: number }): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FRAMEWORK_BIN, ...args], { cwd: dir, env: cliEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (output += d.toString("utf8")));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`\`${args.join(" ")}\` did not finish within ${String(options.timeoutMs)} ms\n${output.slice(-2000)}`));
    }, options.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, output });
    });
    child.stdin.end(options.stdin ?? "");
  });
}

const STEP_MS = 300_000;

async function settle(during: Promise<void> | undefined, controller: AbortController): Promise<void> {
  controller.abort();
  await during;
}

// ---- local ------------------------------------------------------------------------------

interface DevProcess {
  readonly baseUrl: string;
  stop(): Promise<void>;
}

/** Starts `dev`; resolves with the server once it prints its origin and its health check answers, or with the exit. */
function startDev(dir: string): Promise<{ server: DevProcess } | { exited: CliResult }> {
  const child = spawn(process.execPath, [FRAMEWORK_BIN, "dev"], { cwd: dir, env: cliEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  let exit: CliResult | undefined;
  child.stdout.on("data", (d: Buffer) => (output += d.toString("utf8")));
  child.stderr.on("data", (d: Buffer) => (output += d.toString("utf8")));
  const closed = new Promise<void>((r) => child.on("close", (status) => ((exit = { status, output }), r())));
  const signal = (sig: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, sig);
    } catch {
      // gone
    }
  };
  const stop = async (): Promise<void> => {
    if (exit === undefined) {
      signal("SIGINT");
      const timer = setTimeout(() => signal("SIGKILL"), 30_000);
      await closed;
      clearTimeout(timer);
    }
    signal("SIGKILL");
  };
  return waitFor<{ server: DevProcess } | { exited: CliResult }>(
    async () => {
      if (exit !== undefined) return { exited: exit };
      const origin = /is running at (http:\/\/localhost:\d+)\//.exec(output)?.[1];
      if (origin === undefined) return undefined;
      const health = await fetch(`${origin}/api/__framework/health`).catch(() => undefined);
      return health?.status === 204 ? { server: { baseUrl: origin, stop } } : undefined;
    },
    { what: "the scratch reference app's dev server", timeoutMs: STEP_MS, intervalMs: 500 },
  ).catch(async (error: unknown) => {
    await stop();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output.slice(-2000)}`);
  });
}

/** Miniflare's per-namespace `metadata.sqlite` is not a D1 database (root cause 2026-10-19-MIG-AC-002). */
function d1Files(dir: string): string[] {
  const found: string[] = [];
  const root = join(dir, ".wrangler");
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".sqlite") && entry !== "metadata.sqlite" && full.includes(`${sep}d1${sep}`)) found.push(full);
    }
  };
  if (existsSync(root)) walk(root);
  return found.sort();
}

function localStage(): StageUnderTest {
  const dir = copyReferenceApp();
  let version: Version = "v1";
  let dev: DevProcess | undefined;
  applyVersion(dir, version);

  const current = (): string => {
    if (dev === undefined) throw new Error("the scratch reference app is not being served");
    return dev.baseUrl;
  };
  const serve = async (): Promise<DeployResult> => {
    const started = await startDev(dir);
    if ("exited" in started) return { ok: false, status: started.exited.status, output: started.exited.output };
    dev = started.server;
    return { ok: true, status: 0, output: "" };
  };

  return {
    stage: "local",
    baseUrl: current,
    async user() {
      const c = createClient({ baseUrl: current() });
      await c.loginAs("user", { id: "c-t2-mig" });
      return c;
    },
    async setSecret(name, value) {
      const result = await runCli(dir, ["secrets", "set", name, "--target", "local", "--stage", "local"], { stdin: value, timeoutMs: STEP_MS });
      if (result.status !== 0) throw new Error(`secrets set ${name} --target local failed (status ${String(result.status)}): ${result.output.slice(-1000)}`);
    },
    async deploy(next, during) {
      const controller = new AbortController();
      const running = during?.(controller.signal);
      try {
        await dev?.stop();
        dev = undefined;
        const previous = version;
        applyVersion(dir, next);
        const result = await serve();
        if (result.ok) {
          version = next;
          return result;
        }
        // Local reading of "the old app answers again" (DEC-0144): serve the previous version's sources.
        applyVersion(dir, previous);
        const restarted = await serve();
        if (!restarted.ok) throw new Error(`the previous version did not start again after the failed deploy:\n${failureOutput(restarted.output, 2000)}`);
        return result;
      } finally {
        await settle(running, controller);
      }
    },
    appMigrations: () => sqlFiles(join(dir, "migrations/sqlite")),
    query(sql) {
      const files = d1Files(dir);
      if (files.length !== 1) return Promise.reject(new Error(`expected one local D1 database, found ${String(files.length)}`));
      const db = new DatabaseSync(files[0] ?? "", { readOnly: true });
      try {
        return Promise.resolve((db.prepare(sql).all() as Record<string, unknown>[]).map((r) => ({ ...r })));
      } finally {
        db.close();
      }
    },
    databases: () => Promise.resolve(d1Files(dir).map((f) => basename(f))),
    async remove() {
      await dev?.stop();
      dev = undefined;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---- cloudflare -------------------------------------------------------------------------

const CF_API = "https://api.cloudflare.com/client/v4";

async function cfApi(path: string, init?: { method: string; body: unknown }): Promise<unknown> {
  const response = await fetch(`${CF_API}${path}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json", "user-agent": "prototype-framework-compliance/0.1.0" },
    ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(CLOUD_WAITS.requestMs),
  });
  const body = (await response.json()) as { success?: boolean; result?: unknown; errors?: unknown };
  if (!response.ok || body.success !== true) throw new Error(`Cloudflare API ${init?.method ?? "GET"} ${path.replace(/accounts\/[^/]+/, "accounts/<account>")} → ${String(response.status)} ${JSON.stringify(body.errors ?? null)}`);
  return body.result;
}

function cloudflareStage(): StageUnderTest {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (account === undefined || account === "") prerequisiteMissing("CLOUDFLARE_ACCOUNT_ID is not set: the migration criteria inspect the stage's D1 databases through the D1 API");
  const stage = newTestStage();
  const dir = copyReferenceApp();
  let origin: string | undefined;
  applyVersion(dir, "v1");
  const pattern = new RegExp(`^${REFERENCE_APP}-${stage}-db-(\\d+)$`);

  const stageDatabases = async (): Promise<{ name: string; uuid: string; n: number }[]> => {
    const listed = (await cfApi(`/accounts/${account}/d1/database?name=${encodeURIComponent(`${REFERENCE_APP}-${stage}-db-`)}&per_page=100`)) as { name: string; uuid: string }[];
    return listed.flatMap((d) => {
      const m = pattern.exec(d.name);
      return m === null ? [] : [{ name: d.name, uuid: d.uuid, n: Number(m[1]) }];
    }).sort((a, b) => a.n - b.n);
  };
  const cli = (args: string[], stdin?: string) => runCli(dir, args, { timeoutMs: 1_200_000, ...(stdin === undefined ? {} : { stdin }) });

  return {
    stage,
    baseUrl() {
      if (origin === undefined) throw new Error(`stage ${stage} has not been deployed`);
      return origin;
    },
    async user() {
      const c = createClient({ baseUrl: this.baseUrl() });
      await c.loginAs("user", { id: "c-t2-mig" });
      return c;
    },
    async setSecret(name, value) {
      const result = await cli(["secrets", "set", name, "--target", "cloudflare", "--stage", stage], value);
      if (result.status !== 0) throw new Error(`secrets set ${name} --target cloudflare --stage ${stage} failed (status ${String(result.status)}): ${result.output.slice(-1000)}`);
    },
    async deploy(next, during) {
      const controller = new AbortController();
      const running = during?.(controller.signal);
      try {
        applyVersion(dir, next);
        const result = await cli(["deploy", "--target", "cloudflare", "--stage", stage]);
        const printed = /(https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev)\b/.exec(result.output)?.[1];
        if (result.status === 0 && printed !== undefined) origin = printed;
        return { ok: result.status === 0, status: result.status, output: result.output };
      } finally {
        await settle(running, controller);
      }
    },
    appMigrations: () => sqlFiles(join(dir, "migrations/sqlite")),
    async query(sql) {
      const dbs = await stageDatabases();
      const currentDb = dbs[0];
      if (currentDb === undefined) throw new Error(`stage ${stage} has no database`);
      const result = (await cfApi(`/accounts/${account}/d1/database/${currentDb.uuid}/query`, { method: "POST", body: { sql } })) as { results?: Record<string, unknown>[] }[];
      return result[0]?.results ?? [];
    },
    databases: async () => (await stageDatabases()).map((d) => d.name),
    async remove() {
      try {
        const result = await cli(["remove", "--target", "cloudflare", "--stage", stage]);
        if (result.status !== 0) throw new Error(`remove --target cloudflare --stage ${stage} failed (status ${String(result.status)}): ${result.output.slice(-1000)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** A new stage of the reference app for this run's target. */
export function createStage(): StageUnderTest {
  const t = target().target;
  if (t === "local") return localStage();
  if (t === "cloudflare") return cloudflareStage();
  return prerequisiteMissing("AWS phase not started");
}
