import {
  CreateSecurityGroupCommand,
  CreateSubnetCommand,
  CreateVpcCommand,
  DescribeAvailabilityZonesCommand,
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  EC2Client,
  type TagSpecification,
} from "@aws-sdk/client-ec2";
import {
  CreateDBSubnetGroupCommand,
  DBSubnetGroupNotFoundFault,
  DescribeDBEngineVersionsCommand,
  DescribeDBSubnetGroupsCommand,
  DescribeOrderableDBInstanceOptionsCommand,
  ModifyDBSubnetGroupCommand,
  RDSClient,
} from "@aws-sdk/client-rds";
import { CreateBucketCommand, GetBucketLocationCommand, HeadBucketCommand, PutPublicAccessBlockCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { GetParameterCommand, ParameterNotFound, SSMClient } from "@aws-sdk/client-ssm";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import { runDeploy } from "../core/deploy.js";
import { FakeTarget } from "../core/fake-target.js";
import type { SharedResource } from "../core/operations.js";
import { runSetupAccount } from "../core/setup-account.js";
import {
  awsAccount,
  bootstrapProgram,
  BOOTSTRAP_STAGE,
  logBucketName,
  logBucketResource,
  NETWORK_NAME,
  NETWORK_TAG,
  networkResource,
  regionOfLocation,
  SECURITY_GROUP_NAME,
  SST_BOOTSTRAP_PARAMETER,
  sstStateHomeBootstrap,
  stateHomeResource,
  type AwsAccount,
  type AwsAccountOptions,
} from "./account.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "./aws-network-guard.test-support.js";

const ACCOUNT = "123456789012";
const OTHER = "210987654321";
const LOG = logBucketName(ACCOUNT);
const KEYS = { AWS_ACCESS_KEY_ID: "AKIDEXAMPLE", AWS_SECRET_ACCESS_KEY: "never-printed" };

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  expect(guard.attempts).toEqual([]);
  guard.uninstall();
});

const sts = mockClient(STSClient);
const s3 = mockClient(S3Client);
const ec2 = mockClient(EC2Client);
const rds = mockClient(RDSClient);
const ssm = mockClient(SSMClient);
const mocks = [sts, s3, ec2, rds, ssm];
afterAll(() => mocks.forEach((m) => m.restore()));

const s3Error = (name: string, status: number) => new S3ServiceException({ name, $fault: "client", $metadata: { httpStatusCode: status }, message: name });

/** In-memory AWS account behind the client mocks: what each command reads or changes. */
interface World {
  buckets: Map<string, { owner: string; region: string }>;
  vpcs: { id: string; tagged: boolean }[];
  subnets: { id: string; vpc: string; zone: string; cidr: string }[];
  groups: { id: string; vpc: string; name: string }[];
  subnetGroup?: { vpc: string; subnets: string[] };
  igws: { id: string; vpc: string }[];
  nats: { id: string; vpc: string }[];
  parameters: Map<string, string>;
  zones: string[];
  engines: { version: string; min: number; dataApi: boolean }[];
  /** Mutating commands, in order. */
  changes: string[];
  /** `changes.length` each time the engine was checked. */
  engineChecks: number[];
}

function newWorld(): World {
  return {
    buckets: new Map(),
    vpcs: [],
    subnets: [],
    groups: [],
    igws: [],
    nats: [],
    parameters: new Map(),
    zones: ["us-east-1b", "us-east-1a", "us-east-1c"],
    engines: [{ version: "17.5", min: 0, dataApi: true }],
    changes: [],
    engineChecks: [],
  };
}

let world: World;
let n = 0;
const id = (prefix: string) => `${prefix}-${String((n += 1)).padStart(4, "0")}`;
const valuesOf = (filters: { Name?: string; Values?: string[] }[] | undefined, name: string) => filters?.find((f) => f.Name === name)?.Values ?? [];

