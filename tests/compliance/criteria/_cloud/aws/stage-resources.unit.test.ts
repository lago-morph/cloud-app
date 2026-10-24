// AWS cloud test hooks (G-T1): the stage-resource probe (PROV-AC-003, COMPL-AC-004, E2E-012) by
// the documented names and SST's stage tags. No network: aws-sdk-client-mock.
import { ListRolesCommand } from "@aws-sdk/client-iam";
import { GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { GetResourcesCommand } from "@aws-sdk/client-resource-groups-tagging-api";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { describe, expect, it } from "vitest";
import { listStageResources } from "../stage-resources.js";
import { ACCOUNT, expectNoAwsTraffic, REGION, sdkError, STAGE, useAwsMocks } from "./hooks.test-support.js";
import { clusterIdentifier, credentialsSecretName, filesBucketName, functionName, generatedNameOfStage } from "./names.js";
import { awsStageResourceDetails, listAwsStageResources } from "./stage-resources.js";

const t = useAwsMocks();

function allAbsent(): void {
  const m = t.mocks();
  m.lambda.on(GetFunctionConfigurationCommand).rejects(sdkError("ResourceNotFoundException", 404));
  m.rds.on(DescribeDBClustersCommand).rejects(sdkError("DBClusterNotFoundFault", 404));
  m.s3.on(HeadBucketCommand).rejects(sdkError("NotFound", 404));
  m.secrets.on(DescribeSecretCommand).rejects(sdkError("ResourceNotFoundException", 400));
  m.ssm.on(GetParametersByPathCommand).resolves({ Parameters: [] });
  m.iam.on(ListRolesCommand).resolves({ Roles: [], IsTruncated: false });
  m.tagging.on(GetResourcesCommand).resolves({ ResourceTagMappingList: [], PaginationToken: "" });
}

describe("AWS stage-resource probe: documented names", () => {
  it("uses the fixed physical names of G-S2/G-08", () => {
    expect(functionName(STAGE)).toBe("reference-test-abc123def456ghi-http");
    expect(clusterIdentifier(STAGE)).toBe("reference-test-abc123def456ghi");
    expect(filesBucketName(STAGE, ACCOUNT)).toBe(`reference-test-abc123def456ghi-files-${ACCOUNT}`);
    expect(credentialsSecretName(STAGE)).toBe("reference-test-abc123def456ghi-database-credentials");
    expect(generatedNameOfStage("reference-test-abc123def456ghi-HttpRole-ab12cd34", STAGE)).toBe(true);
    expect(generatedNameOfStage("reference-test-zzz999yyy888xxx-HttpRole-ab12cd34", STAGE)).toBe(false);
    expect(generatedNameOfStage("other-test-abc123def456ghi-HttpRole", STAGE)).toBe(false);
  });
});

describe("AWS stage-resource probe", () => {
  it("reports nothing for a removed stage, with every probe sent to the stage's exact identifiers", async () => {
    allAbsent();
    expect(await listAwsStageResources(STAGE)).toEqual([]);
    const m = t.mocks();
    expect(m.lambda.commandCalls(GetFunctionConfigurationCommand)[0]?.args[0].input).toEqual({ FunctionName: "reference-test-abc123def456ghi-http" });
    expect(m.rds.commandCalls(DescribeDBClustersCommand)[0]?.args[0].input).toEqual({ DBClusterIdentifier: "reference-test-abc123def456ghi" });
    expect(m.s3.commandCalls(HeadBucketCommand)[0]?.args[0].input).toEqual({ Bucket: `reference-test-abc123def456ghi-files-${ACCOUNT}`, ExpectedBucketOwner: ACCOUNT });
    expect(m.secrets.commandCalls(DescribeSecretCommand)[0]?.args[0].input).toEqual({ SecretId: "reference-test-abc123def456ghi-database-credentials" });
    expect(m.ssm.commandCalls(GetParametersByPathCommand)[0]?.args[0].input).toMatchObject({ Path: "/reference/test-abc123def456ghi/", Recursive: true });
    const tagCalls = m.tagging.commandCalls(GetResourcesCommand);
    // Account region plus us-east-1 (CloudFront), both filtered on both SST stage tags.
    expect(tagCalls).toHaveLength(2);
    for (const c of tagCalls) {
      expect(c.args[0].input.TagFilters).toEqual([
        { Key: "sst:app", Values: ["reference"] },
        { Key: "sst:stage", Values: ["test-abc123def456ghi"] },
      ]);
    }
    expectNoAwsTraffic(t.guard());
  });

  it("reports every leftover once: named resources, parameters, stage roles and other tagged resources", async () => {
    allAbsent();
    const m = t.mocks();
    m.lambda.on(GetFunctionConfigurationCommand).resolves({ FunctionName: functionName(STAGE) });
    m.rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [{ DBClusterIdentifier: clusterIdentifier(STAGE) }] });
    m.s3.on(HeadBucketCommand).resolves({});
    m.secrets.on(DescribeSecretCommand).resolves({ Name: credentialsSecretName(STAGE), DeletedDate: new Date() });
    m.ssm.on(GetParametersByPathCommand).resolves({ Parameters: [{ Name: "/reference/test-abc123def456ghi/secrets/apiKey" }] });
    m.iam
      .on(ListRolesCommand)
      .resolvesOnce({ Roles: [{ RoleName: "reference-test-abc123def456ghi-HttpRole-1a2b3c4d" } as never], IsTruncated: true, Marker: "m1" })
      .resolvesOnce({ Roles: [{ RoleName: "reference-test-zzz999yyy888xxx-HttpRole-9z9z9z9z" } as never], IsTruncated: false });
    m.tagging
      .on(GetResourcesCommand)
      .resolvesOnce({
        ResourceTagMappingList: [
          { ResourceARN: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:reference-test-abc123def456ghi-http` },
          { ResourceARN: `arn:aws:rds:${REGION}:${ACCOUNT}:cluster:reference-test-abc123def456ghi` },
          { ResourceARN: `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:reference-test-abc123def456ghi-database-credentials-AbC123` },
          { ResourceARN: `arn:aws:s3:::reference-test-abc123def456ghi-sitebucket-ab12cd34` },
        ],
        PaginationToken: "",
      })
      .resolvesOnce({ ResourceTagMappingList: [{ ResourceARN: `arn:aws:cloudfront::${ACCOUNT}:distribution/E123ABC` }] });
    expect(await listAwsStageResources(STAGE)).toEqual([
      "Lambda function reference-test-abc123def456ghi-http",
      "Aurora cluster reference-test-abc123def456ghi",
      `S3 bucket reference-test-abc123def456ghi-files-${ACCOUNT}`,
      "secret reference-test-abc123def456ghi-database-credentials",
      "SSM parameter /reference/test-abc123def456ghi/secrets/apiKey",
      "IAM role reference-test-abc123def456ghi-HttpRole-1a2b3c4d",
      `tagged resource arn:aws:cloudfront::${ACCOUNT}:distribution/E123ABC`,
      "tagged resource arn:aws:s3:::reference-test-abc123def456ghi-sitebucket-ab12cd34",
    ]);
    expect(m.iam.commandCalls(ListRolesCommand)[1]?.args[0].input).toEqual({ MaxItems: 1000, Marker: "m1" });
    expectNoAwsTraffic(t.guard());
  });

  it("keeps a stale tagged ARN of an already deleted named resource as a leftover", async () => {
    allAbsent();
    t.mocks()
      .tagging.on(GetResourcesCommand)
      .resolves({ ResourceTagMappingList: [{ ResourceARN: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:reference-test-abc123def456ghi-http` }] });
    const d = await awsStageResourceDetails(STAGE);
    expect(d.functions).toEqual([]);
    expect(d.tagged).toEqual([`arn:aws:lambda:${REGION}:${ACCOUNT}:function:reference-test-abc123def456ghi-http`]);
  });

  it("queries the tagging API once when the account region is us-east-1", async () => {
    process.env.AWS_REGION = "us-east-1";
    allAbsent();
    await listAwsStageResources(STAGE);
    expect(t.mocks().tagging.commandCalls(GetResourcesCommand)).toHaveLength(1);
  });

  it("fails on an unexpected error instead of reporting the resource absent", async () => {
    allAbsent();
    t.mocks().rds.on(DescribeDBClustersCommand).rejects(sdkError("AccessDenied", 403));
    await expect(listAwsStageResources(STAGE)).rejects.toThrow("reading Aurora cluster reference-test-abc123def456ghi failed: AccessDenied (HTTP 403)");
  });

  it("handles test stages only, and listStageResources (DEC-0279) dispatches aws here", async () => {
    await expect(listAwsStageResources({ app: "reference", stage: "prod" })).rejects.toThrow(/test stages only/);
    allAbsent();
    expect(await listStageResources({ target: "aws", ...STAGE })).toEqual([]);
  });
});
