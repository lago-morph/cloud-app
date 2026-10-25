/**
 * The account's backup bucket and the production `remove`'s backup (DEC-0543; provisioning.md
 * §2 "Removal" and "Restoring a removed production stage").
 *
 * - **Bucket.** `prototype-backups`, an account-level shared resource that `setup-account`
 *   creates, with one lifecycle rule `framework-backups-retention` deleting every object PAR-311
 *   (30 days) after it was written. Stage removal never touches it.
 * - **Backup.** Under `<app>/<stage>/<UTC time yyyymmddThhmmssZ>/`:
 *   - `database/<database name>.sql`: D1's own export of each of the stage's databases;
 *   - `database/<database name>.lossless.json` and `database/<database name>.restore.sql`, only
 *     for a database with a table D1's export does not keep exactly (a NUL in text, an integer
 *     beyond ±2^53; DEC-0096) or whose scan D1 refused: those tables' rows read row by row, and
 *     the one file to restore the database from, the export with those rows in place
 *     (`d1/lossless.ts`, DEC-0556, DEC-0557);
 *   - `files/<nnnnnn>`: each object of the stage bucket, numbered from `000001` in key order, its
 *     bytes and content type unchanged. A stored key may be R2's full 1024 bytes, so no prefix
 *     would fit before it; the manifest maps each number to its key (keys keep their U+0001
 *     ending, DEC-0430);
 *   - `manifest.json`, written last: app, stage, time, the databases, their D1 UUIDs
 *     (`databaseIds`), the number of files, `fileObjects` (`{ object, key, contentType, bytes }`
 *     per file) and `lossless` (`{ database, tables, json, restore }` per database that has it).
 *   Afterwards the prefix is listed again and must hold every object written; otherwise the
 *   backup fails and `remove` deletes nothing.
 * - **Listing** (`listStageBackups`): every `<app>/<stage>/<time>/` prefix; complete when its
 *   manifest exists, with the manifest's numbers of databases and files and its database UUIDs.
 *
 * Objects travel through the R2 object endpoints of `api.cloudflare.com` as bytes
 * (`CloudflareBytesApi`), with the deploy token. Not yet exercised against the live API: the
 * bytes `PUT` and `GET` of these endpoints are read from Cloudflare's API reference, like the
 * account settings record's (DEC-0334).
 */
import type { BackupListing, SharedResource, Stage, StageBackup, StageDatabase } from "../core/operations.js";
import { describeFailure, resultOf, type CloudflareApi, type CloudflareBytesApi } from "./api.js";
import { inspectBucket } from "./account.js";
import { filesBucketName } from "./names.js";
import { listObjectKeys } from "./objects.js";
import type { DatabaseExport } from "./databases.js";

