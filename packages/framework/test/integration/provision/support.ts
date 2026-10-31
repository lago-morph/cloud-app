/**
 * PROV's integration world (S4 coverage list §1.1 item 1; plan-v0.2.0 §7a.1.4): the framework's
 * own Cloudflare target (`createCloudflareTarget`) driven by the target-neutral `runDeploy`,
 * `runRemove`, `runStop` and `runStart`, with
 * - the stage databases on **real local D1**: the fake D1 HTTP API over Miniflare
 *   (`d1/fake-d1-api.ts`), reached through D-04's real D1 operations, including the native
 *   export/import copy and D1's export for a production backup;
 * - every other Cloudflare call answered by the in-memory account (`fake-cloud.test-support.ts`),
 *   whose fake SST CLI reads the program the target really generates;
 * - the stage's own answers (health route) modelled from the deployed Worker: a disabled route
 *   answers 404 as live (DEC-0090), a declared secret missing from the Worker answers
 *   `SEC.MISSING` with a request ID (SEC-REQ, HTTP error shape).
 *
 * Fake-API runs are not evidence for PROV's Cloud criteria (§7a.1.4), so nothing here is tagged.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureIo } from "../../../src/cli/io.test-support.js";
import type { Histories } from "../../../src/mig/apply.js";
import { appSchema, generateMigrations } from "../../../src/mig/generate.js";
import { readHistory } from "../../../src/mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../../src/mig/migrations-dir.js";
import { id, text } from "../../../src/sql/columns.js";
import { defineTable } from "../../../src/sql/table.js";
import type { CloudflareApi } from "../../../src/provision/cloudflare/api.js";
import { openFakeD1Api, type FakeD1Api } from "../../../src/provision/cloudflare/d1/fake-d1-api.js";
import { d1DatabaseOperations } from "../../../src/provision/cloudflare/d1/operations.js";
import { ACCOUNT, FakeCloud } from "../../../src/provision/cloudflare/fake-cloud.test-support.js";
import { createCloudflareTarget } from "../../../src/provision/cloudflare/target.js";
import type { HealthOutcome, Stage, TargetOperations } from "../../../src/provision/core/operations.js";

export { ACCOUNT };
export const ENV = { CLOUDFLARE_API_TOKEN: "placeholder-not-a-credential", CLOUDFLARE_ACCOUNT_ID: ACCOUNT, PATH: "/usr/bin" };
/** The auth app's Worker and its registry binding (PAR-438, DEC-0725), written out from the plan rather than imported. */
export const AUTH_APP_WORKER = "prototype-auth";

const dirs: string[] = [];
export function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
export function cleanTempDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/**
 * The app's migration histories: v1 creates `notes`; v2 makes `notes.title` unique, which fails
 * on a database holding two notes of one title (MIG-REQ-003's failing migration).
 */
export async function histories(): Promise<{ v1: Histories; v2: Histories; failing: string }> {
  const root = tempDir("prov-int-mig-");
  await generateMigrations({ root, schema: appSchema({ notes: defineTable("notes", { id: id(), title: text() }) }) });
  await generateMigrations({ root, schema: appSchema({ notes: defineTable("notes", { id: id(), title: text().unique() }) }) });
  const framework = readHistory(FRAMEWORK_MIGRATIONS_DIR, "sqlite", "framework");
  const app = readHistory(root, "sqlite", "app");
  return { v1: { framework, app: app.slice(0, 1) }, v2: { framework, app }, failing: app[1]!.file };
}

export interface World {
  readonly cloud: FakeCloud;
  readonly d1: FakeD1Api;
  readonly target: TargetOperations;
  /** One line per effect, in order: `api <METHOD> <path>`, `d1 <METHOD> <path>`, `bytes <METHOD> <path>` (R2 objects), `sst <args>`, `health <worker>`. */
  readonly events: string[];
  /** Secrets the stage's code requires at runtime (the health route answers `SEC.MISSING` without them). */
  readonly runtimeSecrets: Set<string>;
  /** The auth app's registry database (D1 UUID), when `withAuthApp` deployed it. */
  registryId?: string;
}

/** The Worker that serves `<app>-<stage>` and its secrets' Worker names. */
export const workerOf = (s: Stage): string => `${s.app}-${s.stage}`;

