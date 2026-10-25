/**
 * Stage-resource probe (plan item D-T2; DEC-0279 `_cloud/stage-resources.ts`): every resource of
 * PROV's removal list still present for one stage, read independently of the framework's own
 * `listStageResources` through the Cloudflare API and the state home (CF-AC-002, PROV-AC-003,
 * COMPL-AC-004, E2E-012).
 *
 * Which resources (cloudflare.md "Deploy mechanics", PROV §2 "Removal", DEC-0084, DEC-0100):
 * - D1 databases by PROV-REQ-002's exact pattern `^<app>-<stage>-db-(\d+)$`;
 * - the stage's Worker (its secrets and `workers.dev` route belong to it), R2 bucket and R2 API
 *   token, matched by name;
 * - the stage's provisioning state objects in the state home bucket `sst-state` (DEC-0084:
 *   `remove` deletes them itself because `sst remove` leaves them).
 * Log entries are not stage resources: they stay after removal by design (PROV-AC-003).
 *
 * Matching by name (assumption, DEC-0359…DEC-0366, decision log Item: D-T): physical names are what
 * the provisioning tool generates (PROV §2 "Stage resources"), so the probe takes a Worker,
 * bucket, token or state object as the stage's when its name contains both the app name and
 * the stage name as hyphen- or slash-delimited parts. Stage names of test runs carry 15 random
 * characters (COMPL §2), so another stage's resource never matches.
 *
 * Usage per call: about 5 Cloudflare API requests (D1 list, Workers list, buckets list, tokens
 * list, plus one more page each only for large accounts) and one state-home listing through
 * R2's S3 endpoint (plus the read-only token's own requests once per process). No D1 rows are
 * read or written.
 */
import { createHash } from "node:crypto";
import { prerequisiteMissing } from "../../harness/index.js";
import { accountId, cfApi, cfList, cfOk, failure } from "./api.js";
import { bucketExists, LOG_BUCKET, listKeys, STATE_BUCKET } from "./r2.js";

export interface StageRef {
  readonly app: string;
  readonly stage: string;
}

