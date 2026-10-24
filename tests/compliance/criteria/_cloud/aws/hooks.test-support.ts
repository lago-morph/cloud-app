/**
 * Shared setup for the AWS hook unit tests: no test reaches AWS.
 * - Every client class the hooks use is replaced by an `aws-sdk-client-mock` mock (all instances).
 * - The framework's network guard (`provision/aws/aws-network-guard.test-support.ts`) refuses and
 *   records any real `*.amazonaws.com` connection; `expectNoAwsTraffic()` asserts it saw none.
 * - The region and fake credentials are set in the environment for the test only; the hooks'
 *   process state (clients, account, call count) is reset around each test.
 */
import { IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { RDSClient } from "@aws-sdk/client-rds";
import { ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SSMClient } from "@aws-sdk/client-ssm";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, expect } from "vitest";
import { type AwsNetworkGuard, installAwsNetworkGuard } from "../../../../../packages/framework/src/provision/aws/aws-network-guard.test-support.js";
import { resetAwsHooksState } from "./api.js";

export const ACCOUNT = "123456789012";
export const REGION = "eu-west-1";
export const STAGE = { app: "reference", stage: "test-abc123def456ghi" } as const;
export const OTHER = { app: "reference", stage: "test-zzz999yyy888xxx" } as const;

const ENV_KEYS = ["AWS_REGION", "AWS_DEFAULT_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_PROFILE", "COMPLIANCE_AWS_MAX_CALLS"] as const;

export function createMocks() {
  return {
    ssm: mockClient(SSMClient),
    s3: mockClient(S3Client),
    lambda: mockClient(LambdaClient),
    rds: mockClient(RDSClient),
    iam: mockClient(IAMClient),
    sts: mockClient(STSClient),
    secrets: mockClient(SecretsManagerClient),
    tagging: mockClient(ResourceGroupsTaggingAPIClient),
  };
}

export type Mocks = ReturnType<typeof createMocks>;

/** Installs the guard, the environment and fresh mocks around every test of the calling file. */
export function useAwsMocks(): { readonly mocks: () => Mocks; readonly guard: () => AwsNetworkGuard } {
  let mocks: Mocks | undefined;
  let guard: AwsNetworkGuard | undefined;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AWS_REGION = REGION;
    process.env.AWS_ACCESS_KEY_ID = "AKIDFAKEFORUNITTESTS";
    process.env.AWS_SECRET_ACCESS_KEY = "fake-secret-not-a-credential";
    resetAwsHooksState();
    guard = installAwsNetworkGuard();
    mocks = createMocks();
    mocks.sts.on(GetCallerIdentityCommand).resolves({ Account: ACCOUNT });
  });
  afterEach(() => {
    for (const m of Object.values(mocks ?? {})) m.restore();
    guard?.uninstall();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAwsHooksState();
  });
  return {
    mocks: () => {
      if (mocks === undefined) throw new Error("mocks used outside a test");
      return mocks;
    },
    guard: () => {
      if (guard === undefined) throw new Error("guard used outside a test");
      return guard;
    },
  };
}

/** Asserts the guard refused no real AWS connection in this test. */
export function expectNoAwsTraffic(guard: AwsNetworkGuard): void {
  expect(guard.attempts).toEqual([]);
}

/** An SDK-shaped service error with a name and an HTTP status. */
export function sdkError(name: string, status = 400): Error {
  return Object.assign(new Error(`${name} (test)`), { name, $fault: status >= 500 ? "server" : "client", $metadata: { httpStatusCode: status } });
}
