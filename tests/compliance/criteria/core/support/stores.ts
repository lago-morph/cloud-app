/**
 * Where a deployment's stored state lives, per target, for the C-T1 criteria: the test secret's
 * value, the stored log entries, and the cloud test hooks.
 *
 * - Locally the reference app's log entries are JSON lines in `apps/reference/.logs/<day>.log`
 *   (LOG-REQ-003) and its secrets are assignments in `apps/reference/.dev.vars` (SEC-REQ-003).
 * - On a cloud, entries are objects in the shared log bucket under
 *   `<app>/<stage>/<yyyy>/<mm>/<dd>/…` (LOG-REQ-004) and secrets are in the target's store. The
 *   tests reach those through the cloud test hooks of plan item D-T2
 *   (`tests/compliance/criteria/_cloud/index.ts`, interface `CloudHooks` below). Until that module
 *   exists, a test needing it reports a missing prerequisite (recorded `blocked`, never passed).
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { prerequisiteMissing, waitFor } from "../../../harness/index.js";
import { readDevVars } from "./processes.js";
import { REFERENCE_DIR, REPO_ROOT, runDeployment, secretLocation, utcDay } from "./repo.js";

// ---------------------------------------------------------------------------------------------
// Cloud test hooks (implemented by D-T2)
// ---------------------------------------------------------------------------------------------

export interface HookStage {
  readonly app: string;
  readonly stage: string;
}

/** What the C-T1 cloud criteria need from the cloud test hooks (plan D-T2). */
export interface CloudHooks {
  /** Deletes secret `name` (logical name) of the stage directly in the target's store (SEC-AC-005 test hook). */
  deleteSecret(stage: HookStage, name: string): Promise<void>;
  /** The locations (SEC-REQ-003, e.g. `SECRET_API_KEY`) of the secrets set on the stage, read from the target's store. */
  secretLocations(stage: HookStage): Promise<readonly string[]>;
  /** Whether the account's shared log bucket exists. */
  logBucketExists(): Promise<boolean>;
  /** Every object key in the shared log bucket that starts with `prefix`. */
  listLogKeys(prefix: string): Promise<readonly string[]>;
  /** The content of one object of the shared log bucket. */
  readLogObject(key: string): Promise<string>;
}

const HOOKS_MODULE = join(REPO_ROOT, "tests", "compliance", "criteria", "_cloud", "index.ts");

/** The cloud test hooks for this run's target; a missing prerequisite while D-T2 has not built them. */
export async function cloudHooks(what: string): Promise<CloudHooks> {
  const target = runDeployment().target;
  if (!existsSync(HOOKS_MODULE)) prerequisiteMissing(`${what} needs the ${target} cloud test hooks (tests/compliance/criteria/_cloud/index.ts, plan item D-T2), which do not exist yet`);
  const mod = (await import(pathToFileURL(HOOKS_MODULE).href)) as { cloudHooks?: (target: string) => CloudHooks | Promise<CloudHooks> };
  if (typeof mod.cloudHooks !== "function") prerequisiteMissing(`${what}: tests/compliance/criteria/_cloud/index.ts does not export cloudHooks(target)`);
  return mod.cloudHooks(target);
}

// ---------------------------------------------------------------------------------------------
// The test secret
// ---------------------------------------------------------------------------------------------

/** Environment variable through which a cloud run hands the tests the value it set for `apiKey`. */
export const TEST_SECRET_ENV = "COMPLIANCE_SECRET_API_KEY";

/**
 * The value of the reference app's test secret `apiKey` on this run's deployment. Locally it is
 * read from its SEC-REQ-003 location in `apps/reference/.dev.vars`; on a cloud the store cannot be
 * read back, so the runner passes the value it set in `COMPLIANCE_SECRET_API_KEY`. Without a
 * value (or with one too short to scan for meaningfully) the test reports a missing prerequisite.
 */
