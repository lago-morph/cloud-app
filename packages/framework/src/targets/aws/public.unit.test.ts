/**
 * The `./targets/aws` subpath's contract (CORE-REQ-005; G-01, G-05): the generated Lambda entry's
 * `createAwsLambdaHandler` and the test stages' `createAuthMock`. Building the handler reads no
 * environment variable and creates no SDK client; both happen on the first request (the
 * runtime itself is tested with Function URL fixtures in `handler.unit.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthMock as coreCreateAuthMock } from "../../auth/mock.js";
import { createDeployment } from "../../core/identity.js";
import { defineApp } from "../../core/public.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "../../provision/aws/aws-network-guard.test-support.js";
import * as aws from "./public.js";

const app = defineApp({ name: "notes", config: {}, secrets: [], tables: {}, routes: () => undefined });
const resolved = { deployment: createDeployment({ app: "notes", stage: "test-ab1", target: "aws" }), values: {}, admins: [], secrets: [] };

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  guard.uninstall();
  expect(guard.attempts).toEqual([]);
});

describe("./targets/aws contract (CORE-REQ-005)", () => {
  it("exports exactly the contract's runtime names: createAwsLambdaHandler and the test stages' createAuthMock", () => {
    expect(Object.keys(aws).sort()).toEqual(["createAuthMock", "createAwsLambdaHandler"]);
    expect(aws.createAuthMock).toBe(coreCreateAuthMock);
  });

  it("createAwsLambdaHandler returns the Lambda handler without touching the environment or AWS", () => {
    expect(typeof aws.createAwsLambdaHandler(app, resolved)).toBe("function");
    expect(typeof aws.createAwsLambdaHandler(app, resolved, { mock: aws.createAuthMock })).toBe("function");
  });
});
