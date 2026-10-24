/**
 * The AWS cloud test hooks (plan-aws.md G-T1): the `CloudHooks` of
 * `criteria/core/support/stores.ts` for AWS, plus the AWS-only hooks the AWS criteria (G-T2)
 * and the driver (G-T4) use. Written from the criteria, aws.md and the documented names
 * (decisions g-01, g-03, g-08), not from the framework's AWS implementation.
 *
 * - secrets: SSM parameters `/<app>/<stage>/secrets/<name>` (`secrets.ts`);
 * - log bucket `prototype-logs-<account>` through S3 with the expected owner (`logs.ts`);
 * - stage-resource probe (`stage-resources.ts`);
 * - IAM simulation and the stage-scoped log deny (`iam.ts`);
 * - Function URL discovery (`function-url.ts`);
 * - cluster-paused observer (`cluster.ts`).
 * Every call is counted and capped (`api.ts`).
 */
import type { CloudHooks } from "../../core/support/stores.js";
import { awsLogBucketExists, listAwsLogKeys, readAwsLogObject } from "./logs.js";
import { deleteStageSecret, stageSecretLocations } from "./secrets.js";

export function awsCloudHooks(): CloudHooks {
  return {
    deleteSecret: (stage, name) => deleteStageSecret(stage, name),
    secretLocations: (stage) => stageSecretLocations(stage),
    logBucketExists: () => awsLogBucketExists(),
    listLogKeys: (prefix) => listAwsLogKeys(prefix),
    readLogObject: (key) => readAwsLogObject(key),
  };
}

export { awsAccountId, awsCallCount, awsRegion, maxAwsCalls } from "./api.js";
export { observeClusterPause, waitForClusterPaused, PAUSE_POLL_MS, PAUSE_WAIT_MS, type PauseObservation, type PauseWaitResult } from "./cluster.js";
export { functionUrlOrigin } from "./function-url.js";
export { addLogDeny, allowedPairs, removeLogDeny, simulatePrincipal, simulateStageRole, stageRoleArn, withLogDeny, type SimulationResult } from "./iam.js";
export { awsLogBucket, listAwsLogEntries } from "./logs.js";
export * from "./names.js";
export { stageParameters } from "./secrets.js";
export { awsLeftoverStrings, awsStageResourceDetails, listAwsStageResources, type AwsStageResourceDetails } from "./stage-resources.js";
