/**
 * The Cloudflare account's shared resources as the PROV, CF and COMPL criteria read them,
 * written from PROV §2 ("Signing record", "Backup before a production removal"), DEC-0543 and
 * DEC-0550, never from the implementation:
 * - the backup bucket `prototype-backups` and its lifecycle rule `framework-backups-retention`,
 *   which deletes every object PAR-311 after it was written (DEC-0543);
 * - the account's R2 signing credential: the account API token `prototype-r2-signing`, allowed
 *   "Workers R2 Storage Bucket Item Write" on every bucket of the account and denied it on the
 *   account buckets (`ACCOUNT_BUCKETS`), and its signing record `framework/r2-signing.json` in
 *   the state home, `{ tokenId, accessKeyId, secretAccessKey, deniedBuckets }` (DEC-0550).
 *
 * The record holds a credential: its text is handled in memory only and compared by digest; no
 * function here prints it. Writing or deleting the record (tests that need the credential to read
 * as absent) goes through a write token scoped to the state home (`withR2Access`).
 *
 * Usage: `backupLifecycle` 1 Cloudflare API request, `putBackupLifecycle` 1, `accountTokens` 1
 * per 50 tokens, `tokenDetail` 1, `permissionGroupNames` 1; record reads 0 (S3 endpoint), record
 * writes 4 (the scoped token's own requests).
 */
import { createHash } from "node:crypto";
import { accountId, cfApi, cfList, cfOk, failure } from "./api.js";
import { BACKUP_BUCKET, LOG_BUCKET, readObjectIfExists, SIGNING_RECORD_KEY, STATE_BUCKET, withR2Access } from "./r2.js";

/** The mail sink's Worker and bucket name (MAIL §2). */
export const MAIL_SINK = "prototype-mailsink";
/** The account's R2 signing token (DEC-0550). */
export const SIGNING_TOKEN_NAME = "prototype-r2-signing";
/** The account buckets the signing token is denied on (PROV §2 "Signing record"). */
export const ACCOUNT_BUCKETS: readonly string[] = Object.freeze([LOG_BUCKET, STATE_BUCKET, MAIL_SINK, BACKUP_BUCKET]);
/** The backup bucket's lifecycle rule (PAR-311, DEC-0543). */
export const BACKUP_RULE_ID = "framework-backups-retention";
/** "Workers R2 Storage Bucket Item Write", the signing token's permission group. */
export const ITEM_WRITE = "Workers R2 Storage Bucket Item Write";

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

/** Every account API token (ID and name), bounded. */
export async function accountTokens(): Promise<{ id: string; name: string }[]> {
  const tokens = await cfList<{ id: string; name?: string }>("listing account API tokens", `/accounts/${accountId()}/tokens`, 50);
  return tokens.map((t) => ({ id: t.id, name: t.name ?? "" }));
}

export interface TokenPolicy {
  readonly effect: string;
  readonly permission_groups: readonly { readonly id: string; readonly name?: string }[];
  readonly resources: Readonly<Record<string, unknown>>;
}

/** One account token's name and policies. */
export async function tokenDetail(id: string): Promise<{ name: string; policies: readonly TokenPolicy[] }> {
  const t = await cfOk<{ name?: string; policies?: readonly TokenPolicy[] }>(`reading API token ${id}`, "GET", `/accounts/${accountId()}/tokens/${id}`);
  return { name: t.name ?? "", policies: t.policies ?? [] };
}

/** Permission group ID → name, from the account's listing. */
export async function permissionGroupNames(): Promise<Map<string, string>> {
  const groups = await cfOk<readonly { id: string; name: string }[]>("listing token permission groups", "GET", `/accounts/${accountId()}/tokens/permission_groups`);
  return new Map(groups.map((g) => [g.id, g.name]));
}

/** The resource keys of a policy, nested ones included (`{ account: { bucket: "*" } }` → both keys). */
export function resourceKeys(resources: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(resources).flatMap(([k, v]) => [k, ...(typeof v === "object" && v !== null ? resourceKeys(v as Record<string, unknown>) : [])]);
}

