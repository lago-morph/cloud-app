/**
 * The account's backup bucket and the production `remove`'s backup (DEC-0543; provisioning.md
 * §2 "Removal" and "Restoring a removed production stage").
 *
 * - **Bucket.** `prototype-backups`, an account-level shared resource that `setup-account`
 *   creates, with one lifecycle rule `framework-backups-retention` deleting every object PAR-311
 *   (30 days) after it was written. Stage removal never touches it.
 * - **Backup.** Under `<app>/<stage>/<UTC time yyyymmddThhmmssZ>/`:
 *   - `database/<database name>.sql`: D1's own export of each of the stage's databases;
 *   - `files/<key>`: each object of the stage bucket, its bytes and content type unchanged
 *     (keys keep their U+0001 ending, DEC-0430);
 *   - `manifest.json`, written last: app, stage, time, the databases and the number of files.
 *   Afterwards the prefix is listed again and must hold every object written; otherwise the
 *   backup fails and `remove` deletes nothing.
 *
 * Objects travel through the R2 object endpoints of `api.cloudflare.com` as bytes
 * (`CloudflareBytesApi`), with the deploy token. Not yet exercised against the live API: the
 * bytes `PUT` and `GET` of these endpoints are read from Cloudflare's API reference, like the
 * account settings record's (DEC-0334).
 */
import type { SharedResource, Stage, StageBackup, StageDatabase } from "../core/operations.js";
import { describeFailure, resultOf, type CloudflareApi, type CloudflareBytesApi } from "./api.js";
import { inspectBucket } from "./account.js";
import { filesBucketName } from "./names.js";
import { listObjectKeys } from "./objects.js";

/** The account's backup bucket. */
export const BACKUP_BUCKET = "prototype-backups";
export const BACKUP_BUCKET_RESOURCE = `R2 bucket ${BACKUP_BUCKET}`;
/** PAR-311 in seconds (30 days). */
export const BACKUP_RETENTION_SECONDS = 30 * 86_400;
export const BACKUP_LIFECYCLE_RULE_ID = "framework-backups-retention";
export const BACKUP_LIFECYCLE_RESOURCE = `lifecycle rule of R2 bucket ${BACKUP_BUCKET} (PAR-311)`;

export const BACKUP_LIFECYCLE_RULE = Object.freeze({
  id: BACKUP_LIFECYCLE_RULE_ID,
  enabled: true,
  conditions: { prefix: "" },
  deleteObjectsTransition: { condition: { type: "Age", maxAge: BACKUP_RETENTION_SECONDS } },
});