function wire(): void {
  mocks.forEach((m) => m.reset());
  sts.on(GetCallerIdentityCommand).resolves({ Account: ACCOUNT });

  s3.on(HeadBucketCommand).callsFake((input: { Bucket: string; ExpectedBucketOwner?: string }) => {
    const b = world.buckets.get(input.Bucket);
    if (!b) throw s3Error("NotFound", 404);
    if (input.ExpectedBucketOwner !== b.owner) throw s3Error("Forbidden", 403);
    return {};
  });
  s3.on(GetBucketLocationCommand).callsFake((input: { Bucket: string; ExpectedBucketOwner?: string }) => {
    const b = world.buckets.get(input.Bucket);
    if (!b || b.owner !== input.ExpectedBucketOwner) throw s3Error("AccessDenied", 403);
    return { LocationConstraint: b.region === "us-east-1" ? undefined : b.region };
  });
  s3.on(CreateBucketCommand).callsFake((input: { Bucket: string; CreateBucketConfiguration?: { LocationConstraint?: string } }) => {
    world.changes.push(`CreateBucket ${input.Bucket}`);
    const b = world.buckets.get(input.Bucket);
    if (b) throw s3Error(b.owner === ACCOUNT ? "BucketAlreadyOwnedByYou" : "BucketAlreadyExists", 409);
    world.buckets.set(input.Bucket, { owner: ACCOUNT, region: regionOfLocation(input.CreateBucketConfiguration?.LocationConstraint) });
    return {};
  });
  s3.on(PutPublicAccessBlockCommand).callsFake((input: { Bucket: string }) => {
    world.changes.push(`PutPublicAccessBlock ${input.Bucket}`);
    return {};
  });

  ec2.on(DescribeVpcsCommand).callsFake((input: { Filters?: { Name?: string; Values?: string[] }[] }) => {
    expect(valuesOf(input.Filters, `tag:${NETWORK_TAG.Key}`)).toEqual([NETWORK_TAG.Value]);
    return { Vpcs: world.vpcs.filter((v) => v.tagged).map((v) => ({ VpcId: v.id })) };
  });
  ec2.on(CreateVpcCommand).callsFake((input: { TagSpecifications?: { Tags?: { Key?: string; Value?: string }[] }[] }) => {
    const vpc = id("vpc");
    world.changes.push(`CreateVpc ${vpc}`);
    world.vpcs.push({ id: vpc, tagged: (input.TagSpecifications?.[0]?.Tags ?? []).some((t) => t.Key === NETWORK_TAG.Key && t.Value === NETWORK_TAG.Value) });
    return { Vpc: { VpcId: vpc, State: "pending" } };
  });
  ec2.on(DescribeInternetGatewaysCommand).callsFake((input: { Filters?: { Name?: string; Values?: string[] }[] }) => ({
    InternetGateways: world.igws.filter((g) => valuesOf(input.Filters, "attachment.vpc-id").includes(g.vpc)).map((g) => ({ InternetGatewayId: g.id })),
  }));
  ec2.on(DescribeNatGatewaysCommand).callsFake((input: { Filter?: { Name?: string; Values?: string[] }[] }) => ({
    NatGateways: world.nats.filter((g) => valuesOf(input.Filter, "vpc-id").includes(g.vpc)).map((g) => ({ NatGatewayId: g.id })),
  }));
  ec2.on(DescribeSubnetsCommand).callsFake((input: { Filters?: { Name?: string; Values?: string[] }[] }) => ({
    Subnets: world.subnets.filter((s) => valuesOf(input.Filters, "vpc-id").includes(s.vpc)).map((s) => ({ SubnetId: s.id, AvailabilityZone: s.zone, CidrBlock: s.cidr })),
  }));
  ec2.on(DescribeAvailabilityZonesCommand).callsFake(() => ({ AvailabilityZones: world.zones.map((z) => ({ ZoneName: z, State: "available" })) }));
  ec2.on(CreateSubnetCommand).callsFake((input: { VpcId: string; AvailabilityZone: string; CidrBlock: string }) => {
    const subnet = id("subnet");
    world.changes.push(`CreateSubnet ${input.AvailabilityZone} ${input.CidrBlock}`);
    world.subnets.push({ id: subnet, vpc: input.VpcId, zone: input.AvailabilityZone, cidr: input.CidrBlock });
    return { Subnet: { SubnetId: subnet } };
  });
  ec2.on(DescribeSecurityGroupsCommand).callsFake((input: { Filters?: { Name?: string; Values?: string[] }[] }) => ({
    SecurityGroups: world.groups
      .filter((g) => valuesOf(input.Filters, "vpc-id").includes(g.vpc) && valuesOf(input.Filters, "group-name").includes(g.name))
      .map((g) => ({ GroupId: g.id, GroupName: g.name })),
  }));
  ec2.on(CreateSecurityGroupCommand).callsFake((input: { VpcId: string; GroupName: string }) => {
    const group = id("sg");
    world.changes.push(`CreateSecurityGroup ${input.GroupName}`);
    world.groups.push({ id: group, vpc: input.VpcId, name: input.GroupName });
    return { GroupId: group };
  });

  rds.on(DescribeDBSubnetGroupsCommand).callsFake(() => {
    if (!world.subnetGroup) throw new DBSubnetGroupNotFoundFault({ $metadata: { httpStatusCode: 404 }, message: "not found" });
    return { DBSubnetGroups: [{ DBSubnetGroupName: NETWORK_NAME, VpcId: world.subnetGroup.vpc, Subnets: world.subnetGroup.subnets.map((s) => ({ SubnetIdentifier: s })) }] };
  });
  rds.on(CreateDBSubnetGroupCommand).callsFake((input: { SubnetIds: string[] }) => {
    world.changes.push(`CreateDBSubnetGroup ${NETWORK_NAME} ${input.SubnetIds.join(",")}`);
    const vpc = world.subnets.find((s) => s.id === input.SubnetIds[0])?.vpc ?? "?";
    world.subnetGroup = { vpc, subnets: [...input.SubnetIds] };
    return {};
  });
  rds.on(ModifyDBSubnetGroupCommand).callsFake((input: { SubnetIds: string[] }) => {
    world.changes.push(`ModifyDBSubnetGroup ${NETWORK_NAME} ${input.SubnetIds.join(",")}`);
    if (world.subnetGroup) world.subnetGroup.subnets = [...input.SubnetIds];
    return {};
  });
  rds.on(DescribeDBEngineVersionsCommand).callsFake(() => {
    world.engineChecks.push(world.changes.length);
    return {
      DBEngineVersions: world.engines.map((e) => ({ Engine: "aurora-postgresql", EngineVersion: e.version, Status: "available", ServerlessV2FeaturesSupport: { MinCapacity: e.min, MaxCapacity: 256 } })),
    };
  });
  rds.on(DescribeOrderableDBInstanceOptionsCommand).callsFake((input: { EngineVersion?: string }) => ({
    OrderableDBInstanceOptions: [{ SupportsHttpEndpoint: world.engines.find((e) => e.version === input.EngineVersion)?.dataApi ?? false }],
  }));

  ssm.on(GetParameterCommand).callsFake((input: { Name: string }) => {
    const value = world.parameters.get(input.Name);
    if (value === undefined) throw new ParameterNotFound({ $metadata: { httpStatusCode: 400 }, message: "not found" });
    return { Parameter: { Name: input.Name, Value: value, Type: "String" } };
  });
}

