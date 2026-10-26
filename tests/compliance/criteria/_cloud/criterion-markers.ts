/**
 * The markers of criterion production stages (DEC-0560, `harness/criterion-stages.ts`): a test
 * writes `compliance/criterion-stages/<stage>.json` in `sst-state` before it deploys such a stage
 * and deletes it after the stage's successful removal. The driver sweeps only stages whose marker
 * is stale (older than PAR-286), so a stage this run is still using is never removed by another
 * run. Each call creates and deletes a write token scoped to the state home (4 Cloudflare API
 * requests).
 */
import { markerKey, markerText } from "../../harness/criterion-stages.js";
import { target } from "../../harness/index.js";
import { STATE_BUCKET, withR2Access } from "./r2.js";

export async function writeCriterionMarker(stage: string): Promise<void> {
  const text = markerText(stage, target().runId ?? "outside-the-driver");
  await withR2Access([STATE_BUCKET], "write", (r2) => r2.put(STATE_BUCKET, markerKey(stage), text, "application/json"));
}

export async function deleteCriterionMarker(stage: string): Promise<void> {
  await withR2Access([STATE_BUCKET], "write", (r2) => r2.remove(STATE_BUCKET, markerKey(stage)));
}
