/**
 * The driver's AWS rules for `--target aws` (plan-aws.md G-T4; plan §1 "Cloud usage limits"):
 *
 * - **Stage naming.** A run stage is `test-<run ID>` as on every cloud (COMPL-REQ-004). On AWS the
 *   stage also names four fixed physical resources (decision G-S2/G-08-1): the Aurora cluster
 *   `<app>-<stage>`, the Function `<app>-<stage>-http`, the files bucket
 *   `<app>-<stage>-files-<account-id>` and the credentials secret
 *   `<app>-<stage>-database-credentials`. `awsStageNameProblems` checks that those names are valid
 *   for AWS before anything is deployed, so a bad name fails the setup instead of a deploy half-way.
 * - **At most `MAX_AWS_CLUSTERS` (3) Aurora clusters at once.** Each stage has one cluster; before
 *   the driver deploys its run stage it counts the account's test-stage clusters and refuses when
 *   one more would exceed the cap. Further stages created by stage-lifecycle tests take the same
 *   check (`criteria/_cloud/aws/usage.ts` `requireClusterRoom`).
 * - **An AWS API-call count.** Every AWS call of the cloud test hooks is counted per process
 *   (`criteria/_cloud/aws/api.ts`), which prints `AWS_CALLS_REPORT_PREFIX<n>` once on exit. The
 *   driver sums those lines from each test process's output, adds its own process's count, records
 *   the total in `raw/aws-usage.log`, hands each test run only what is left of the run's budget
 *   (`COMPLIANCE_AWS_MAX_CALLS`), and fails the run (exit 1) when the total passes the cap
 *   (`DEFAULT_MAX_AWS_RUN_CALLS`, or `COMPLIANCE_AWS_MAX_RUN_CALLS`). The framework's own calls
 *   (deploy, remove, the leftover check) are the CLI's and are not in this count.
 */

export const MAX_AWS_CLUSTERS = 3;
/** The run's cap on AWS API calls by the test hooks (like the Cloudflare pass cap of 2,000 requests, DEC-0419). */
export const DEFAULT_MAX_AWS_RUN_CALLS = 2_000;
export const MAX_AWS_RUN_CALLS_ENV = "COMPLIANCE_AWS_MAX_RUN_CALLS";
/** The per-process cap the hooks read (`criteria/_cloud/aws/api.ts`). */
export const MAX_AWS_CALLS_ENV = "COMPLIANCE_AWS_MAX_CALLS";
/** What a process that used the AWS hooks prints once on exit, followed by its call count. */
export const AWS_CALLS_REPORT_PREFIX = "[g-t1] aws api calls in this process: ";

/** Identifiers of test-stage clusters (`<app>-test-…`; app names have no hyphen, PAR-290). */
export const TEST_STAGE_CLUSTER = /^[a-z0-9]+-test-[a-z0-9-]+$/;

const ACCOUNT_PLACEHOLDER = "000000000000";

/** Problems with the AWS physical names a stage implies (empty when every name is valid). */
export function awsStageNameProblems(app: string, stage: string): string[] {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9]*$/.test(app)) problems.push(`app name ${JSON.stringify(app)} must start with a letter and use lower-case letters and digits only (PAR-290; Aurora cluster identifiers start with a letter)`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(stage)) problems.push(`stage name ${JSON.stringify(stage)} must be lower-case letters and digits in hyphen-separated parts, with no leading, trailing or doubled hyphen (Aurora cluster identifiers and S3 bucket names allow no other form)`);
  const cluster = `${app}-${stage}`;
  if (cluster.length > 63) problems.push(`Aurora cluster identifier ${cluster} is longer than 63 characters`);
  const fn = `${app}-${stage}-http`;
  if (fn.length > 64) problems.push(`Lambda function name ${fn} is longer than 64 characters`);
  const bucket = `${app}-${stage}-files-${ACCOUNT_PLACEHOLDER}`;
  if (bucket.length > 63) problems.push(`S3 bucket name ${app}-${stage}-files-<account-id> is longer than 63 characters`);
  return problems;
}

/** Throws, naming every problem, unless the stage's AWS names are valid. */
export function assertAwsStageName(app: string, stage: string): void {
  const problems = awsStageNameProblems(app, stage);
  if (problems.length > 0) throw new Error(`stage ${stage} cannot be deployed on AWS: ${problems.join("; ")}`);
}

/** Throws unless one more cluster fits beside `existing` test-stage clusters. */
export function assertClusterRoom(existing: readonly string[], more: number, what: string): void {
  const clusters = existing.filter((c) => TEST_STAGE_CLUSTER.test(c));
  if (clusters.length + more > MAX_AWS_CLUSTERS) {
    throw new Error(
      `${what} would hold ${String(clusters.length + more)} Aurora clusters at once (${String(clusters.length)} test-stage cluster(s) exist: ${clusters.join(", ") || "none"}); at most ${String(MAX_AWS_CLUSTERS)} at once (plan-aws.md G-T4): remove stages first`,
    );
  }
}

/** The total of the hooks' call-count lines in a process's output. */
export function awsCallsInOutput(output: string): number {
  let total = 0;
  for (const line of output.split("\n")) {
    const at = line.indexOf(AWS_CALLS_REPORT_PREFIX);
    if (at < 0) continue;
    const n = /^(\d+)/.exec(line.slice(at + AWS_CALLS_REPORT_PREFIX.length))?.[1];
    if (n !== undefined) total += Number(n);
  }
  return total;
}

/** The run's AWS API-call cap from the environment. */
export function awsRunCallCap(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env[MAX_AWS_RUN_CALLS_ENV];
  if (raw === undefined || raw === "") return DEFAULT_MAX_AWS_RUN_CALLS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${MAX_AWS_RUN_CALLS_ENV}=${raw} is not a positive integer`);
  return n;
}
