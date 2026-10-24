// plan-aws.md G-T4: the driver's AWS rules (stage naming, cluster cap, API-call count). No AWS request.
import { describe, expect, it } from "vitest";
import { newRunId, testStageName } from "../../../packages/framework/src/evidence/public.js";
import { assertClusterRoom, assertLambdaRoom, AWS_CALLS_REPORT_PREFIX, LAMBDA_COUNT_REGIONS, LAMBDA_FUNCTIONS_PER_STAGE, MAX_AWS_LAMBDA_FUNCTIONS, awsCallsInOutput, awsRunCallCap, awsStageNameProblems, DEFAULT_MAX_AWS_RUN_CALLS, MAX_AWS_CLUSTERS } from "./aws-usage.js";

describe("[COMPL-AC-004] AWS stage naming", () => {
  it("every run stage test-<run ID> of the reference app gives valid AWS names, at the longest app name too", () => {
    for (let i = 0; i < 20; i++) expect(awsStageNameProblems("reference", testStageName(newRunId()))).toEqual([]);
    expect(awsStageNameProblems("a".repeat(20), testStageName(newRunId()))).toEqual([]);
  });

  it("names each AWS rule a stage would break", () => {
    expect(awsStageNameProblems("reference", "test-a--b").join()).toMatch(/doubled hyphen/);
    expect(awsStageNameProblems("reference", "test-")).toHaveLength(1);
    expect(awsStageNameProblems("1app", "test-x").join()).toMatch(/start with a letter/);
    const long = `test-${"x".repeat(40)}`;
    expect(awsStageNameProblems("reference", long)).toEqual([
      `S3 bucket name reference-${long}-files-<account-id> is longer than 63 characters`,
    ]);
  });
});

describe("[COMPL-AC-004] AWS usage caps", () => {
  it("allows at most three test-stage Aurora clusters at once; other clusters do not count", () => {
    expect(MAX_AWS_CLUSTERS).toBe(3);
    expect(() => assertClusterRoom(["reference-test-a", "reference-test-b", "prodcheck-cluster", "reference-prodcheck"], 1, "deploying test-c")).not.toThrow();
    expect(() => assertClusterRoom(["reference-test-a", "reference-test-b", "notes-test-c"], 1, "deploying test-d")).toThrow(/deploying test-d would hold 4 Aurora clusters at once .*at most 3 at once/);
    expect(() => assertClusterRoom(["reference-test-a"], 3, "E2E-012")).toThrow(/would hold 4/);
  });

  // PAR-284 (DEC-0506): the Pluralsight sandbox allows 10 Lambda functions in the account; the driver keeps two in reserve.
  it("allows at most eight Lambda functions in us-east-1 and us-west-2 together, every function counting", () => {
    expect(MAX_AWS_LAMBDA_FUNCTIONS).toBe(8);
    expect(LAMBDA_FUNCTIONS_PER_STAGE).toBe(1);
    expect(LAMBDA_COUNT_REGIONS).toEqual(["us-east-1", "us-west-2"]);
    const seven = Array.from({ length: 7 }, (_, i) => `us-east-1/fn-${String(i)}`);
    expect(() => assertLambdaRoom(seven, 1, "deploying test-c")).not.toThrow();
    expect(() => assertLambdaRoom([...seven, "us-west-2/other"], 1, "deploying test-d")).toThrow(
      /deploying test-d would bring the account to 9 Lambda functions in us-east-1 and us-west-2 \(8 exist: .*us-west-2\/other\); at most 8 .*PAR-284.*remove stages or functions first/,
    );
    expect(() => assertLambdaRoom(["a", "b", "c", "d", "e", "f"], 3, "E2E-012")).toThrow(/would bring the account to 9/);
    expect(() => assertLambdaRoom([], 8, "eight stages")).not.toThrow();
  });

  it("sums the hooks' per-process call counts from a runner's output, ignoring other lines", () => {
    expect(awsCallsInOutput(`a\n${AWS_CALLS_REPORT_PREFIX}12\nstderr | ${AWS_CALLS_REPORT_PREFIX}3\n[g-t1] something else 9\n`)).toBe(15);
    expect(awsCallsInOutput("no aws here")).toBe(0);
  });

  it("reads the run's call cap, refusing a value that is not a positive integer", () => {
    expect(awsRunCallCap({})).toBe(DEFAULT_MAX_AWS_RUN_CALLS);
    expect(awsRunCallCap({ COMPLIANCE_AWS_MAX_RUN_CALLS: "300" })).toBe(300);
    expect(() => awsRunCallCap({ COMPLIANCE_AWS_MAX_RUN_CALLS: "0" })).toThrow(/positive integer/);
  });
});