/**
 * What a signing token's policies lack, by DEC-0550: an `allow` of "Workers R2 Storage Bucket
 * Item Write" on `com.cloudflare.api.account.<account>: "*"`, and a `deny` of the same group on
 * every account bucket `com.cloudflare.edge.r2.bucket.<account>_default_<bucket>`, nested under
 * the account key. Empty when it has both.
 */
export function signingPolicyProblems(policies: readonly TokenPolicy[], account: string, groupNames: ReadonlyMap<string, string>): string[] {
  const grants = (p: TokenPolicy): boolean => p.permission_groups.some((g) => (g.name ?? groupNames.get(g.id)) === ITEM_WRITE);
  const accountKey = `com.cloudflare.api.account.${account}`;
  const problems: string[] = [];
  const allow = policies.filter((p) => p.effect === "allow" && grants(p));
  if (!allow.some((p) => p.resources[accountKey] === "*")) problems.push(`no allow policy of "${ITEM_WRITE}" on ${accountKey}: "*"`);
  const deny = policies.filter((p) => p.effect === "deny" && grants(p));
  const denied = new Set(deny.flatMap((p) => {
    const nested = p.resources[accountKey];
    return typeof nested === "object" && nested !== null ? Object.keys(nested as Record<string, unknown>) : [];
  }));
  for (const bucket of ACCOUNT_BUCKETS) {
    const key = `com.cloudflare.edge.r2.bucket.${account}_default_${bucket}`;
    if (!denied.has(key)) problems.push(`no deny policy of "${ITEM_WRITE}" on account bucket ${bucket} nested under ${accountKey}`);
  }
  return problems;
}

/** The tokens named `prototype-r2-signing`. */
export async function signingTokens(): Promise<{ id: string; name: string }[]> {
  return (await accountTokens()).filter((t) => t.name === SIGNING_TOKEN_NAME);
}

// ---------------------------------------------------------------------------------------------
// Signing record
// ---------------------------------------------------------------------------------------------

export interface SigningRecord {
  readonly tokenId?: unknown;
  readonly accessKeyId?: unknown;
  readonly secretAccessKey?: unknown;
  readonly deniedBuckets?: unknown;
}

/** The signing record's text, or undefined when the state home has none. Never print it. */
export function readSigningRecordText(): Promise<string | undefined> {
  return readObjectIfExists(STATE_BUCKET, SIGNING_RECORD_KEY);
}

export function parseSigningRecord(text: string): SigningRecord {
  return JSON.parse(text) as SigningRecord;
}

/** The record's access key ID (not a secret: it is the token's ID, DEC-0100), or undefined. */
export async function signingAccessKeyId(): Promise<string | undefined> {
  const text = await readSigningRecordText();
  if (text === undefined) return undefined;
  const id = parseSigningRecord(text).accessKeyId;
  return typeof id === "string" ? id : undefined;
}

/** What makes a record count as absent or malformed by PROV §2 "Signing record"; empty for a complete record. */
export function signingRecordProblems(record: SigningRecord): string[] {
  const problems: string[] = [];
  for (const field of ["tokenId", "accessKeyId", "secretAccessKey"] as const) {
    if (typeof record[field] !== "string" || record[field] === "") problems.push(`${field} is not a non-empty string`);
  }
  if (record.tokenId !== record.accessKeyId) problems.push("accessKeyId is not the token ID (DEC-0100)");
  const denied = Array.isArray(record.deniedBuckets) ? (record.deniedBuckets as unknown[]) : undefined;
  if (denied === undefined) problems.push("deniedBuckets is missing");
  else for (const b of ACCOUNT_BUCKETS) if (!denied.includes(b)) problems.push(`deniedBuckets lacks ${b}`);
  return problems;
}

/** Writes the signing record's text (a test making the credential read as absent, then restoring it). */
export async function writeSigningRecordText(text: string): Promise<void> {
  await withR2Access([STATE_BUCKET], "write", (a) => a.put(STATE_BUCKET, SIGNING_RECORD_KEY, text, "application/json"));
}