/** `native: false` copies databases row by row only (the CLI always offers the native export/import first, DEC-0545). */
export async function openWorld(options: { native?: boolean } = {}): Promise<World> {
  const cloud = FakeCloud.withSharedResources();
  const d1 = await openFakeD1Api({ accountId: ACCOUNT });
  const events: string[] = [];
  const runtimeSecrets = new Set<string>();
  const api: CloudflareApi = async (method, path, body) => {
    const isD1 = path.startsWith(`/accounts/${ACCOUNT}/d1/database`);
    events.push(`${isD1 ? "d1" : "api"} ${method} ${path}`);
    // The in-memory account has no Worker-secret DELETE (`DELETE …/workers/scripts/<w>/secrets/<name>`),
    // which deploy sends before a Secrets Store binding takes the secret's name (DEC-0727): answered
    // here as Cloudflare documents it, 404 for an absent Worker or secret.
    const del = method === "DELETE" ? new RegExp(`^/accounts/${ACCOUNT}/workers/scripts/([^/]+)/secrets/([^/]+)$`).exec(path) : null;
    if (del) {
      const removed = cloud.workers.get(del[1]!)?.secrets.delete(decodeURIComponent(del[2]!)) === true;
      return removed ? { status: 200, body: { success: true, errors: [], messages: [], result: null } } : { status: 404, body: { success: false, errors: [{ code: 10056, message: "secret not found" }], messages: [], result: null } };
    }
    return isD1 ? d1.api(method, path, body) : cloud.api(method, path, body);
  };
  // The stage itself: what its health route answers, from the deployed Worker's state.
  const stageFetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const worker = url.hostname.split(".")[0] ?? "";
    events.push(`health ${worker}`);
    const w = cloud.workers.get(worker);
    if (w === undefined || !w.enabled) return new Response("error code: 1042", { status: 404 });
    const missing = [...runtimeSecrets].find((s) => !w.secrets.has(`SECRET_${s.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`));
    if (missing !== undefined) {
      const body = { error: { code: "SEC.MISSING", message: `secret ${missing} is not set`, requestId: "req-health-1" } };
      return new Response(JSON.stringify(body), { status: 500, headers: { "content-type": "application/json" } });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const target = createCloudflareTarget({
    api,
    bytes: async (method, path, body) => {
      events.push(`bytes ${method} ${path}`);
      return cloud.bytes(method, path, body);
    },
    accountId: ACCOUNT,
    env: ENV,
    appDir: tempDir("prov-int-app-"),
    databases: d1DatabaseOperations({ api, accountId: ACCOUNT, ...(options.native === false ? {} : { native: { transfer: d1.transfer, sleep: async () => {} } }) }),
    sst: async (args, options) => {
      events.push(`sst ${args.join(" ")}`);
      return cloud.sst(args, options);
    },
    fetch: stageFetch,
    code: { bundle: "/app/.framework/cloudflare/worker.js", compatibilityDate: "2026-10-01", logBucketBinding: "LOGS" },
    files: { bucketCors: (origin) => ({ rules: [{ allowed: { origins: [origin], methods: ["PUT", "GET"] } }] }), storagePreflight: async (): Promise<HealthOutcome> => ({ ok: true }) },
    randomKey: () => "generated-session-key-0123456789abcdef0123456789ab",
    healthTimeoutMs: 0,
    sleep: async () => {},
  });
  return { cloud, d1, target, events, runtimeSecrets };
}

/**
 * Deploys the account's auth app as account setup leaves it (plan-v0.2.0 §5.2 page 1): the Worker
 * `prototype-auth` with its registry bound as `DB` on local D1.
 */
export async function withAuthApp(world: World): Promise<string> {
  const created = await world.d1.api("POST", `/accounts/${ACCOUNT}/d1/database`, { name: "prototype-auth-registry" });
  const registryId = (created.body as { result: { uuid: string } }).result.uuid;
  world.cloud.workers.set(AUTH_APP_WORKER, { secrets: new Map(), enabled: true, previews: false, bindings: [{ type: "d1", name: "DB", id: registryId } as { type: string; name: string }] });
  world.registryId = registryId;
  return registryId;
}

/**
 * The v0.1.x email prerequisite a production preflight still reads on this base: an email domain
 * in the account settings record with its zone onboarded for Email Sending. C 34a removes that
 * check (DEC-0698); this state is then simply unread (DEC-0768).
 */
export function withLegacyEmailDomain(cloud: FakeCloud): void {
  cloud.objectBodies.set("sst-state/framework/account.json", { emailDomain: "example.test" });
  cloud.buckets.get("sst-state")!.add("framework/account.json");
  cloud.zones.get("example.test")!.sending.push({ id: "sending1", name: "example.test", enabled: true, pollsUntilEnabled: 0 });
}

/** The stage's databases on local D1, by name. */
export async function stageDatabases(world: World, s: Stage): Promise<{ name: string; id: string }[]> {
  const listed = await world.d1.api("GET", `/accounts/${ACCOUNT}/d1/database?per_page=100`);
  const all = (listed.body as { result: { name: string; uuid: string }[] }).result;
  return all.filter((d) => d.name.startsWith(`${workerOf(s)}-db-`)).map((d) => ({ name: d.name, id: d.uuid })).sort((a, b) => (a.name < b.name ? -1 : 1));
}

export async function rows(world: World, uuid: string, sql: string): Promise<Record<string, unknown>[]> {
  return (await world.d1.database(uuid).prepare(sql).all<Record<string, unknown>>()).results;
}

export const io = captureIo;