export interface StageResourceDetails {
  readonly databases: readonly { readonly name: string; readonly uuid: string }[];
  readonly workers: readonly string[];
  readonly buckets: readonly string[];
  readonly tokens: readonly { readonly id: string; readonly name: string }[];
  readonly stateObjects: readonly string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** PROV-REQ-002's anchored database pattern for one stage. */
export function databasePattern(s: StageRef): RegExp {
  return new RegExp(`^${escapeRegExp(s.app)}-${escapeRegExp(s.stage)}-db-(\\d+)$`);
}

/** Whether `name` names a resource of the stage: both names as whole hyphen/slash/dot/underscore-delimited parts. */
export function namesStage(name: string, s: StageRef): boolean {
  const lower = name.toLowerCase();
  const part = (p: string): boolean => new RegExp(`(?:^|[-/._])${escapeRegExp(p.toLowerCase())}(?:$|[-/._])`).test(lower);
  return part(s.stage) && part(s.app);
}

/** Every D1 database of the account (name and UUID), bounded. */
export async function accountDatabases(): Promise<{ name: string; uuid: string }[]> {
  return cfList<{ name: string; uuid: string }>("listing D1 databases", `/accounts/${accountId()}/d1/database`, 100);
}

/** The stage's D1 databases by the exact pattern, sorted by name. */
export async function stageDatabases(s: StageRef): Promise<{ name: string; uuid: string }[]> {
  const pattern = databasePattern(s);
  const listed = await cfList<{ name: string; uuid: string }>("listing D1 databases", `/accounts/${accountId()}/d1/database?name=${encodeURIComponent(s.stage)}`, 100);
  return listed.filter((d) => pattern.test(d.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Names of every Worker script of the account. */
export async function accountWorkers(): Promise<string[]> {
  const scripts = await cfOk<readonly { id: string }[]>("listing Worker scripts", "GET", `/accounts/${accountId()}/workers/scripts`);
  return scripts.map((w) => w.id);
}

/** The stage's Worker scripts (normally exactly one while the stage exists). */
export async function stageWorkers(s: StageRef): Promise<string[]> {
  return (await accountWorkers()).filter((n) => namesStage(n, s)).sort();
}

/** The one Worker script of a deployed stage; throws when there is none or more than one. */
export async function stageWorker(s: StageRef): Promise<string> {
  const found = await stageWorkers(s);
  if (found.length !== 1) throw new Error(`expected exactly one Worker of ${s.app} stage ${s.stage}, found ${String(found.length)}${found.length > 0 ? `: ${found.join(", ")}` : ""}`);
  return found[0] ?? "";
}

/** Every R2 bucket name of the account (cursor-paged, bounded). */
export async function accountBuckets(): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const r = await cfApi<{ buckets: readonly { name: string }[] }>("GET", `/accounts/${accountId()}/r2/buckets?per_page=1000${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`);
    if (r.status !== 200 || r.body === undefined || !r.body.success) throw failure("listing R2 buckets", r);
    names.push(...r.body.result.buckets.map((b) => b.name));
    cursor = r.body.result_info?.cursor;
    if (cursor === undefined || cursor === "" || r.body.result.buckets.length === 0) return names;
  }
  throw new Error("listing R2 buckets: more than 10 pages; the hook does not list further");
}

/** Every account API token (ID and name), bounded. */
export async function accountTokens(): Promise<{ id: string; name: string }[]> {
  const tokens = await cfList<{ id: string; name?: string }>("listing account API tokens", `/accounts/${accountId()}/tokens`, 50);
  return tokens.map((t) => ({ id: t.id, name: t.name ?? "" }));
}

/** Keys of the state home that belong to the stage (a path part equal to the stage name, and the app name). */
export async function stageStateObjects(s: StageRef): Promise<string[]> {
  const keys = await listKeys(STATE_BUCKET, "");
  return keys.filter((k) => namesStage(k, s));
}

/** Everything of the stage still present, structured. */
export async function stageResourceDetails(s: StageRef): Promise<StageResourceDetails> {
  const [databases, workers, buckets, tokens, stateObjects] = [await stageDatabases(s), await stageWorkers(s), await accountBuckets(), await accountTokens(), await stageStateObjects(s)];
  return {
    databases,
    workers,
    buckets: buckets.filter((b) => namesStage(b, s)).sort(),
    tokens: tokens.filter((t) => namesStage(t.name, s)),
    stateObjects,
  };
}

/** The leftover strings, in the form the driver and `remove` print them (`database <name>`, `<kind> <id>`). */
export function leftoverStrings(d: StageResourceDetails): string[] {
  return [
    ...d.databases.map((x) => `database ${x.name}`),
    ...d.workers.map((x) => `Worker ${x}`),
    ...d.buckets.map((x) => `R2 bucket ${x}`),
    ...d.tokens.map((x) => `R2 API token ${x.id}`),
    ...d.stateObjects.map((x) => `state object ${STATE_BUCKET}/${x}`),
  ];
}

/** DEC-0279 hook: every resource of PROV's removal list still present for the stage. */
export async function listStageResources(input: { readonly target: string; readonly app: string; readonly stage: string }): Promise<string[]> {
  if (input.target !== "cloudflare") return prerequisiteMissing(`no stage-resource probe for target ${input.target} (AWS deferred to a later release, DEC-0508)`);
  if (!input.stage.startsWith("test-")) throw new Error(`the stage-resource probe handles test stages only, not ${input.stage}`);
  return leftoverStrings(await stageResourceDetails(input));
}

/**
 * The account-level shared resources (PROV-REQ-004, DEC-0084, DEC-0086): whether the shared log
 * bucket and the state home exist, and a SHA-256 of the account's `workers.dev` subdomain (the
 * subdomain is personal and never printed, DEC-0086), and whether the mail sink's bucket and
 * Worker `prototype-mailsink` exist (MAIL-REQ-005: stage removal never touches them).
 * 5 Cloudflare API requests.
 */
export async function sharedResources(): Promise<{ logBucket: boolean; stateHome: boolean; subdomainSha256: string; mailSinkBucket: boolean; mailSinkWorker: boolean }> {
  const sub = await cfOk<{ subdomain?: string }>("reading the account's workers.dev subdomain", "GET", `/accounts/${accountId()}/workers/subdomain`);
  return {
    logBucket: await bucketExists(LOG_BUCKET),
    stateHome: await bucketExists(STATE_BUCKET),
    subdomainSha256: createHash("sha256").update(sub.subdomain ?? "").digest("hex"),
    mailSinkBucket: await bucketExists(MAIL_SINK),
    mailSinkWorker: (await accountWorkers()).includes(MAIL_SINK),
  };
}

/** The account-level mail sink's Worker and bucket name (MAIL §2). */
export const MAIL_SINK = "prototype-mailsink";
