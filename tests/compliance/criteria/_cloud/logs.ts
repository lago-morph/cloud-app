/**
 * Log-bucket listing (plan item D-T2; DEC-0279 `_cloud/logs.ts`): the entries of one stage and
 * one UTC day in the account's shared log bucket, read through R2's S3 endpoint with the
 * read-only token of `r2.ts` (LOG-AC-004, E2E-011, E2E-012).
 *
 * Usage: one S3 listing per call plus one S3 GET per entry (no Cloudflare API requests beyond
 * the token's, no D1). Callers keep the day's entry count small (tens of entries per run).
 */
import { prerequisiteMissing } from "../../harness/index.js";
import { listAwsLogEntries } from "./aws/logs.js";
import { LOG_BUCKET, listKeys, readObject } from "./r2.js";

export interface StoredLogEntry {
  readonly key: string;
  readonly body: string;
}

/** `<app>/<stage>/<yyyy>/<mm>/<dd>/` (LOG-REQ-004) for `day` = `yyyy/mm/dd`. */
export function dayPrefix(app: string, stage: string, day: string): string {
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(day)) throw new Error(`day must be yyyy/mm/dd, not ${day}`);
  return `${app}/${stage}/${day}/`;
}

/** DEC-0279 hook: every object under `<app>/<stage>/<day>/` in the shared log bucket, with its body, sorted by key. */
export async function listLogEntries(input: { readonly target: string; readonly app: string; readonly stage: string; readonly day: string }): Promise<StoredLogEntry[]> {
  if (input.target === "aws") return listAwsLogEntries(input);
  if (input.target !== "cloudflare") return prerequisiteMissing(`no log-bucket listing for target ${input.target}`);
  const keys = await listKeys(LOG_BUCKET, dayPrefix(input.app, input.stage, input.day));
  const out: StoredLogEntry[] = [];
  for (const key of keys) out.push({ key, body: await readObject(LOG_BUCKET, key) });
  return out;
}
