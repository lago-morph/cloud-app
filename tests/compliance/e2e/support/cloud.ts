/**
 * Cloud probes for the E2E scenarios.
 *
 * - Cloudflare D1 databases of a stage, by PROV-REQ-002's exact pattern `^<app>-<stage>-db-(\d+)$`,
 *   and the shared log bucket, read through the Cloudflare API. The proxy injects the API token
 *   for api.cloudflare.com; no Authorization header is sent (plan §10.6). Node `fetch` uses the
 *   proxy because the driver sets `NODE_USE_ENV_PROXY=1` for cloud targets.
 * - Hooks owned by D-T2 under `tests/compliance/criteria/_cloud/` (plan §5 "Phase D test-case
 *   authors"): the log-bucket listing and the stage-resource probe. Until a hook exists, a test
 *   that needs it reports a missing prerequisite (`blocked`), never a pass. The expected hook
 *   interfaces are recorded in DEC-0279, DEC-0302…DEC-0310 (docs/decisions/decision-log.md, Item: C-T4).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { prerequisiteMissing } from "../../harness/index.js";
import { REPO_ROOT } from "./process.js";

/** The shared log bucket's name on Cloudflare (log.md §2). */
export const CLOUDFLARE_LOG_BUCKET = "prototype-logs";

function accountId(): string {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (id === undefined || id === "") return prerequisiteMissing("CLOUDFLARE_ACCOUNT_ID is not set");
  return id;
}

interface CfEnvelope<T> {
  readonly success: boolean;
  readonly result: T;
  readonly errors?: readonly { readonly code?: number; readonly message?: string }[];
}

async function cloudflareGet<T>(path: string): Promise<{ readonly status: number; readonly body: CfEnvelope<T> | undefined }> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { "user-agent": "prototype-framework-compliance/0.1.0", accept: "application/json" },
    signal: AbortSignal.timeout(55_000),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as CfEnvelope<T> };
  } catch {
    return { status: response.status, body: undefined };
  }
}

/** The stage's databases on Cloudflare D1 matching `^<app>-<stage>-db-(\d+)$` exactly. */
export async function cloudflareStageDatabases(app: string, stage: string): Promise<string[]> {
  const pattern = new RegExp(`^${app}-${stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-db-(\\d+)$`);
  const { status, body } = await cloudflareGet<readonly { readonly name: string }[]>(`/accounts/${accountId()}/d1/database?name=${encodeURIComponent(`${app}-${stage}-db-`)}&per_page=100`);
  if (body === undefined || !body.success) throw new Error(`listing D1 databases failed: status ${String(status)}, ${JSON.stringify(body?.errors ?? [])}`);
  return body.result.map((d) => d.name).filter((name) => pattern.test(name)).sort();
}

/** Whether the account's shared log bucket exists. */
export async function cloudflareLogBucketExists(): Promise<boolean> {
  const { status, body } = await cloudflareGet<unknown>(`/accounts/${accountId()}/r2/buckets/${CLOUDFLARE_LOG_BUCKET}`);
  if (status === 404) return false;
  if (body === undefined || !body.success) throw new Error(`reading the R2 bucket ${CLOUDFLARE_LOG_BUCKET} failed: status ${String(status)}`);
  return true;
}

/** Databases of a stage on this run's cloud. */
export async function stageDatabases(targetName: string, app: string, stage: string): Promise<string[]> {
  if (targetName === "cloudflare") return cloudflareStageDatabases(app, stage);
  return prerequisiteMissing(`no database probe for target ${targetName}`);
}

// ---------------------------------------------------------------------------------------------
// D-T2 hooks

const HOOK_DIR = join(REPO_ROOT, "tests", "compliance", "criteria", "_cloud");

async function loadHook<T>(module: string, exportName: string): Promise<T> {
  const ts = join(HOOK_DIR, `${module}.ts`);
  if (!existsSync(ts)) return prerequisiteMissing(`the cloud test hook tests/compliance/criteria/_cloud/${module}.ts (D-T2) does not exist yet`);
  const loaded = (await import(pathToFileURL(ts).href)) as Record<string, unknown>;
  const fn = loaded[exportName];
  if (typeof fn !== "function") return prerequisiteMissing(`tests/compliance/criteria/_cloud/${module}.ts does not export ${exportName}()`);
  return fn as T;
}

export interface StoredLogEntry {
  /** The object key in the shared log bucket. */
  readonly key: string;
  /** The object's body (one log entry as JSON). */
  readonly body: string;
}

/** Hook `_cloud/logs.ts`: `listLogEntries({ target, app, stage, day })` — the bucket's entries under `<app>/<stage>/<yyyy>/<mm>/<dd>/`. */
export type ListLogEntries = (input: { readonly target: string; readonly app: string; readonly stage: string; readonly day: string }) => Promise<readonly StoredLogEntry[]>;

/** Entries of one UTC day (`yyyy/mm/dd`) of a stage in the account's shared log bucket. */
export async function cloudLogEntries(targetName: string, app: string, stage: string, day: string): Promise<readonly StoredLogEntry[]> {
  const list = await loadHook<ListLogEntries>("logs", "listLogEntries");
  return list({ target: targetName, app, stage, day });
}

/** Hook `_cloud/stage-resources.ts`: `listStageResources({ target, app, stage })` — every resource of the stage still present, as `<kind> <id>` / `database <name>`. */
export type ListStageResources = (input: { readonly target: string; readonly app: string; readonly stage: string }) => Promise<readonly string[]>;

export async function cloudStageResources(targetName: string, app: string, stage: string): Promise<readonly string[]> {
  const list = await loadHook<ListStageResources>("stage-resources", "listStageResources");
  return list({ target: targetName, app, stage });
}

/** `yyyy/mm/dd` of a time in UTC (LOG-REQ-004 key layout). */
export function utcDay(time: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${String(time.getUTCFullYear())}/${p(time.getUTCMonth() + 1)}/${p(time.getUTCDate())}`;
}
