// plan-aws.md G-T4: `cloudHooks("aws")` carries every `AwsCloudHooks` member the AWS criteria (G-T2)
// need, so AWS-AC-002…006 are no longer blocked for lack of hooks. No network: aws-sdk-client-mock
// and the framework's AWS network guard.
import { DescribeNatGatewaysCommand, DescribeVpcsCommand } from "@aws-sdk/client-ec2";
import { SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { GetFunctionConfigurationCommand, GetFunctionUrlConfigCommand, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { DescribeDBClustersCommand, DescribeEventsCommand } from "@aws-sdk/client-rds";
import { DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { describe, expect, expectTypeOf, it } from "vitest";
import { AWS_HOOK_MEMBERS, missingAwsMembers, type AwsCloudHooks } from "../../aws/support.js";
import { cloudHooks } from "../index.js";
import { ACCOUNT, expectNoAwsTraffic, OTHER, REGION, sdkError, STAGE, useAwsMocks } from "./hooks.test-support.js";
import { awsCloudHooks } from "./index.js";

const t = useAwsMocks();
const ROLE = `arn:aws:iam::${ACCOUNT}:role/reference-test-abc123def456ghi-HttpRole-ab12cd34`;
const CLUSTER_ARN = `arn:aws:rds:${REGION}:${ACCOUNT}:cluster:reference-test-abc123def456ghi`;
const SECRET_ARN = `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:reference-test-abc123def456ghi-database-credentials-AbCdEf`;

describe("cloudHooks('aws') satisfies AwsCloudHooks (G-T4)", () => {
  it("has every member the AWS criteria need, typed as AwsCloudHooks", () => {
    expectTypeOf(awsCloudHooks()).toEqualTypeOf<AwsCloudHooks>();
    const hooks = cloudHooks("aws");
    expect(missingAwsMembers(hooks)).toEqual([]);
    for (const m of [...AWS_HOOK_MEMBERS, "deleteSecret", "secretLocations", "logBucketExists", "listLogKeys", "readLogObject"]) expect(typeof (hooks as unknown as Record<string, unknown>)[m], m).toBe("function");
    // Building the hooks makes no call.
    expect(t.mocks().sts.calls()).toEqual([]);
    expectNoAwsTraffic(t.guard());
  });
});

describe("AWS criteria hooks", () => {
  it("stageResources: the stage's identifiers from the Function, the cluster and the secret, by their exact names", async () => {
    const m = t.mocks();
    m.lambda.on(GetFunctionConfigurationCommand).resolves({ Role: ROLE });
    m.rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [{ DBClusterIdentifier: "reference-test-abc123def456ghi", DBClusterArn: CLUSTER_ARN }] });
    m.secrets.on(DescribeSecretCommand).resolves({ ARN: SECRET_ARN });
    expect(await awsCloudHooks().stageResources(STAGE)).toEqual({
      accountId: ACCOUNT,
      region: REGION,
      roleArn: ROLE,
      bucketName: `reference-test-abc123def456ghi-files-${ACCOUNT}`,
      clusterArn: CLUSTER_ARN,
      credentialsSecretArn: SECRET_ARN,
    });
    expect(m.lambda.commandCalls(GetFunctionConfigurationCommand)[0]?.args[0].input).toEqual({ FunctionName: "reference-test-abc123def456ghi-http" });
    expect(m.rds.commandCalls(DescribeDBClustersCommand)[0]?.args[0].input).toEqual({ DBClusterIdentifier: "reference-test-abc123def456ghi" });
    expect(m.secrets.commandCalls(DescribeSecretCommand)[0]?.args[0].input).toEqual({ SecretId: "reference-test-abc123def456ghi-database-credentials" });
    expectNoAwsTraffic(t.guard());
  });

  it("stageResources: a missing cluster is an error naming it, never a guessed ARN", async () => {
    const m = t.mocks();
    m.lambda.on(GetFunctionConfigurationCommand).resolves({ Role: ROLE });
    m.rds.on(DescribeDBClustersCommand).rejects(sdkError("DBClusterNotFoundFault", 404));
    await expect(awsCloudHooks().stageResources(STAGE)).rejects.toThrow("reading Aurora cluster reference-test-abc123def456ghi failed: DBClusterNotFoundFault (HTTP 404)");
  });

  it("stageFunctions: only the stage's functions (paged), with their VPC settings", async () => {
    const m = t.mocks();
    m.lambda
      .on(ListFunctionsCommand, { MaxItems: 50 })
      .resolves({ Functions: [{ FunctionName: "reference-test-abc123def456ghi-http", VpcConfig: { SubnetIds: [], SecurityGroupIds: [], VpcId: "" } }, { FunctionName: `reference-${OTHER.stage}-http` }], NextMarker: "m1" })
      .on(ListFunctionsCommand, { MaxItems: 50, Marker: "m1" })
      .resolves({ Functions: [{ FunctionName: "reference-test-abc123def456ghi-Worker-ab12cd34", VpcConfig: { SubnetIds: ["subnet-1"], VpcId: "vpc-9" } }, { FunctionName: "unrelated" }] });
    expect(await awsCloudHooks().stageFunctions(STAGE)).toEqual([
      { name: "reference-test-abc123def456ghi-Worker-ab12cd34", vpcSubnetIds: ["subnet-1"], vpcId: "vpc-9" },
      { name: "reference-test-abc123def456ghi-http", vpcSubnetIds: [] },
    ]);
    expect(m.lambda.commandCalls(ListFunctionsCommand)).toHaveLength(2);
  });

  it("stageNatGateways: the shared VPC (by its tag), the functions' VPCs and the stage-tagged gateways; deleted ones left out", async () => {
    const m = t.mocks();
    m.lambda.on(ListFunctionsCommand).resolves({ Functions: [{ FunctionName: "reference-test-abc123def456ghi-http", VpcConfig: { SubnetIds: ["subnet-1"], VpcId: "vpc-fn" } }] });
    m.ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-shared" }] });
    m.ec2
      .on(DescribeNatGatewaysCommand, { Filter: [{ Name: "vpc-id", Values: ["vpc-fn", "vpc-shared"] }] })
      .resolves({ NatGateways: [{ NatGatewayId: "nat-1", VpcId: "vpc-shared", State: "available" }, { NatGatewayId: "nat-0", VpcId: "vpc-shared", State: "deleted" }] })
      .on(DescribeNatGatewaysCommand, { Filter: [{ Name: "tag:sst:app", Values: ["reference"] }, { Name: "tag:sst:stage", Values: [STAGE.stage] }] })
      .resolves({ NatGateways: [{ NatGatewayId: "nat-1", VpcId: "vpc-shared", State: "available" }, { NatGatewayId: "nat-2", VpcId: "vpc-x", State: "pending" }] });
    expect(await awsCloudHooks().stageNatGateways(STAGE)).toEqual([
      { id: "nat-1", vpcId: "vpc-shared", state: "available" },
      { id: "nat-2", vpcId: "vpc-x", state: "pending" },
    ]);
    expect(m.ec2.commandCalls(DescribeVpcsCommand)[0]?.args[0].input).toEqual({ Filters: [{ Name: "tag:prototype-framework", Values: ["shared-network"] }] });
    expectNoAwsTraffic(t.guard());
  });

  it("stageNatGateways: none in a NAT-free network", async () => {
    const m = t.mocks();
    m.lambda.on(ListFunctionsCommand).resolves({ Functions: [{ FunctionName: "reference-test-abc123def456ghi-http" }] });
    m.ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: "vpc-shared" }] });
    m.ec2.on(DescribeNatGatewaysCommand).resolves({ NatGateways: [] });
    expect(await awsCloudHooks().stageNatGateways(STAGE)).toEqual([]);
  });

  it("simulatePrincipalPolicy, functionUrl and observeCluster are G-T1's simulation, Function URL and observer", async () => {
    const m = t.mocks();
    m.iam.on(SimulatePrincipalPolicyCommand).resolves({ EvaluationResults: [{ EvalActionName: "s3:GetObject", EvalResourceName: "arn:aws:s3:::b/k", EvalDecision: "implicitDeny" }], IsTruncated: false });
    expect(await awsCloudHooks().simulatePrincipalPolicy(ROLE, ["s3:GetObject"], ["arn:aws:s3:::b/k"])).toEqual([{ action: "s3:GetObject", resource: "arn:aws:s3:::b/k", decision: "implicitDeny" }]);
    expect(m.iam.commandCalls(SimulatePrincipalPolicyCommand)[0]?.args[0].input).toMatchObject({ PolicySourceArn: ROLE, ActionNames: ["s3:GetObject"], ResourceArns: ["arn:aws:s3:::b/k"] });

    m.lambda.on(GetFunctionUrlConfigCommand).resolves({ FunctionUrl: "https://abc123xyz.lambda-url.eu-west-1.on.aws/" });
    expect(await awsCloudHooks().functionUrl(STAGE)).toBe("https://abc123xyz.lambda-url.eu-west-1.on.aws/");

    m.rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [{ Status: "available", ServerlessV2ScalingConfiguration: { MinCapacity: 0, SecondsUntilAutoPause: 300 }, DBClusterMembers: [{ DBInstanceIdentifier: "i-1" }] }] });
    m.rds.on(DescribeEventsCommand).resolves({ Events: [{ Date: new Date("2026-10-24T10:00:00Z"), Message: "The DB instance is paused." }] });
    const paused = await awsCloudHooks().observeCluster(STAGE);
    expect(paused.paused).toBe(true);
    expect(paused.detail).toContain("i-1: paused");

    m.rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [{ Status: "available", ServerlessV2ScalingConfiguration: { MinCapacity: 0.5 } }] });
    const never = await awsCloudHooks().observeCluster(STAGE);
    expect(never).toEqual({ paused: false, detail: expect.stringMatching(/^never pauses: .*minimum capacity 0.5 ACU/) as unknown as string });
    expectNoAwsTraffic(t.guard());
  });
});