/**
 * A record as one written before the backup bucket existed (DEC-0550 "Re-run of setup-account":
 * every record written before that merge has no `deniedBuckets`), with the same credentials, so
 * running stages keep working while it is in place.
 */
export function legacySigningRecordText(text: string): string {
  const { deniedBuckets: _dropped, ...rest } = parseSigningRecord(text) as Record<string, unknown>;
  return JSON.stringify(rest);
}

// ---------------------------------------------------------------------------------------------
// Backup bucket lifecycle (PAR-311)
// ---------------------------------------------------------------------------------------------

export interface LifecycleRule {
  readonly id?: string;
  readonly enabled?: boolean;
  readonly conditions?: { readonly prefix?: string };
  readonly deleteObjectsTransition?: { readonly condition?: { readonly type?: string; readonly maxAge?: number } };
  readonly [k: string]: unknown;
}

/** The backup bucket's lifecycle rules, or undefined when the bucket does not exist. */
export async function backupLifecycle(): Promise<LifecycleRule[] | undefined> {
  const r = await cfApi<{ rules?: LifecycleRule[] }>("GET", `/accounts/${accountId()}/r2/buckets/${BACKUP_BUCKET}/lifecycle`);
  if (r.status === 404) return undefined;
  if (r.status !== 200 || r.body?.success !== true) throw failure(`reading the lifecycle rules of ${BACKUP_BUCKET}`, r);
  return [...(r.body.result.rules ?? [])];
}

/** Replaces the backup bucket's lifecycle rules (a test removing the retention rule, then restoring it). */
export async function putBackupLifecycle(rules: readonly LifecycleRule[]): Promise<void> {
  await cfOk(`writing the lifecycle rules of ${BACKUP_BUCKET}`, "PUT", `/accounts/${accountId()}/r2/buckets/${BACKUP_BUCKET}/lifecycle`, { rules });
}

/**
 * What the retention rule lacks by DEC-0543: it exists under its ID, is enabled, applies to every
 * object (empty or no prefix) and deletes objects `retentionDays` (PAR-311) after they were
 * written (R2's `Age` condition, `maxAge` in seconds). Empty when it is as specified.
 */
export function retentionRuleProblems(rules: readonly LifecycleRule[] | undefined, retentionDays: number): string[] {
  if (rules === undefined) return [`the bucket ${BACKUP_BUCKET} does not exist`];
  const rule = rules.find((r) => r.id === BACKUP_RULE_ID);
  if (rule === undefined) return [`no lifecycle rule ${BACKUP_RULE_ID} on ${BACKUP_BUCKET}`];
  const problems: string[] = [];
  if (rule.enabled !== true) problems.push("the rule is not enabled");
  if ((rule.conditions?.prefix ?? "") !== "") problems.push("the rule does not apply to every object (it has a prefix)");
  const c = rule.deleteObjectsTransition?.condition;
  if (c?.type !== "Age" || c.maxAge !== retentionDays * 86_400) problems.push(`the rule does not delete objects ${String(retentionDays)} days (${String(retentionDays * 86_400)} s) after they were written`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Shared resources for before/after comparisons
// ---------------------------------------------------------------------------------------------

/**
 * The account's signing credential and backup bucket in comparable form: whether the backup
 * bucket exists, its lifecycle rules, a digest of the signing record (never its text), and the
 * IDs of the tokens named `prototype-r2-signing`. 3 Cloudflare API requests (more for large token
 * listings); the record read is free (S3 endpoint).
 */
export async function signingAndBackupState(): Promise<{ backupBucketLifecycle: LifecycleRule[] | null; signingRecordSha256: string | null; signingTokenIds: string[] }> {
  const record = await readSigningRecordText();
  return {
    backupBucketLifecycle: (await backupLifecycle()) ?? null,
    signingRecordSha256: record === undefined ? null : sha256Hex(record),
    signingTokenIds: (await signingTokens()).map((t) => t.id).sort(),
  };
}