/** SST's bootstrap as the fake sees it: the record and its state bucket, created by "sst unlock". */
const bootstraps: string[] = [];
function fakeBootstrap(region: string): Promise<void> {
  bootstraps.push(region);
  world.changes.push(`sst bootstrap ${region}`);
  world.buckets.set("sst-state-abc123def456", { owner: ACCOUNT, region });
  world.parameters.set(SST_BOOTSTRAP_PARAMETER, JSON.stringify({ version: 5, asset: "sst-asset-abc123def456", state: "sst-state-abc123def456" }));
  return Promise.resolve();
}

function account(options: Partial<AwsAccountOptions> = {}): AwsAccount {
  return awsAccount({ env: KEYS, bootstrapStateHome: fakeBootstrap, ...options });
}

/** Puts a complete shared network and state home into the world (an account set up earlier). */
function setUp(region = "us-east-1"): void {
  world.buckets.set(LOG, { owner: ACCOUNT, region });
  world.vpcs.push({ id: "vpc-shared", tagged: true });
  world.subnets.push({ id: "subnet-a", vpc: "vpc-shared", zone: `${region}a`, cidr: "10.0.0.0/20" }, { id: "subnet-b", vpc: "vpc-shared", zone: `${region}b`, cidr: "10.0.16.0/20" });
  world.groups.push({ id: "sg-shared", vpc: "vpc-shared", name: SECURITY_GROUP_NAME });
  world.subnetGroup = { vpc: "vpc-shared", subnets: ["subnet-a", "subnet-b"] };
  world.buckets.set("sst-state-abc123def456", { owner: ACCOUNT, region });
  world.parameters.set(SST_BOOTSTRAP_PARAMETER, JSON.stringify({ version: 5, state: "sst-state-abc123def456" }));
}