export function testSecretValue(): string {
  const run = runDeployment();
  const location = secretLocation(run.target, run.app, run.stage, "apiKey");
  const value = process.env[TEST_SECRET_ENV] ?? (run.isCloud ? undefined : readDevVars(REFERENCE_DIR).get(location));
  if (value === undefined || value === "") {
    prerequisiteMissing(
      run.isCloud
        ? `the test secret apiKey's value is not available to the tests: the runner sets it on the stage and passes it in ${TEST_SECRET_ENV}`
        : `the reference app's test secret apiKey has no value in apps/reference/.dev.vars (${location}): set it before the run with \`npm run secrets -- set apiKey --target local --stage local\` in apps/reference (value on stdin)`,
    );
  }
  if (value.length < 12) prerequisiteMissing(`the test secret apiKey's value is shorter than 12 characters, too short for a meaningful leak scan; use a long random value`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Stored log entries
// ---------------------------------------------------------------------------------------------

export interface StoredEntry {
  /** Where it is stored: `<file>:<line>` locally, the object key on a cloud. */
  readonly where: string;
  readonly raw: string;
  /** The parsed JSON, or undefined when the stored text is not JSON. */
  readonly entry: Record<string, unknown> | undefined;
}

function parse(raw: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function localEntries(appDir: string, days: readonly string[]): Promise<StoredEntry[]> {
  const dir = join(appDir, ".logs");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: StoredEntry[] = [];
  for (const name of names.filter((n) => days.some((d) => n === `${d}.log`)).sort()) {
    const lines = (await readFile(join(dir, name), "utf8")).split("\n");
    lines.forEach((raw, i) => {
      if (raw.trim() !== "") out.push({ where: `.logs/${name}:${String(i + 1)}`, raw, entry: parse(raw) });
    });
  }
  return out;
}

/** `<app>/<stage>/<yyyy>/<mm>/<dd>/` (LOG-REQ-004) for one UTC day. */
export function logDayPrefix(app: string, stage: string, day: string): string {
  const [y, m, d] = day.split("-");
  return `${app}/${stage}/${y ?? ""}/${m ?? ""}/${d ?? ""}/`;
}

/** The days a run's entries can be stored under: today and yesterday (UTC), so a run crossing midnight is covered. */
function recentDays(): string[] {
  const now = Date.now();
  return [utcDay(new Date(now - 86_400_000)), utcDay(new Date(now))];
}

/**
 * The stored entries of the run's reference deployment for today and yesterday (UTC). With
 * `requestId`, on a cloud only objects whose key names that ID are read (the key layout lets them
 * be found by listing alone, LOG §2 "Finding entries"), so a lookup reads few objects.
 */
export async function storedEntries(options: { readonly requestId?: string; readonly what: string; readonly app?: string; readonly stage?: string }): Promise<StoredEntry[]> {
  const run = runDeployment();
  const app = options.app ?? run.app;
  const stage = options.stage ?? run.stage;
  if (!run.isCloud) {
    const entries = await localEntries(REFERENCE_DIR, recentDays());
    return options.requestId === undefined ? entries : entries.filter((e) => e.entry?.requestId === options.requestId);
  }
  const hooks = await cloudHooks(options.what);
  const out: StoredEntry[] = [];
  for (const day of recentDays()) {
    const keys = await hooks.listLogKeys(logDayPrefix(app, stage, day));
    for (const key of keys) {
      if (options.requestId !== undefined && !key.endsWith(`-${options.requestId}.json`)) continue;
      const raw = await hooks.readLogObject(key);
      out.push({ where: key, raw, entry: parse(raw) });
    }
  }
  return out;
}

/** Bounded wait for the stored entries of one request ID (local capture and cloud writes are asynchronous). */
export async function waitForEntries(requestId: string, what: string, predicate: (entries: StoredEntry[]) => boolean = (e) => e.length > 0): Promise<StoredEntry[]> {
  const isCloud = runDeployment().isCloud;
  // Fail fast (as a missing prerequisite) when the hooks are absent, instead of inside the wait.
  if (isCloud) await cloudHooks(what);
  const timeoutMs = isCloud ? 30_000 : 15_000;
  return waitFor(
    async () => {
      const entries = await storedEntries({ requestId, what });
      return predicate(entries) ? entries : undefined;
    },
    { what: `stored log entries with requestId ${requestId} (${what})`, timeoutMs, intervalMs: 500 },
  );
}
