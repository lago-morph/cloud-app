/**
 * The HTTP Lambda's settings (config.md §2 "AWS"): read from Lambda environment variables,
 * never from a `SECRET_*` variable; provisioning never declares one.
 */
import { describe, expect, it } from "vitest";
import { FrameworkError } from "../../core/errors.js";
import { awsLambdaEnvironment, awsLambdaSettings, checkLambdaEnvironment, LAMBDA_VARIABLES, type StageLambdaInput } from "./settings.js";

const ACCOUNT = "123456789012";
const INPUT: StageLambdaInput = {
  publicOrigin: "https://d111111abcdef8.cloudfront.net",
  accountId: ACCOUNT,
  logBucket: `prototype-logs-${ACCOUNT}`,
  filesBucket: "notes-test-abc-files",
  database: { clusterArn: `arn:aws:rds:eu-west-1:${ACCOUNT}:cluster:notes-test-abc`, secretArn: `arn:aws:secretsmanager:eu-west-1:${ACCOUNT}:secret:notes-abc`, name: "notes_test_abc_1" },
};
const LAMBDA = { AWS_REGION: "eu-west-1", AWS_ACCESS_KEY_ID: "ASIAEXAMPLE", AWS_SECRET_ACCESS_KEY: "secret-key", AWS_SESSION_TOKEN: "token" };

function codeOf(read: () => unknown): string {
  try {
    read();
  } catch (thrown) {
    if (thrown instanceof FrameworkError) return `${thrown.code}: ${thrown.message}`;
    throw thrown;
  }
  throw new Error("expected a FrameworkError");
}

describe("awsLambdaEnvironment (provisioning side)", () => {
  it("declares the framework variables, and only those", () => {
    expect(awsLambdaEnvironment(INPUT)).toEqual({
      FRAMEWORK_PUBLIC_ORIGIN: INPUT.publicOrigin,
      FRAMEWORK_ACCOUNT_ID: ACCOUNT,
      FRAMEWORK_LOG_BUCKET: `prototype-logs-${ACCOUNT}`,
      FRAMEWORK_FILES_BUCKET: "notes-test-abc-files",
      FRAMEWORK_DATABASE_CLUSTER_ARN: INPUT.database.clusterArn,
      FRAMEWORK_DATABASE_SECRET_ARN: INPUT.database.secretArn,
      FRAMEWORK_DATABASE: "notes_test_abc_1",
    });
    expect(Object.values(LAMBDA_VARIABLES).every((name) => !name.startsWith("SECRET_"))).toBe(true);
  });

  it("refuses an origin that is not https without a path", () => {
    for (const publicOrigin of ["http://x.cloudfront.net", "https://x.cloudfront.net/", "https://x.cloudfront.net/app"]) {
      expect(codeOf(() => awsLambdaEnvironment({ ...INPUT, publicOrigin }))).toMatch(/^CORE\.MISCONFIGURED/);
    }
  });

  it("refuses SECRET_* and Lambda-reserved variables", () => {
    expect(codeOf(() => checkLambdaEnvironment({ SECRET_API_KEY: "x", FRAMEWORK_DATABASE: "d" }))).toBe(
      "CORE.MISCONFIGURED: the Lambda environment declares SECRET_API_KEY; on AWS secrets are SSM parameters, never environment variables",
    );
    expect(codeOf(() => checkLambdaEnvironment({ AWS_REGION: "x" }))).toMatch(/AWS_REGION, which the Lambda runtime sets/);
    expect(() => checkLambdaEnvironment(awsLambdaEnvironment(INPUT))).not.toThrow();
  });
});

describe("awsLambdaSettings (runtime side)", () => {
  const env = { ...LAMBDA, ...awsLambdaEnvironment(INPUT) };

  it("reads every setting from the function's environment", () => {
    const settings = awsLambdaSettings(env);
    expect(settings.region).toBe("eu-west-1");
    expect(settings.accountId).toBe(ACCOUNT);
    expect(settings.publicOrigin).toBe(INPUT.publicOrigin);
    expect(settings.filesBucket).toBe("notes-test-abc-files");
    expect(settings.database).toEqual(INPUT.database);
    expect(settings.credentials).toEqual({ accessKeyId: "ASIAEXAMPLE", secretAccessKey: "secret-key", sessionToken: "token" });
    expect(settings.logBucket).toEqual({ bucket: `prototype-logs-${ACCOUNT}`, accountId: ACCOUNT, region: "eu-west-1", credentials: settings.credentials });
  });

  it("reads values when used, so a changed environment is seen", () => {
    const mutable: Record<string, string | undefined> = { ...env };
    const settings = awsLambdaSettings(mutable);
    mutable.AWS_SESSION_TOKEN = "rotated";
    expect(settings.credentials.sessionToken).toBe("rotated");
  });

  it("a missing or empty required variable is CORE.MISCONFIGURED naming it, raised on first use", () => {
    const settings = awsLambdaSettings({ ...env, FRAMEWORK_PUBLIC_ORIGIN: "", FRAMEWORK_DATABASE_SECRET_ARN: undefined, AWS_ACCESS_KEY_ID: undefined });
    expect(codeOf(() => settings.publicOrigin)).toMatch(/^CORE\.MISCONFIGURED: the Lambda variable FRAMEWORK_PUBLIC_ORIGIN/);
    expect(codeOf(() => settings.database)).toMatch(/FRAMEWORK_DATABASE_SECRET_ARN/);
    expect(codeOf(() => settings.credentials)).toMatch(/AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY/);
    expect(settings.region).toBe("eu-west-1");
  });

  it("the log bucket is undefined (never an error) when any part is missing", () => {
    for (const name of ["FRAMEWORK_LOG_BUCKET", "FRAMEWORK_ACCOUNT_ID", "AWS_REGION", "AWS_SECRET_ACCESS_KEY"]) {
      expect(awsLambdaSettings({ ...env, [name]: undefined }).logBucket).toBeUndefined();
    }
  });

  it("credentials without a session token are still read (the token is optional)", () => {
    expect(awsLambdaSettings({ ...env, AWS_SESSION_TOKEN: undefined }).credentials).toEqual({ accessKeyId: "ASIAEXAMPLE", secretAccessKey: "secret-key" });
  });

  it("no setting is ever read from a SECRET_* variable", () => {
    const withSecrets = { ...LAMBDA, SECRET_API_KEY: "leak", SECRET_FRAMEWORK_SESSION_KEY: "leak" };
    const settings = awsLambdaSettings(withSecrets);
    const readable = [settings.region, settings.credentials, settings.logBucket];
    expect(JSON.stringify(readable)).not.toContain("leak");
    for (const read of [() => settings.accountId, () => settings.publicOrigin, () => settings.filesBucket, () => settings.database]) {
      expect(codeOf(read)).toMatch(/^CORE\.MISCONFIGURED/);
    }
  });
});