/** A target whose account part is the AWS implementation over the mocks. */
function targetOver(a: AwsAccount): FakeTarget {
  const t = new FakeTarget();
  t.inspectAccount = () => a.inspectAccount();
  t.createSharedResources = (absent: readonly SharedResource[]) => a.createSharedResources(absent);
  return t;
}

const READS = /^(Head|Get|Describe)/;
const commandNames = () => mocks.flatMap((m) => m.calls().map((c) => (c.args[0] as { constructor: { name: string } }).constructor.name.replace(/Command$/, "")));

beforeEach(() => {
  world = newWorld();
  bootstraps.length = 0;
  wire();
});

const R = "us-east-1";
const all = (region: string, state: SharedResource["state"]) => [
  { name: logBucketResource(ACCOUNT, region), state },
  { name: networkResource(region), state },
  { name: stateHomeResource(region), state },
];

describe("AWS shared log bucket (PROV-REQ-004; LOG §2)", () => {
  it("is named prototype-logs-<account-id>, and the printed names carry the region", () => {
    expect(LOG).toBe("prototype-logs-123456789012");
    expect(logBucketResource(ACCOUNT, R)).toBe("S3 bucket prototype-logs-123456789012 (us-east-1)");
  });

  it("owned: HeadBucket with the expected owner succeeds; the region is read back with GetBucketLocation", async () => {
    setUp("eu-west-1");
    const a = account();
    expect(await a.inspectAccount()).toEqual(all("eu-west-1", "owned"));
    expect(await a.region()).toBe("eu-west-1");
    const head = s3.commandCalls(HeadBucketCommand).find((c) => c.args[0].input.Bucket === LOG);
    expect(head?.args[0].input).toEqual({ Bucket: LOG, ExpectedBucketOwner: ACCOUNT });
    expect(s3.commandCalls(GetBucketLocationCommand)[0]?.args[0].input).toEqual({ Bucket: LOG, ExpectedBucketOwner: ACCOUNT });
  });

  it("absent: HeadBucket 404; the region is the chosen one, else PAR-060", async () => {
    expect(await account().inspectAccount()).toEqual(all(R, "absent"));
    expect(await account({ region: "eu-central-1" }).region()).toBe("eu-central-1");
    expect(s3.commandCalls(GetBucketLocationCommand)).toHaveLength(0);
  });

  it("foreign: HeadBucket 403 with the expected owner", async () => {
    world.buckets.set(LOG, { owner: OTHER, region: R });
    expect((await account().inspectAccount())[0]).toEqual({ name: logBucketResource(ACCOUNT, R), state: "foreign" });
  });

  it("any other HeadBucket answer is an error naming the bucket, never a guess", async () => {
    s3.on(HeadBucketCommand).rejects(s3Error("InternalError", 500));
    await expect(account().inspectAccount()).rejects.toThrow(`checking S3 bucket ${LOG} failed: InternalError (HTTP 500)`);
  });

  it("the location is the account's region: a different --region on an account set up elsewhere stops before any change", async () => {
    setUp("eu-west-1");
    const io = captureIo();
    expect((await runSetupAccount(targetOver(account({ region: "us-west-2" })), io)).status).toBe(1);
    expect(io.err).toMatch(/the account's region is eu-west-1 \(the location of S3 bucket prototype-logs-123456789012\); setup-account cannot move it to us-west-2/);
    expect(world.changes).toEqual([]);
  });

  it("regionOfLocation maps S3's empty and legacy constraints", () => {
    expect(regionOfLocation(undefined)).toBe("us-east-1");
    expect(regionOfLocation("")).toBe("us-east-1");
    expect(regionOfLocation("EU")).toBe("eu-west-1");
    expect(regionOfLocation("ap-southeast-2")).toBe("ap-southeast-2");
  });

  it("[PROV-AC-007] AWS: with HeadBucket stubbed to 403 for the expected owner (the log bucket belongs to another account), setup-account and deploy stop with a message naming the bucket and change nothing", async () => {
    world.buckets.set(LOG, { owner: OTHER, region: R });
    const t = targetOver(account());

    const setupIo = captureIo();
    expect((await runSetupAccount(t, setupIo)).status).toBe(1);
    expect(setupIo.err).toContain(`S3 bucket ${LOG}`);
    expect(setupIo.err).toMatch(/another account/);

    const deployIo = captureIo();
    const deploy = await runDeploy(t, { stage: { app: "notes", stage: "test-abc" }, migrations: { framework: [], app: [] }, requiredSecrets: [] }, deployIo);
    expect(deploy.status).toBe(1);
    expect(deploy.failure?.step).toBe("preflight");
    expect(deployIo.err).toContain(`S3 bucket ${LOG}`);
    expect(deployIo.err).toMatch(/another account/);

    const head = s3.commandCalls(HeadBucketCommand).find((c) => c.args[0].input.Bucket === LOG);
    expect(head?.args[0].input.ExpectedBucketOwner).toBe(ACCOUNT);
    expect(commandNames().every((c) => READS.test(c))).toBe(true);
    expect(world.changes).toEqual([]);
    expect(bootstraps).toEqual([]);
    expect(t.calls.filter((c) => !/^(preflight|listSetSecrets)\b/.test(c))).toEqual([]);
  });
});

describe("setup-account on AWS (PROV-REQ-004, PROV-AC-004 offline)", () => {
  it("absent: checks the engine, then creates the log bucket in the region, the shared network and the state home", async () => {
    const io = captureIo();
    const r = await runSetupAccount(targetOver(account({ region: "eu-west-1" })), io);
    expect(r.status).toBe(0);
    expect(r.created).toEqual(all("eu-west-1", "absent").map((x) => x.name));
    expect(io.out).toContain(`created: S3 bucket ${LOG} (eu-west-1), shared network prototype-shared (eu-west-1: VPC, 2 private subnets, DB subnet group, security group), SST state home (eu-west-1)`);

    expect(world.engineChecks).toEqual([0]); // checked once, before the first change
    expect(world.buckets.get(LOG)).toEqual({ owner: ACCOUNT, region: "eu-west-1" });
    expect(s3.commandCalls(CreateBucketCommand)[0]?.args[0].input).toEqual({ Bucket: LOG, ObjectOwnership: "BucketOwnerEnforced", CreateBucketConfiguration: { LocationConstraint: "eu-west-1" } });
    expect(s3.commandCalls(PutPublicAccessBlockCommand)[0]?.args[0].input).toMatchObject({ Bucket: LOG, ExpectedBucketOwner: ACCOUNT });
    expect(bootstraps).toEqual(["eu-west-1"]);
  });

  it("us-east-1 buckets are created without a location constraint", async () => {
    await runSetupAccount(targetOver(account()), captureIo());
    expect(s3.commandCalls(CreateBucketCommand)[0]?.args[0].input).toEqual({ Bucket: LOG, ObjectOwnership: "BucketOwnerEnforced" });
  });

  it("the shared network: two private subnets in two AZs, a DB subnet group and a security group, all tagged; no IGW, no NAT", async () => {
    await runSetupAccount(targetOver(account()), captureIo());
    expect(world.changes.filter((c) => !/Bucket|bootstrap|PublicAccess/.test(c))).toEqual([
      `CreateVpc ${world.vpcs[0]?.id}`,
      "CreateSubnet us-east-1a 10.0.0.0/20",
      "CreateSubnet us-east-1b 10.0.16.0/20",
      "CreateSecurityGroup prototype-shared-db",
      `CreateDBSubnetGroup prototype-shared ${world.subnets.map((s) => s.id).join(",")}`,
    ]);
    const tagged = (spec: readonly TagSpecification[] | undefined) => (spec?.[0]?.Tags ?? []).some((t) => t.Key === NETWORK_TAG.Key && t.Value === NETWORK_TAG.Value);
    expect(tagged(ec2.commandCalls(CreateVpcCommand)[0]?.args[0].input.TagSpecifications)).toBe(true);
    expect(ec2.commandCalls(CreateSubnetCommand).every((c) => tagged(c.args[0].input.TagSpecifications))).toBe(true);
    expect(tagged(ec2.commandCalls(CreateSecurityGroupCommand)[0]?.args[0].input.TagSpecifications)).toBe(true);
    expect(rds.commandCalls(CreateDBSubnetGroupCommand)[0]?.args[0].input.Tags).toContainEqual({ ...NETWORK_TAG });
    // AWS-AC-002 offline: nothing that gives the network a route out is ever created.
    expect(commandNames().filter((c) => /InternetGateway|NatGateway|Route|Address|Ingress/.test(c) && !c.startsWith("Describe"))).toEqual([]);
    expect(await account().sharedNetwork()).toEqual({
      vpcId: world.vpcs[0]?.id,
      subnetIds: world.subnets.map((s) => s.id),
      dbSubnetGroupName: NETWORK_NAME,
      securityGroupId: world.groups[0]?.id,
    });
  });

  it("idempotent re-run: a second setup-account sends only reads and changes nothing, including the state home", async () => {
    const t = targetOver(account({ region: "eu-west-1" }));
    expect((await runSetupAccount(t, captureIo())).status).toBe(0);
    const changed = [...world.changes];
    mocks.forEach((m) => m.resetHistory());
    const io = captureIo();
    expect(await runSetupAccount(targetOver(account({ region: "eu-west-1" })), io)).toEqual({ status: 0, created: [] });
    expect(io.out).toContain("setup-account (fake): nothing changed");
    expect(io.out).toContain(`already present: S3 bucket ${LOG} (eu-west-1)`);
    expect(world.changes).toEqual(changed);
    expect(commandNames().every((c) => READS.test(c))).toBe(true);
    expect(bootstraps).toEqual(["eu-west-1"]);
  });

  it("a re-run without --region on an account set up in another region uses the recorded region", async () => {
    setUp("ap-southeast-2");
    expect(await runSetupAccount(targetOver(account()), captureIo())).toEqual({ status: 0, created: [] });
    expect(await account().region()).toBe("ap-southeast-2");
  });

  it("partial VPC: an existing tagged VPC with one subnet and no security group or subnet group is completed, reusing what exists", async () => {
    world.buckets.set(LOG, { owner: ACCOUNT, region: R });
    world.vpcs.push({ id: "vpc-old", tagged: true });
    world.subnets.push({ id: "subnet-old", vpc: "vpc-old", zone: "us-east-1a", cidr: "10.0.0.0/20" });
    world.buckets.set("sst-state-abc123def456", { owner: ACCOUNT, region: R });
    world.parameters.set(SST_BOOTSTRAP_PARAMETER, JSON.stringify({ version: 5, state: "sst-state-abc123def456" }));

    const a = account();
    expect(await a.inspectAccount()).toEqual([
      { name: logBucketResource(ACCOUNT, R), state: "owned" },
      { name: networkResource(R), state: "absent" },
      { name: stateHomeResource(R), state: "owned" },
    ]);
    const r = await runSetupAccount(targetOver(a), captureIo());
    expect(r).toEqual({ status: 0, created: [networkResource(R)] });
    const newSubnet = world.subnets[1]?.id;
    expect(world.changes).toEqual([
      "CreateSubnet us-east-1b 10.0.16.0/20",
      "CreateSecurityGroup prototype-shared-db",
      `CreateDBSubnetGroup prototype-shared subnet-old,${newSubnet}`,
    ]);
    expect(ec2.commandCalls(CreateVpcCommand)).toHaveLength(0);
    expect(await a.inspectAccount()).toEqual(all(R, "owned"));
  });

  it("partial VPC: a subnet group missing a subnet is modified to cover both", async () => {
    setUp();
    world.subnetGroup = { vpc: "vpc-shared", subnets: ["subnet-a"] };
    expect((await account().inspectAccount())[1]?.state).toBe("absent");
    await runSetupAccount(targetOver(account()), captureIo());
    expect(world.changes).toEqual(["ModifyDBSubnetGroup prototype-shared subnet-a,subnet-b"]);
  });

  it("a shared VPC with an internet or NAT gateway stops setup-account and deploy, naming it (DEC-0074)", async () => {
    setUp();
    world.igws.push({ id: "igw-1", vpc: "vpc-shared" });
    world.nats.push({ id: "nat-1", vpc: "vpc-shared" });
    const io = captureIo();
    expect((await runSetupAccount(targetOver(account()), io)).status).toBe(1);
    expect(io.err).toMatch(/VPC vpc-shared has internet gateway igw-1, NAT gateway nat-1; the shared network must have no internet or NAT gateway \(DEC-0074\)/);
    expect(world.changes).toEqual([]);
  });

  it("several tagged VPCs, or a subnet group in another VPC, are errors naming them", async () => {
    world.vpcs.push({ id: "vpc-1", tagged: true }, { id: "vpc-2", tagged: true });
    await expect(account().inspectAccount()).rejects.toThrow(/2 VPCs carry the tag prototype-framework=shared-network \(vpc-1, vpc-2\)/);
    world.vpcs = [];
    world.subnetGroup = { vpc: "vpc-elsewhere", subnets: [] };
    await expect(account().inspectAccount()).rejects.toThrow(/DB subnet group prototype-shared exists in vpc-elsewhere, not in the shared network's VPC \(none\)/);
  });

  it("a region with fewer than two Availability Zones cannot hold the network", async () => {
    world.zones = ["us-east-1a"];
    const io = captureIo();
    expect((await runSetupAccount(targetOver(account()), io)).status).toBe(1);
    expect(io.err).toMatch(/region us-east-1 has 1 available Availability Zone\(s\); the shared network needs 2/);
  });

  it("wrong engine: a region without PAR-110 (Data API, 0 ACU) stops setup-account before anything is created", async () => {
    world.engines = [{ version: "17.5", min: 0.5, dataApi: true }, { version: "16.8", min: 0, dataApi: true }];
    const io = captureIo();
    expect((await runSetupAccount(targetOver(account({ region: "eu-south-2" })), io)).status).toBe(1);
    expect(io.err).toMatch(/region eu-south-2 does not offer Aurora PostgreSQL 17\.x \(PAR-110\) with the Data API and a 0 ACU minimum capacity \(PAR-212\).*nothing was created/);
    expect(world.changes).toEqual([]);
    expect(commandNames().every((c) => READS.test(c))).toBe(true);
  });

  it("a creation that finds the bucket already owned (BucketAlreadyOwnedByYou) is not an error", async () => {
    world.buckets.set(LOG, { owner: ACCOUNT, region: R });
    await expect(account().createSharedResources([{ name: logBucketResource(ACCOUNT, R), state: "absent" }])).resolves.toBeUndefined();
  });

  it("a creation answered BucketAlreadyExists is foreign and names the bucket", async () => {
    s3.on(HeadBucketCommand).rejects(s3Error("NotFound", 404));
    s3.on(CreateBucketCommand).rejects(s3Error("BucketAlreadyExists", 409));
    await expect(account().createSharedResources([{ name: logBucketResource(ACCOUNT, R), state: "absent" }])).rejects.toThrow(
      `S3 bucket ${LOG} already exists but belongs to another account; nothing was created`,
    );
  });

  it("an unknown resource name is refused", async () => {
    await expect(account().createSharedResources([{ name: "R2 bucket prototype-logs", state: "absent" }])).rejects.toThrow(/unknown AWS shared resource R2 bucket prototype-logs/);
  });
});

describe("SST state home on AWS (G-S2 Q4)", () => {
  it("absent without /sst/bootstrap, or with a record below version 5; owned when the named state bucket is this account's", async () => {
    setUp();
    expect((await account().inspectAccount())[2]?.state).toBe("owned");
    world.parameters.set(SST_BOOTSTRAP_PARAMETER, JSON.stringify({ version: 4, state: "sst-state-abc123def456" }));
    expect((await account().inspectAccount())[2]?.state).toBe("absent");
    world.parameters.delete(SST_BOOTSTRAP_PARAMETER);
    expect((await account().inspectAccount())[2]?.state).toBe("absent");
  });

  it("foreign when the named state bucket belongs to another account; setup-account stops", async () => {
    setUp();
    world.buckets.set("sst-state-abc123def456", { owner: OTHER, region: R });
    const io = captureIo();
    expect((await runSetupAccount(targetOver(account()), io)).status).toBe(1);
    expect(io.err).toContain("SST state home (us-east-1)");
  });

  it("a record naming a missing bucket is an error telling the owner what to delete", async () => {
    setUp();
    world.buckets.delete("sst-state-abc123def456");
    await expect(account().inspectAccount()).rejects.toThrow(/names the state bucket sst-state-abc123def456, which does not exist; delete the parameter/);
  });

  it("the real bootstrap writes a minimal home: aws app and runs sst install, then sst unlock, with the SST environment", async () => {
    const runs: { args: readonly string[]; cwd: string; env: Record<string, string> }[] = [];
    const dir = `${process.env.TMPDIR ?? "/tmp"}/g07-bootstrap-${process.pid}`;
    const bootstrap = sstStateHomeBootstrap({
      env: KEYS,
      dir,
      exec: async (args, o) => {
        runs.push({ args, cwd: o.cwd, env: o.env });
        return { code: 0, output: "" };
      },
    });
    await bootstrap("eu-west-1");
    expect(runs.map((r) => r.args)).toEqual([
      ["install", "--stage", BOOTSTRAP_STAGE],
      ["unlock", "--stage", BOOTSTRAP_STAGE],
    ]);
    expect(runs[1]?.cwd).toBe(dir);
    expect(runs[1]?.env).toMatchObject({ AWS_REGION: "eu-west-1", NODE_USE_ENV_PROXY: "1", ...KEYS });
    const program = bootstrapProgram("eu-west-1");
    expect(program).toContain(`home: "aws"`);
    expect(program).toContain(`"region": "eu-west-1"`);
    expect(program).toContain(`"provider": "7.20.0"`);
    expect(program).not.toMatch(/new (sst|aws)\./);
  });

  it("a failing sst command is reported with its exit code and output tail", async () => {
    const bootstrap = sstStateHomeBootstrap({ env: KEYS, dir: `${process.env.TMPDIR ?? "/tmp"}/g07-bootstrap-fail-${process.pid}`, exec: async () => ({ code: 3, output: "line1\nAccessDenied ssm:PutParameter\n" }) });
    await expect(bootstrap("us-east-1")).rejects.toThrow(/bootstrapping the SST state home \(us-east-1\): sst install --stage account failed \(exit 3\):\nline1\nAccessDenied ssm:PutParameter/);
  });
});

describe("AWS preflight (PROV-REQ-002 step 1)", () => {
  it("missing env: names the variables and sends nothing", async () => {
    expect(await account({ env: {} }).preflight()).toEqual(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
    expect(commandNames()).toEqual([]);
  });

  it("calls STS GetCallerIdentity, then makes the engine check in the recorded region", async () => {
    setUp("eu-west-1");
    expect(await account().preflight()).toEqual([]);
    expect(commandNames()[0]).toBe("GetCallerIdentity");
    expect(commandNames()).toContain("DescribeDBEngineVersions");
    expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(1);
  });

  it("wrong engine in the recorded region fails the preflight, naming the region", async () => {
    setUp("eu-west-1");
    world.engines = [{ version: "17.5", min: 0, dataApi: false }];
    expect(await account().preflight()).toEqual([expect.stringMatching(/^region eu-west-1 does not offer Aurora PostgreSQL 17\.x/)]);
  });

  it("without a log bucket the preflight leaves the missing setup to inspectAccount: deploy tells the owner to run setup-account", async () => {
    const a = account();
    expect(await a.preflight()).toEqual([]);
    const t = targetOver(a);
    const io = captureIo();
    const deploy = await runDeploy(t, { stage: { app: "notes", stage: "test-abc" }, migrations: { framework: [], app: [] }, requiredSecrets: [] }, io);
    expect(deploy.status).toBe(1);
    expect(io.err).toContain(`S3 bucket ${LOG}`);
    expect(io.err).toMatch(/setup-account/);
    expect(world.changes).toEqual([]);
  });
});