const bucketPath = (accountId: string) => `/accounts/${accountId}/r2/buckets/${BACKUP_BUCKET}`;
const objectPath = (accountId: string, bucket: string, key: string) => `/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;

function hasRetentionRule(rules: unknown): boolean {
  if (!Array.isArray(rules)) return false;
  return rules.some(
    (rule: { id?: unknown; enabled?: unknown; conditions?: { prefix?: unknown }; deleteObjectsTransition?: { condition?: { type?: unknown; maxAge?: unknown } } }) =>
      rule.id === BACKUP_LIFECYCLE_RULE_ID &&
      rule.enabled === true &&
      (rule.conditions?.prefix ?? "") === "" &&
      rule.deleteObjectsTransition?.condition?.type === "Age" &&
      rule.deleteObjectsTransition.condition.maxAge === BACKUP_RETENTION_SECONDS,
  );
}

async function lifecycleRules(api: CloudflareApi, accountId: string): Promise<unknown[]> {
  const r = await api("GET", `${bucketPath(accountId)}/lifecycle`);
  if (r.status === 404) return [];
  const rules = resultOf<{ rules?: unknown } | null>(r, `reading the ${BACKUP_LIFECYCLE_RESOURCE}`)?.rules;
  return Array.isArray(rules) ? rules : [];
}

/** The backup bucket and its lifecycle rule as shared resources. Reads only. */
export async function inspectBackupResources(api: CloudflareApi, accountId: string): Promise<SharedResource[]> {
  const bucket = await inspectBucket(api, accountId, BACKUP_BUCKET);
  const rule: SharedResource = {
    name: BACKUP_LIFECYCLE_RESOURCE,
    state: bucket.state === "owned" && hasRetentionRule(await lifecycleRules(api, accountId)) ? "owned" : "absent",
  };
  return [bucket, rule];
}

/** Sets the backup bucket's lifecycle rule, keeping any other rules. */
export async function setBackupLifecycle(api: CloudflareApi, accountId: string): Promise<void> {
  const rules = await lifecycleRules(api, accountId);
  if (hasRetentionRule(rules)) return;
  const others = rules.filter((rule) => (rule as { id?: unknown } | null)?.id !== BACKUP_LIFECYCLE_RULE_ID);
  resultOf(await api("PUT", `${bucketPath(accountId)}/lifecycle`, { rules: [...others, BACKUP_LIFECYCLE_RULE] }), `setting the ${BACKUP_LIFECYCLE_RESOURCE}`);
}

/** `yyyymmddThhmmssZ`, the backup's time part. */
export const backupStamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export interface BackupOptions {
  readonly api: CloudflareApi;
  readonly bytes: CloudflareBytesApi;
  readonly accountId: string;
  /** D1's export of one database (`d1DatabaseOperations().exportDatabase`). */
  readonly exportDatabase: (database: StageDatabase) => Promise<Uint8Array>;
  readonly now?: () => number;
}

async function put(options: BackupOptions, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const r = await options.bytes("PUT", objectPath(options.accountId, BACKUP_BUCKET, key), { bytes, contentType });
  if (r.status < 200 || r.status >= 300) throw new Error(`writing ${key} to R2 bucket ${BACKUP_BUCKET} failed: ${describeFailure({ status: r.status, body: r.body })}`);
}

/** Writes the stage's backup; throws, naming the step, when anything fails. Deletes nothing. */
export async function backupStage(options: BackupOptions, stage: Stage, databases: readonly StageDatabase[]): Promise<StageBackup> {
  const { api, accountId } = options;
  const bucket = await inspectBucket(api, accountId, BACKUP_BUCKET);
  if (bucket.state !== "owned") {
    throw new Error(`the ${BACKUP_BUCKET_RESOURCE} is ${bucket.state === "absent" ? "missing" : "not this account's"}; run setup-account --target cloudflare first`);
  }
  const prefix = `${stage.app}/${stage.stage}/${backupStamp((options.now ?? Date.now)())}/`;
  const written: string[] = [];

  for (const database of databases) {
    const key = `${prefix}database/${database.name}.sql`;
    await put(options, key, await options.exportDatabase(database), "application/sql");
    written.push(key);
  }

  const filesBucket = filesBucketName(stage);
  const fileKeys = await listObjectKeys(api, accountId, filesBucket);
  for (const fileKey of fileKeys) {
    const r = await options.bytes("GET", objectPath(accountId, filesBucket, fileKey));
    if (r.status < 200 || r.status >= 300) throw new Error(`reading file ${JSON.stringify(fileKey)} of R2 bucket ${filesBucket} failed: ${describeFailure({ status: r.status, body: r.body })}`);
    const key = `${prefix}files/${fileKey}`;
    await put(options, key, r.bytes, r.contentType ?? "application/octet-stream");
    written.push(key);
  }

  const manifest = {
    app: stage.app,
    stage: stage.stage,
    createdAt: new Date((options.now ?? Date.now)()).toISOString(),
    databases: databases.map((d) => `database/${d.name}.sql`),
    filesBucket,
    files: fileKeys.length,
  };
  const manifestKey = `${prefix}manifest.json`;
  await put(options, manifestKey, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`), "application/json");
  written.push(manifestKey);

  const present = new Set(await listObjectKeys(api, accountId, BACKUP_BUCKET, prefix));
  const missing = written.filter((k) => !present.has(k));
  if (missing.length > 0) throw new Error(`the backup in R2 bucket ${BACKUP_BUCKET} lacks ${missing.length} object(s) after writing (${missing.slice(0, 3).join(", ")})`);

  return {
    location: `${BACKUP_BUCKET_RESOURCE}, prefix ${prefix}`,
    items: [...databases.map((d) => `database ${d.name}`), `${fileKeys.length} file(s) of R2 bucket ${filesBucket}`],
  };
}
