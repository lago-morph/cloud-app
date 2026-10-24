/**
 * The documented AWS names the hooks find a stage's resources by (no lookup in the framework's
 * implementation; the hooks must stay independent of it):
 * - SSM SecureString parameters `/<app>/<stage>/secrets/<name>`, logical name unchanged
 *   (SEC-REQ-003, secrets.md §2; DEC-PENDING-g-01-2);
 * - the shared log bucket `prototype-logs-<account-id>` (log.md §2 "AWS") with the LOG-REQ-004
 *   key layout `<app>/<stage>/<yyyy>/<mm>/<dd>/…` (DEC-PENDING-g-03-1, -3);
 * - the four fixed physical names of DEC-PENDING-G-S2 / G-08-1: the Function `<app>-<stage>-http`,
 *   the Aurora cluster `<app>-<stage>`, the files bucket `<app>-<stage>-files-<account-id>` and
 *   the credentials secret `<app>-<stage>-database-credentials`;
 * - every other stage resource carries SST's default tags `sst:app` and `sst:stage` (G-S2 RESULT,
 *   SST `aws.go`), or has a generated name `<app>-<stage>-<logical>-<rand8>`.
 *
 * Every name is built from a checked app and stage, so a name can never widen to another stage
 * (app names have no hyphens, PAR-290; stage names are lower-case letters, digits and hyphens).
 */

export interface AwsStage {
  readonly app: string;
  readonly stage: string;
}

export const STAGE_TAG_KEYS = { app: "sst:app", stage: "sst:stage" } as const;

/** Throws unless `s` is a valid app and stage name. */
export function checkStage(s: AwsStage): AwsStage {
  if (!/^[a-z][a-z0-9]*$/.test(s.app)) throw new Error(`invalid app name ${JSON.stringify(s.app)}: lower-case letters and digits only (PAR-290)`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.stage)) throw new Error(`invalid stage name ${JSON.stringify(s.stage)}`);
  return s;
}

/** Throws unless the stage is a test stage: hooks that change a stage act on `test-` stages only. */
export function checkTestStage(s: AwsStage): AwsStage {
  checkStage(s);
  if (!s.stage.startsWith("test-")) throw new Error(`the AWS hooks change test stages only, not ${s.stage}`);
  return s;
}

/** `/<app>/<stage>/`: every SSM parameter of the stage is under it (PROV §2 "Removal"). */
export function stageParameterPath(s: AwsStage): string {
  checkStage(s);
  return `/${s.app}/${s.stage}/`;
}

/** `/<app>/<stage>/secrets/` (SEC-REQ-003). */
export function secretParameterPath(s: AwsStage): string {
  return `${stageParameterPath(s)}secrets/`;
}

/** SEC-REQ-003's AWS location of a logical secret name: `/<app>/<stage>/secrets/<name>`. */
export function secretParameterName(s: AwsStage, name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`invalid logical secret name ${JSON.stringify(name)}`);
  return `${secretParameterPath(s)}${name}`;
}

export function checkAccountId(account: string): string {
  if (!/^\d{12}$/.test(account)) throw new Error(`invalid AWS account ID ${JSON.stringify(account)}`);
  return account;
}

/** The shared log bucket (log.md §2 "AWS"). */
export function logBucketName(account: string): string {
  return `prototype-logs-${checkAccountId(account)}`;
}

/** The stage's prefix in the log bucket (LOG-REQ-004). */
export function stageLogPrefix(s: AwsStage): string {
  checkStage(s);
  return `${s.app}/${s.stage}/`;
}

export function functionName(s: AwsStage): string {
  checkStage(s);
  return `${s.app}-${s.stage}-http`;
}

export function clusterIdentifier(s: AwsStage): string {
  checkStage(s);
  return `${s.app}-${s.stage}`;
}

export function filesBucketName(s: AwsStage, account: string): string {
  checkStage(s);
  return `${s.app}-${s.stage}-files-${checkAccountId(account)}`;
}

export function credentialsSecretName(s: AwsStage): string {
  checkStage(s);
  return `${s.app}-${s.stage}-database-credentials`;
}

/** Whether a generated physical name is the stage's: it starts with `<app>-<stage>-` (the app part has no hyphen). */
export function generatedNameOfStage(name: string, s: AwsStage): boolean {
  checkStage(s);
  return name.startsWith(`${s.app}-${s.stage}-`);
}
