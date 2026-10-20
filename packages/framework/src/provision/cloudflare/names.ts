/**
 * Physical names of a Cloudflare stage's resources (PROV §2 "Stage resources"; CF-REQ-002;
 * DEC-0331). Workers scripts, R2 buckets and account API tokens are named per
 * account, not globally, so the names are fixed by the app and stage: every operation (stop,
 * start, secrets, removal, the leftover check) finds the stage's resources from the stage
 * name alone, also on a machine without local CLI state (PROV-AC-006). App names have no
 * hyphens (PAR-290), so `<app>-<stage>` is unambiguous; with PAR-290/PAR-291 every name fits
 * the 63-character limits.
 */
import type { Stage } from "../core/operations.js";

/** The stage's Worker script. */
export const workerName = (stage: Stage): string => `${stage.app}-${stage.stage}`;

/** The stage's R2 bucket (FILES). */
export const filesBucketName = (stage: Stage): string => `${stage.app}-${stage.stage}-files`;

/** The stage's R2 signing token (DEC-0100): an account API token scoped to the stage bucket. */
export const signingTokenName = (stage: Stage): string => `${stage.app}-${stage.stage}-files-signing`;

/** The stage's public origin: its `workers.dev` URL on the account subdomain (cloudflare.md §2). */
export const publicOrigin = (stage: Stage, accountSubdomain: string): string => `https://${workerName(stage)}.${accountSubdomain}.workers.dev`;

/** SST's state home on Cloudflare: one R2 bucket per account, name fixed by SST (DEC-0084). */
export const STATE_BUCKET = "sst-state";

/** True when `key` is one of the stage's SST state objects: `<kind>/<app>/<stage>` or below it. */
export function isStageStateObject(stage: Stage, key: string): boolean {
  const parts = key.split("/");
  return parts.length >= 3 && parts[1] === stage.app && parts[2] === stage.stage;
}
