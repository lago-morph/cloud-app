/**
 * A Cloudflare stage's own record (DEC-0544; provisioning.md §2 "Stage record"): the JSON object
 * `framework/<app>/<stage>/stage.json` in the state home `sst-state`, `{ "stopped": true }`,
 * written by `stop` and deleted by `start` and `deploy --start`. No object means "not stopped".
 * It lives with the stage's other state, so every machine sees it (PROV-AC-006), and its key has
 * the `<kind>/<app>/<stage>` shape of the stage's state objects (`isStageStateObject`), so
 * `remove` deletes it with them and the leftover listing reports it.
 * Read and written through the R2 object endpoints of `api.cloudflare.com`, like the account
 * settings record (`account-settings.ts`); not yet exercised against the live API (DEC-0334).
 */
import type { Stage, StageRecord } from "../core/operations.js";
import { describeFailure, type CloudflareApi } from "./api.js";
import { STATE_BUCKET } from "./names.js";

/** The record's key in the state home. */
export const stageRecordKey = (stage: Stage): string => `framework/${stage.app}/${stage.stage}/stage.json`;

const objectPath = (accountId: string, stage: Stage) => `/accounts/${accountId}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(stageRecordKey(stage))}`;
const what = (stage: Stage) => `the stage record ${stageRecordKey(stage)} in R2 bucket ${STATE_BUCKET}`;

export async function readStageRecord(api: CloudflareApi, accountId: string, stage: Stage): Promise<StageRecord> {
  const r = await api("GET", objectPath(accountId, stage));
  if (r.status === 404) return { stopped: false };
  if (r.status < 200 || r.status >= 300) throw new Error(`reading ${what(stage)} failed: ${describeFailure(r)}`);
  const stopped = (r.body as { stopped?: unknown } | null)?.stopped;
  if (typeof stopped !== "boolean") throw new Error(`${what(stage)} is not a stage record; run stop or start to rewrite it`);
  return { stopped };
}

export async function writeStageRecord(api: CloudflareApi, accountId: string, stage: Stage, record: StageRecord): Promise<void> {
  if (!record.stopped) {
    const r = await api("DELETE", objectPath(accountId, stage));
    if ((r.status < 200 || r.status >= 300) && r.status !== 404) throw new Error(`deleting ${what(stage)} failed: ${describeFailure(r)}`);
    return;
  }
  const r = await api("PUT", objectPath(accountId, stage), { stopped: true });
  if (r.status < 200 || r.status >= 300 || (r.body as { success?: unknown } | null)?.success === false) throw new Error(`writing ${what(stage)} failed: ${describeFailure(r)}`);
}
