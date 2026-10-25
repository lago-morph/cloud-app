/**
 * Physical names of a Cloudflare stage's resources (PROV §2 "Stage resources"; CF-REQ-002;
 * DEC-0331). Workers scripts and R2 buckets are named per
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

/**
 * A stage's legacy R2 signing token (DEC-0100, superseded by DEC-0550): an account API token scoped
 * to the stage bucket, which deploys before DEC-0550 created. Only `remove` and the stage listing
 * still look for it; the stages now share the account's signing credential (`r2-token.ts`).
 */
export const legacySigningTokenName = (stage: Stage): string => `${stage.app}-${stage.stage}-files-signing`;

/** The stage's public origin: its `workers.dev` URL on the account subdomain (cloudflare.md §2). */
export const publicOrigin = (stage: Stage, accountSubdomain: string): string => `https://${workerName(stage)}.${accountSubdomain}.workers.dev`;

/** SST's state home on Cloudflare: one R2 bucket per account, name fixed by SST (DEC-0084). */
export const STATE_BUCKET = "sst-state";

/** The account-level mail sink (MAIL §2, DEC-0518): its Worker and its R2 bucket share this name. */
export const MAIL_SINK_NAME = "prototype-mailsink";

/** Worker scripts that are account resources, never a stage's (PROV-REQ-003, PROV-REQ-004). */
export const ACCOUNT_WORKERS: readonly string[] = Object.freeze([MAIL_SINK_NAME]);
/** R2 buckets that are account resources, never a stage's: the log bucket, the state home and the mail sink's. */
export const ACCOUNT_BUCKETS: readonly string[] = Object.freeze(["prototype-logs", STATE_BUCKET, MAIL_SINK_NAME]);

/**
 * Why the stage's fixed names would collide with an account resource, or undefined. App names
 * have no hyphens, so only app `prototype` with stage `mailsink` names the sink's Worker; `deploy`,
 * `remove` and the stage-resource listing refuse such a stage, so stage removal can never delete
 * an account resource.
 */
export function accountResourceClash(stage: Stage): string | undefined {
  const worker = workerName(stage);
  if (ACCOUNT_WORKERS.includes(worker)) return `stage ${stage.stage} of app ${stage.app} would use the Worker name ${worker}, which is an account resource (the mail sink); choose another stage name`;
  const bucket = filesBucketName(stage);
  if (ACCOUNT_BUCKETS.includes(bucket)) return `stage ${stage.stage} of app ${stage.app} would use the R2 bucket name ${bucket}, which is an account resource; choose another stage name`;
  return undefined;
}

/** True when `key` is one of the stage's SST state objects: `<kind>/<app>/<stage>` or below it. */
export function isStageStateObject(stage: Stage, key: string): boolean {
  const parts = key.split("/");
  return parts.length >= 3 && parts[1] === stage.app && parts[2] === stage.stage;
}
