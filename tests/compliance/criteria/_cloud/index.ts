/**
 * The cloud test hooks (plan item D-T2; DEC-0279), loaded at run time by
 * `criteria/core/support/stores.ts` (C-T1) as `cloudHooks(target)` with the `CloudHooks`
 * interface declared there. The E2E hooks are `logs.ts` and `stage-resources.ts`.
 *
 * Cloudflare implementation:
 * - secrets: the stage's Worker script's secrets through the Cloudflare API
 *   (`GET`/`DELETE /accounts/{account}/workers/scripts/{script}/secrets[/{name}]`); the Worker
 *   is found by name (`stage-resources.ts`). Deleting is the "test hook" of SEC-AC-005 and
 *   PROV-AC-002: it goes to the store directly, not through the framework.
 * - log bucket: existence through the Cloudflare API; keys and objects through R2's S3
 *   endpoint with a read-only token created and deleted by the hook (`r2.ts`).
 * No hook reads or writes D1, so none is affected by the D1 stop (DEC-0317).
 *
 * Usage per call: `deleteSecret` 2 API requests (Workers list, DELETE); `secretLocations` 2;
 * `logBucketExists` 1; `listLogKeys`/`readLogObject` 0 API requests (S3 endpoint) after the
 * token's 4–5 once per process.
 */
import { prerequisiteMissing } from "../../harness/index.js";
import type { CloudHooks, HookStage } from "../core/support/stores.js";
import { accountId, cfApi, cfOk, failure } from "./api.js";
import { bucketExists, LOG_BUCKET, listKeys, readObject } from "./r2.js";
import { stageWorker } from "./stage-resources.js";

/** SEC-REQ-003's Cloudflare location of a logical secret name: `apiKey` → `SECRET_API_KEY`. */
export function secretLocationName(name: string): string {
  return `SECRET_${name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}`;
}

/** The secret locations set on the stage's Worker (names only; values are never readable). */
export async function workerSecretNames(stage: HookStage): Promise<string[]> {
  const script = await stageWorker(stage);
  const listed = await cfOk<readonly { name: string }[]>(`listing the secrets of the Worker of ${stage.app} stage ${stage.stage}`, "GET", `/accounts/${accountId()}/workers/scripts/${encodeURIComponent(script)}/secrets`);
  return listed.map((s) => s.name).sort();
}

/** Deletes secret `name` (logical name) of the stage directly in the Worker's store. */
export async function deleteWorkerSecret(stage: HookStage, name: string): Promise<void> {
  const script = await stageWorker(stage);
  const location = secretLocationName(name);
  const r = await cfApi("DELETE", `/accounts/${accountId()}/workers/scripts/${encodeURIComponent(script)}/secrets/${encodeURIComponent(location)}`);
  if (r.status !== 200 || r.body?.success !== true) throw failure(`deleting secret ${location} of the Worker of ${stage.app} stage ${stage.stage}`, r);
}

function cloudflareHooks(): CloudHooks {
  return {
    deleteSecret: (stage, name) => deleteWorkerSecret(stage, name),
    secretLocations: (stage) => workerSecretNames(stage),
    logBucketExists: () => bucketExists(LOG_BUCKET),
    listLogKeys: (prefix) => listKeys(LOG_BUCKET, prefix),
    readLogObject: (key) => readObject(LOG_BUCKET, key),
  };
}

/** DEC-0279: the hooks for this run's target. */
export function cloudHooks(target: string): CloudHooks {
  if (target === "cloudflare") return cloudflareHooks();
  if (target === "aws") return prerequisiteMissing("the cloud test hooks for aws do not exist: AWS phase not started");
  throw new Error(`no cloud test hooks for target ${target}`);
}

export { disposeR2Reader } from "./r2.js";
export { listLogEntries } from "./logs.js";
export { listStageResources } from "./stage-resources.js";
