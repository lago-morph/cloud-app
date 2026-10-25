/**
 * R2 objects through `api.cloudflare.com` (no R2 S3 credentials needed): used to empty a stage's
 * bucket before removal (PROV §2 "Removal") and to delete the stage's SST state objects, which
 * `sst remove` leaves behind (DEC-0084). Request shapes as in spike A-01's `cleanup_state.py`
 * (`GET …/objects?per_page=1000`, `DELETE …/objects/<encoded key>`); the cursor fields
 * (`result_info.cursor`, `is_truncated`) are unverified live (DEC-0334).
 *
 * An error answer to a delete is not proof the object remains (a 502 was seen on a delete that
 * happened, A-03 `c19`): after deleting, the keys are listed again and only those still present
 * count as failures.
 */
import { describeFailure, resultOf, succeeded, type CloudflareApi } from "./api.js";

const objectsPath = (accountId: string, bucket: string) => `/accounts/${accountId}/r2/buckets/${bucket}/objects`;

/** Every object key in the bucket (under `prefix`, when given); empty when the bucket does not exist. */
export async function listObjectKeys(api: CloudflareApi, accountId: string, bucket: string, prefix?: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  const filter = prefix === undefined ? "" : `&prefix=${encodeURIComponent(prefix)}`;
  do {
    const r = await api("GET", `${objectsPath(accountId, bucket)}?per_page=1000${filter}${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`);
    if (r.status === 404) return [];
    for (const o of resultOf<{ key: string }[]>(r, `listing the objects of R2 bucket ${bucket}`)) keys.push(o.key);
    const info = (r.body as { result_info?: { cursor?: unknown; is_truncated?: unknown } }).result_info;
    cursor = info?.is_truncated === true && typeof info.cursor === "string" && info.cursor !== "" ? info.cursor : undefined;
  } while (cursor !== undefined);
  return keys;
}

/** Deletes the given keys; throws naming those still present afterwards. */
export async function deleteObjects(api: CloudflareApi, accountId: string, bucket: string, keys: readonly string[]): Promise<void> {
  const failures = new Map<string, string>();
  for (const key of keys) {
    try {
      const r = await api("DELETE", `${objectsPath(accountId, bucket)}/${encodeURIComponent(key)}`);
      if (!succeeded(r) && r.status !== 404) failures.set(key, describeFailure(r));
    } catch (error) {
      failures.set(key, error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.size === 0) return;
  const remaining = new Set(await listObjectKeys(api, accountId, bucket));
  const stuck = [...failures].filter(([key]) => remaining.has(key));
  if (stuck.length > 0) {
    throw new Error(`R2 bucket ${bucket}: ${stuck.length} object(s) could not be deleted (${stuck.map(([k, why]) => `${k}: ${why}`).join("; ")})`);
  }
}
