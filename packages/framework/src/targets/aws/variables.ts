/**
 * The HTTP Lambda's environment variable names: the one list both sides use. The stage program
 * (`provision/aws/sst.ts`, G-08) sets these on the Function, and the runtime (`settings.ts`,
 * G-03/G-05) reads them (config.md §2 "Delivery", "AWS"). A unit test in
 * `provision/aws/sst.unit.test.ts` checks that the program sets exactly the variables the runtime
 * reads. Plain data with no imports, so provisioning can import it without runtime code.
 */

/** The framework's Lambda environment variables (set by the stage program). */
export const LAMBDA_VARIABLES = Object.freeze({
  /** The stage's public origin (its CloudFront URL, `router.url`; DEC-0073). */
  publicOrigin: "FRAMEWORK_PUBLIC_ORIGIN",
  /** The account ID: the expected owner of every bucket the runtime calls (aws.md §2). */
  accountId: "FRAMEWORK_ACCOUNT_ID",
  /** The account's shared log bucket, `prototype-logs-<account-id>` (LOG-REQ-004). */
  logBucket: "FRAMEWORK_LOG_BUCKET",
  /** The stage's S3 bucket (FILES). */
  filesBucket: "FRAMEWORK_FILES_BUCKET",
  /** The stage's Aurora cluster, its credentials secret and the current database (SQL). */
  databaseClusterArn: "FRAMEWORK_DATABASE_CLUSTER_ARN",
  databaseSecretArn: "FRAMEWORK_DATABASE_SECRET_ARN",
  databaseName: "FRAMEWORK_DATABASE",
} as const);

/** Variables the Lambda runtime sets itself (reserved; provisioning never declares them). */
export const LAMBDA_RUNTIME_VARIABLES = Object.freeze({
  region: "AWS_REGION",
  accessKeyId: "AWS_ACCESS_KEY_ID",
  secretAccessKey: "AWS_SECRET_ACCESS_KEY",
  sessionToken: "AWS_SESSION_TOKEN",
} as const);