/** The account's backup bucket. */
export const BACKUP_BUCKET = "prototype-backups";
export const BACKUP_BUCKET_RESOURCE = `R2 bucket ${BACKUP_BUCKET}`;
/** PAR-311 in seconds (30 days). */
export const BACKUP_RETENTION_SECONDS = 30 * 86_400;
/** PAR-315: how long a production `remove` waits, after turning the route off, for requests already in flight (DEC-0557). */
export const IN_FLIGHT_DRAIN_MS = 60_000;
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
  readonly exportDatabase: (database: StageDatabase) => Promise<DatabaseExport>;
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
  const stamp = backupStamp((options.now ?? Date.now)());
  const prefix = `${stage.app}/${stage.stage}/${stamp}/`;
  const written: string[] = [];

  const lossless: { database: string; tables: readonly string[]; json: string; restore: string }[] = [];
  const databaseItems: string[] = [];
  for (const database of databases) {
    const exported = await options.exportDatabase(database);
    const key = `${prefix}database/${database.name}.sql`;
    await put(options, key, exported.dump, "application/sql");
    written.push(key);
    databaseItems.push(`database ${database.name}`);
    if (exported.lossless === undefined) continue;
    // D1's dump does not keep these tables' values exactly (DEC-0096): their rows, losslessly (DEC-0556).
    const entry = { database: database.name, tables: exported.lossless.tables, json: `database/${database.name}.lossless.json`, restore: `database/${database.name}.restore.sql` };
    await put(options, `${prefix}${entry.json}`, exported.lossless.json, "application/json");
    await put(options, `${prefix}${entry.restore}`, exported.lossless.restore, "application/sql");
    written.push(`${prefix}${entry.json}`, `${prefix}${entry.restore}`);
    lossless.push(entry);
    databaseItems[databaseItems.length - 1] = `database ${database.name} (table${entry.tables.length === 1 ? "" : "s"} ${entry.tables.join(", ")} also row by row, losslessly)`;
  }

  const filesBucket = filesBucketName(stage);
  const fileKeys = await listObjectKeys(api, accountId, filesBucket);
  // A stored key may take R2's whole 1024 bytes, so no prefix fits before it: each file is stored
  // under a numbered key, and the manifest maps it to the original key and content type (DEC-0556).
  const fileObjects: { object: string; key: string; contentType: string; bytes: number }[] = [];
  for (const [i, fileKey] of fileKeys.entries()) {
    const r = await options.bytes("GET", objectPath(accountId, filesBucket, fileKey));
    if (r.status < 200 || r.status >= 300) throw new Error(`reading file ${JSON.stringify(fileKey)} of R2 bucket ${filesBucket} failed: ${describeFailure({ status: r.status, body: r.body })}`);
    const object = `files/${String(i + 1).padStart(6, "0")}`;
    const contentType = r.contentType ?? "application/octet-stream";
    await put(options, `${prefix}${object}`, r.bytes, contentType);
    written.push(`${prefix}${object}`);
    fileObjects.push({ object, key: fileKey, contentType, bytes: r.bytes.length });
  }

  const manifest = {
    app: stage.app,
    stage: stage.stage,
    createdAt: new Date((options.now ?? Date.now)()).toISOString(),
    databases: databases.map((d) => `database/${d.name}.sql`),
    databaseIds: databases.map((d) => d.id),
    filesBucket,
    files: fileKeys.length,
    fileObjects,
    ...(lossless.length === 0 ? {} : { lossless }),
  };
  const manifestKey = `${prefix}manifest.json`;
  await put(options, manifestKey, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`), "application/json");
  written.push(manifestKey);

  const present = new Set(await listObjectKeys(api, accountId, BACKUP_BUCKET, prefix));
  const missing = written.filter((k) => !present.has(k));
  if (missing.length > 0) throw new Error(`the backup in R2 bucket ${BACKUP_BUCKET} lacks ${missing.length} object(s) after writing (${missing.slice(0, 3).join(", ")})`);

  const location = backupLocation(prefix);
  return {
    location,
    items: [...databaseItems, `${fileKeys.length} file(s) of R2 bucket ${filesBucket}`],
    listing: { location, stamp, complete: true, databases: databases.length, files: fileKeys.length, databaseIds: databases.map((d) => d.id) },
  };
}

const backupLocation = (prefix: string) => `${BACKUP_BUCKET_RESOURCE}, prefix ${prefix}`;

/**
 * Every backup of the stage under `<app>/<stage>/` (DEC-0556): complete when its manifest
 * (written last) exists, with the manifest's numbers of databases and files. Reads only.
 */
export async function listStageBackups(options: Pick<BackupOptions, "api" | "bytes" | "accountId">, stage: Stage): Promise<BackupListing[]> {
  const base = `${stage.app}/${stage.stage}/`;
  const stamps = new Map<string, boolean>();
  for (const key of await listObjectKeys(options.api, options.accountId, BACKUP_BUCKET, base)) {
    const [stamp, ...rest] = key.slice(base.length).split("/");
    if (stamp === undefined || stamp === "" || rest.length === 0) continue;
    stamps.set(stamp, (stamps.get(stamp) ?? false) || rest.join("/") === "manifest.json");
  }
  const out: BackupListing[] = [];
  for (const [stamp, hasManifest] of stamps) {
    const location = backupLocation(`${base}${stamp}/`);
    if (!hasManifest) {
      out.push({ location, stamp, complete: false });
      continue;
    }
    const key = `${base}${stamp}/manifest.json`;
    const r = await options.bytes("GET", objectPath(options.accountId, BACKUP_BUCKET, key));
    if (r.status < 200 || r.status >= 300) throw new Error(`reading ${key} of R2 bucket ${BACKUP_BUCKET} failed: ${describeFailure({ status: r.status, body: r.body })}`);
    let manifest: { databases?: unknown; files?: unknown; databaseIds?: unknown };
    try {
      manifest = JSON.parse(new TextDecoder().decode(r.bytes)) as { databases?: unknown; files?: unknown; databaseIds?: unknown };
    } catch {
      out.push({ location, stamp, complete: false });
      continue;
    }
    out.push({
      location,
      stamp,
      complete: true,
      ...(Array.isArray(manifest.databases) ? { databases: manifest.databases.length } : {}),
      ...(typeof manifest.files === "number" ? { files: manifest.files } : {}),
      ...(Array.isArray(manifest.databaseIds) && manifest.databaseIds.every((x) => typeof x === "string") ? { databaseIds: manifest.databaseIds as string[] } : {}),
    });
  }
  return out;
}
