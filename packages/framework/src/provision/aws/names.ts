/**
 * Physical names and ARNs of an AWS stage's resources (PROV §2 "Stage resources"; AWS-REQ-003;
 * DEC-PENDING-G-S2-1). Four names are fixed by the app, stage and account: the files bucket,
 * the Aurora cluster, the database-credentials secret and the HTTP Function. With them, the
 * Function's IAM statements name exact resources, and stop, start, secrets, removal and the
 * leftover check find the stage's resources from the stage name alone, also on a machine
 * without local CLI state (PROV-AC-006). App names have no hyphens (PAR-290), so
 * `<app>-<stage>` is unambiguous; with PAR-290/PAR-291 every name fits its limit (the files
 * bucket, the longest, is at most 60 of S3's 63 characters). ARNs use the `aws` partition.
 */
import type { Stage } from "../core/operations.js";
import { logBucketName } from "./account.js";

/** The stage's S3 bucket (FILES). The S3 namespace is global, so it ends with the account ID. */
export const filesBucketName = (stage: Stage, accountId: string): string => `${stage.app}-${stage.stage}-files-${accountId}`;

/** The stage's Aurora cluster identifier. */
export const clusterIdentifier = (stage: Stage): string => `${stage.app}-${stage.stage}`;

/** The stage's Aurora cluster ARN (the Data API's resource ARN). */
export const clusterArn = (stage: Stage, region: string, accountId: string): string => `arn:aws:rds:${region}:${accountId}:cluster:${clusterIdentifier(stage)}`;

/** The name of the SST-created database-credentials secret (DEC-PENDING-G-S2-4). */
export const databaseSecretName = (stage: Stage): string => `${stage.app}-${stage.stage}-database-credentials`;

/** The stage's HTTP Lambda function. */
export const functionName = (stage: Stage): string => `${stage.app}-${stage.stage}-http`;

/** The stage's secret parameters' path, with its trailing slash (SEC-REQ-003). */
export const secretsPath = (stage: Stage): string => `/${stage.app}/${stage.stage}/secrets/`;

/** The stage's key prefix in the shared log bucket (LOG-REQ-004), with its trailing slash. */
export const logPrefix = (stage: Stage): string => `${stage.app}/${stage.stage}/`;

/** Every exact ARN the stage's Function is granted, plus the log bucket it writes to. */
export function stageArns(stage: Stage, region: string, accountId: string) {
  const files = filesBucketName(stage, accountId);
  return {
    cluster: clusterArn(stage, region, accountId),
    filesBucket: `arn:aws:s3:::${files}`,
    filesObjects: `arn:aws:s3:::${files}/*`,
    logObjects: `arn:aws:s3:::${logBucketName(accountId)}/${logPrefix(stage)}*`,
    secretParameters: `arn:aws:ssm:${region}:${accountId}:parameter${secretsPath(stage)}*`,
  };
}

/**
 * The credentials secret's full ARN must be the stage's: Secrets Manager adds a `-` and six
 * random characters to the name. Throws otherwise, so no statement can name another secret.
 */
export function checkDatabaseSecretArn(stage: Stage, region: string, accountId: string, arn: string): void {
  const prefix = `arn:aws:secretsmanager:${region}:${accountId}:secret:${databaseSecretName(stage)}-`;
  if (!arn.startsWith(prefix) || !/^[A-Za-z0-9]{6}$/.test(arn.slice(prefix.length))) {
    throw new Error(`the database-credentials secret ARN ${JSON.stringify(arn)} is not the stage's secret ${databaseSecretName(stage)} in ${region} of account ${accountId}`);
  }
}

/**
 * RDS cluster identifiers start with a letter, contain no two consecutive hyphens and do not end
 * with one. The app name starts the identifier, so the stage name decides the rest.
 */
export function checkClusterIdentifier(stage: Stage): void {
  const id = clusterIdentifier(stage);
  if (!/^[a-z]/.test(id) || id.includes("--") || id.endsWith("-")) {
    throw new Error(`the Aurora cluster identifier ${id} is not valid on AWS: it must start with a letter (the app name), and the stage name must not end with a hyphen or contain two consecutive hyphens`);
  }
}
