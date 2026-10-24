/**
 * AWS account setup, shared-resource part (PROV-REQ-004; aws.md "Deploy mechanics"
 * `setupAccount`; LOG §2; PROV §2 "State home"; DEC-0074, DEC-0075). The account's shared
 * resources, all in the account's region:
 * - the shared S3 log bucket `prototype-logs-<account-id>`. Its location *is* the account's
 *   region setting (provisioning.md §2): it is read back with `GetBucketLocation` on every run,
 *   never kept only on the owner's machine;
 * - the shared database network `prototype-shared` (DEC-0074): one VPC with two private subnets
 *   in two Availability Zones, the DB subnet group `prototype-shared` and the security group
 *   `prototype-shared-db` (no ingress: clusters are reached only through the Data API). No
 *   internet gateway, no NAT gateway, every part tagged `prototype-framework=shared-network`;
 * - SST's state home on AWS (`home: "aws"`): SST's own per-region bootstrap (the `/sst/bootstrap`
 *   parameter and the `sst-state-*`/`sst-asset-*` buckets it names), which `setupAccount` makes
 *   SST create by running `sst unlock` on a minimal app (G-S2 Q4).
 * Used by `setupAccount` (create when absent) and the deploy preflight (inspect only), through
 * the per-target operations `inspectAccount` and `createSharedResources`.
 *
 * Bucket ownership: `HeadBucket` with `ExpectedBucketOwner` = this account. 200 → owned; 404 →
 * absent; 403 → it exists but this account does not own it (or cannot read it): foreign. Any
 * other answer is an error naming the bucket. A creation answered `BucketAlreadyOwnedByYou` is
 * the end state PROV-REQ-004 requires; `BucketAlreadyExists` is foreign.
 *
 * Before creating anything, `createSharedResources` makes the engine check (`engine.ts`) in the
 * region and stops, creating nothing, when the region fails it. All of this is unverified
 * against AWS until phase L (L-0, L-2).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  type Tag,
} from "@aws-sdk/client-ec2";
import { CreateDBSubnetGroupCommand, DescribeDBSubnetGroupsCommand, ModifyDBSubnetGroupCommand, type DBSubnetGroup } from "@aws-sdk/client-rds";
import { CreateBucketCommand, GetBucketLocationCommand, HeadBucketCommand, PutPublicAccessBlockCommand, type BucketLocationConstraint, type S3Client } from "@aws-sdk/client-s3";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import type { SharedResource } from "../core/operations.js";
import { processSstExec, type SstExec } from "../cloudflare/sst.js";
import { checkEngine } from "./engine.js";
import { checkCredentials, createAwsClients, DEFAULT_REGION, describeAwsError, errorNameOf, httpStatusOf, sstEnvironment, type AwsClients, type Environment } from "./environment.js";

/** The account's shared log bucket on AWS (LOG §2). */
export const logBucketName = (accountId: string): string => `prototype-logs-${accountId}`;

/** The shared network's name: VPC `Name` tag, DB subnet group. */
export const NETWORK_NAME = "prototype-shared";
/** The shared network's security group. */
export const SECURITY_GROUP_NAME = "prototype-shared-db";
/** The tag every part of the shared network carries; the VPC is found by it. */
export const NETWORK_TAG = { Key: "prototype-framework", Value: "shared-network" } as const;
export const VPC_CIDR = "10.0.0.0/16";
/** Private subnet ranges, used in order; two are needed. */
export const SUBNET_CIDRS = ["10.0.0.0/20", "10.0.16.0/20", "10.0.32.0/20", "10.0.48.0/20"] as const;
/** The number of private subnets (and distinct Availability Zones) in the shared network. */
export const SUBNET_COUNT = 2;

/** SST's per-region bootstrap parameter (G-S2 Q4) and the minimum bootstrap version it accepts. */
export const SST_BOOTSTRAP_PARAMETER = "/sst/bootstrap";
export const SST_BOOTSTRAP_VERSION = 5;
/** The AWS provider version SST uses (PAR-109). */
export const AWS_PROVIDER = "7.20.0";
/** The minimal SST app and stage run to bootstrap the state home; a stage of it is never deployed. */
export const BOOTSTRAP_APP = "prototypeaccount";
export const BOOTSTRAP_STAGE = "account";

/** The shared resources' names as printed to the owner. */
export const logBucketResource = (accountId: string, region: string): string => `S3 bucket ${logBucketName(accountId)} (${region})`;
export const networkResource = (region: string): string => `shared network ${NETWORK_NAME} (${region}: VPC, ${SUBNET_COUNT} private subnets, DB subnet group, security group)`;
export const stateHomeResource = (region: string): string => `SST state home (${region})`;

type BucketState = SharedResource["state"];

/** A bucket's ownership as seen from `accountId` (see the header). Sends only `HeadBucket`. */
export async function inspectBucket(s3: S3Client, bucket: string, accountId: string): Promise<BucketState> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket, ExpectedBucketOwner: accountId }));
    return "owned";
  } catch (error) {
    const status = httpStatusOf(error);
    if (status === 404 || errorNameOf(error) === "NotFound" || errorNameOf(error) === "NoSuchBucket") return "absent";
    if (status === 403) return "foreign";
    throw new Error(`checking S3 bucket ${bucket} failed: ${describeAwsError(error)}`);
  }
}

/** The region of an S3 `LocationConstraint` (empty means us-east-1; `EU` is the legacy eu-west-1). */
export function regionOfLocation(constraint: string | undefined): string {
  if (constraint === undefined || constraint === "") return "us-east-1";
  if (constraint === "EU") return "eu-west-1";
  return constraint;
}

/** The region of an owned bucket, read from AWS (`GetBucketLocation` with the expected owner). */
export async function bucketRegion(s3: S3Client, bucket: string, accountId: string): Promise<string> {
  try {
    const r = await s3.send(new GetBucketLocationCommand({ Bucket: bucket, ExpectedBucketOwner: accountId }));
    return regionOfLocation(r.LocationConstraint);
  } catch (error) {
    throw new Error(`reading the location of S3 bucket ${bucket} failed: ${describeAwsError(error)}`);
  }
}

async function createLogBucket(s3: S3Client, accountId: string, region: string): Promise<void> {
  const bucket = logBucketName(accountId);
  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ObjectOwnership: "BucketOwnerEnforced",
        ...(region === "us-east-1" ? {} : { CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint } }),
      }),
    );
  } catch (error) {
    const name = errorNameOf(error);
    if (name === "BucketAlreadyExists") {
      throw new Error(`S3 bucket ${bucket} already exists but belongs to another account; nothing was created`);
    }
    if (name !== "BucketAlreadyOwnedByYou") throw new Error(`creating S3 bucket ${bucket} failed: ${describeAwsError(error)}`);
    // Owned already (e.g. a parallel run): fall through to the read-back below.
  }
  if ((await inspectBucket(s3, bucket, accountId)) !== "owned") throw new Error(`creating S3 bucket ${bucket} did not leave a bucket this account owns`);
  const location = await bucketRegion(s3, bucket, accountId);
  if (location !== region) throw new Error(`S3 bucket ${bucket} is in ${location}, not ${region}; the account's region is ${location}`);
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucket,
      ExpectedBucketOwner: accountId,
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Shared network (DEC-0074)
// ---------------------------------------------------------------------------------------------

/** The shared network's identifiers, the input every stage's Aurora cluster is placed with. */
export interface SharedNetwork {
  readonly vpcId: string;
  readonly subnetIds: readonly string[];
  readonly dbSubnetGroupName: string;
  readonly securityGroupId: string;
}

interface FoundSubnet {
  readonly id: string;
  readonly zone: string;
  readonly cidr: string;
}

interface FoundNetwork {
  readonly vpcId?: string;
  readonly subnets: readonly FoundSubnet[];
  readonly securityGroupId?: string;
  /** The DB subnet group's subnet IDs, when it exists. */
  readonly subnetGroup?: readonly string[];
}

const tags = (name: string): Tag[] => [{ Key: "Name", Value: name }, { ...NETWORK_TAG }];
const tagSpec = (resourceType: "vpc" | "subnet" | "security-group", name: string) => [{ ResourceType: resourceType, Tags: tags(name) }];

/** One subnet per Availability Zone, at most `SUBNET_COUNT`, in zone order. */
function usableSubnets(found: FoundNetwork): FoundSubnet[] {
  const byZone = new Map<string, FoundSubnet>();
  for (const s of [...found.subnets].sort((a, b) => a.zone.localeCompare(b.zone) || a.id.localeCompare(b.id))) if (!byZone.has(s.zone)) byZone.set(s.zone, s);
  return [...byZone.values()].slice(0, SUBNET_COUNT);
}

async function findSubnetGroup(clients: AwsClients, vpcId: string | undefined): Promise<readonly string[] | undefined> {
  let group: DBSubnetGroup | undefined;
  try {
    group = (await clients.rds.send(new DescribeDBSubnetGroupsCommand({ DBSubnetGroupName: NETWORK_NAME }))).DBSubnetGroups?.[0];
  } catch (error) {
    if (errorNameOf(error) === "DBSubnetGroupNotFoundFault") return undefined;
    throw new Error(`checking DB subnet group ${NETWORK_NAME} failed: ${describeAwsError(error)}`);
  }
  if (!group) return undefined;
  if (vpcId === undefined || group.VpcId !== vpcId) {
    throw new Error(
      `DB subnet group ${NETWORK_NAME} exists in ${group.VpcId ?? "an unknown VPC"}, not in the shared network's VPC ${vpcId ?? "(none)"}; delete the subnet group or tag its VPC ${NETWORK_TAG.Key}=${NETWORK_TAG.Value}, then run setup-account again`,
    );
  }
  return (group.Subnets ?? []).map((s) => s.SubnetIdentifier).filter((id): id is string => typeof id === "string");
}

/**
 * Reads the shared network's parts. Throws when the network breaks DEC-0074 (an internet or NAT
 * gateway in the VPC) or is ambiguous (several tagged VPCs). Sends only reads.
 */
async function findNetwork(clients: AwsClients): Promise<FoundNetwork> {
  const { ec2 } = clients;
  const vpcs = (await ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: `tag:${NETWORK_TAG.Key}`, Values: [NETWORK_TAG.Value] }] }))).Vpcs ?? [];
  if (vpcs.length > 1) {
    throw new Error(`${vpcs.length} VPCs carry the tag ${NETWORK_TAG.Key}=${NETWORK_TAG.Value} (${vpcs.map((v) => v.VpcId).join(", ")}); keep one and run setup-account again`);
  }
  const vpcId = vpcs[0]?.VpcId;
  if (vpcId === undefined) {
    await findSubnetGroup(clients, undefined); // throws when a subnet group of that name exists without the VPC
    return { subnets: [] };
  }

  const igws = (await ec2.send(new DescribeInternetGatewaysCommand({ Filters: [{ Name: "attachment.vpc-id", Values: [vpcId] }] }))).InternetGateways ?? [];
  const nats = (await ec2.send(new DescribeNatGatewaysCommand({ Filter: [{ Name: "vpc-id", Values: [vpcId] }, { Name: "state", Values: ["pending", "available"] }] }))).NatGateways ?? [];
  if (igws.length > 0 || nats.length > 0) {
    const what = [...igws.map((g) => `internet gateway ${g.InternetGatewayId}`), ...nats.map((g) => `NAT gateway ${g.NatGatewayId}`)].join(", ");
    throw new Error(`the shared network's VPC ${vpcId} has ${what}; the shared network must have no internet or NAT gateway (DEC-0074); remove ${igws.length + nats.length === 1 ? "it" : "them"} and run setup-account again`);
  }

  const subnets = ((await ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: "vpc-id", Values: [vpcId] }] }))).Subnets ?? [])
    .filter((s) => s.SubnetId && s.AvailabilityZone && s.CidrBlock)
    .map((s) => ({ id: s.SubnetId as string, zone: s.AvailabilityZone as string, cidr: s.CidrBlock as string }));
  const groups =
    (await ec2.send(new DescribeSecurityGroupsCommand({ Filters: [{ Name: "vpc-id", Values: [vpcId] }, { Name: "group-name", Values: [SECURITY_GROUP_NAME] }] }))).SecurityGroups ?? [];
  const securityGroupId = groups[0]?.GroupId;
  const subnetGroup = await findSubnetGroup(clients, vpcId);
  return { vpcId, subnets, ...(securityGroupId === undefined ? {} : { securityGroupId }), ...(subnetGroup === undefined ? {} : { subnetGroup }) };
}

/** The complete network, or undefined when a part is missing. */
function completeNetwork(found: FoundNetwork): SharedNetwork | undefined {
  const subnets = usableSubnets(found);
  if (found.vpcId === undefined || found.securityGroupId === undefined || subnets.length < SUBNET_COUNT || found.subnetGroup === undefined) return undefined;
  const subnetIds = subnets.map((s) => s.id);
  if (!subnetIds.every((id) => found.subnetGroup?.includes(id))) return undefined;
  return { vpcId: found.vpcId, subnetIds, dbSubnetGroupName: NETWORK_NAME, securityGroupId: found.securityGroupId };
}

/** The shared network's state: owned when every part exists, absent otherwise (setup-account completes it). */
async function inspectNetwork(clients: AwsClients): Promise<BucketState> {
  return completeNetwork(await findNetwork(clients)) === undefined ? "absent" : "owned";
}

/** The shared network's identifiers; fails when setup-account has not completed it. */
export async function readSharedNetwork(clients: AwsClients): Promise<SharedNetwork> {
  const network = completeNetwork(await findNetwork(clients));
  if (!network) throw new Error(`the ${networkResource(clients.region)} is missing or incomplete; run setup-account --target aws first`);
  return network;
}

/** Creates the missing parts of the shared network, reusing every part that exists. */
export async function ensureSharedNetwork(clients: AwsClients): Promise<SharedNetwork> {
  const { ec2, rds } = clients;
  let found = await findNetwork(clients);
  let vpcId = found.vpcId;
  if (vpcId === undefined) {
    const vpc = await ec2.send(new CreateVpcCommand({ CidrBlock: VPC_CIDR, TagSpecifications: tagSpec("vpc", NETWORK_NAME) }));
    vpcId = vpc.Vpc?.VpcId;
    if (vpcId === undefined) throw new Error(`creating the VPC of the shared network ${NETWORK_NAME} returned no VPC ID`);
    found = { ...found, vpcId };
  }

  const subnets = usableSubnets(found);
  if (subnets.length < SUBNET_COUNT) {
    const zones = ((await ec2.send(new DescribeAvailabilityZonesCommand({ Filters: [{ Name: "zone-type", Values: ["availability-zone"] }, { Name: "state", Values: ["available"] }] })))
      .AvailabilityZones ?? [])
      .map((z) => z.ZoneName)
      .filter((z): z is string => typeof z === "string")
      .sort();
    const freeZones = zones.filter((z) => !subnets.some((s) => s.zone === z));
    const freeCidrs = SUBNET_CIDRS.filter((c) => !found.subnets.some((s) => s.cidr === c));
    const needed = SUBNET_COUNT - subnets.length;
    if (freeZones.length < needed) throw new Error(`region ${clients.region} has ${zones.length} available Availability Zone(s); the shared network needs ${SUBNET_COUNT}`);
    if (freeCidrs.length < needed) throw new Error(`the shared network's VPC ${vpcId} has no free subnet range among ${SUBNET_CIDRS.join(", ")}`);
    for (let i = 0; i < needed; i += 1) {
      const zone = freeZones[i] as string;
      const cidr = freeCidrs[i] as string;
      const created = await ec2.send(new CreateSubnetCommand({ VpcId: vpcId, CidrBlock: cidr, AvailabilityZone: zone, TagSpecifications: tagSpec("subnet", `${NETWORK_NAME}-${zone}`) }));
      const id = created.Subnet?.SubnetId;
      if (id === undefined) throw new Error(`creating a subnet of the shared network in ${zone} returned no subnet ID`);
      subnets.push({ id, zone, cidr });
    }
  }
  const subnetIds = subnets.map((s) => s.id);

  let securityGroupId = found.securityGroupId;
  if (securityGroupId === undefined) {
    const created = await ec2.send(
      new CreateSecurityGroupCommand({
        GroupName: SECURITY_GROUP_NAME,
        Description: "Shared Aurora clusters of all stages; no ingress (reached only through the Data API)",
        VpcId: vpcId,
        TagSpecifications: tagSpec("security-group", SECURITY_GROUP_NAME),
      }),
    );
    securityGroupId = created.GroupId;
    if (securityGroupId === undefined) throw new Error(`creating security group ${SECURITY_GROUP_NAME} returned no group ID`);
  }

  if (found.subnetGroup === undefined) {
    await rds.send(
      new CreateDBSubnetGroupCommand({
        DBSubnetGroupName: NETWORK_NAME,
        DBSubnetGroupDescription: "Private subnets of the shared network (DEC-0074)",
        SubnetIds: subnetIds,
        Tags: tags(NETWORK_NAME),
      }),
    );
  } else if (!subnetIds.every((id) => found.subnetGroup?.includes(id))) {
    await rds.send(new ModifyDBSubnetGroupCommand({ DBSubnetGroupName: NETWORK_NAME, SubnetIds: [...new Set([...found.subnetGroup, ...subnetIds])] }));
  }
  return { vpcId, subnetIds, dbSubnetGroupName: NETWORK_NAME, securityGroupId };
}

// ---------------------------------------------------------------------------------------------
// SST state home (G-S2 Q4)
// ---------------------------------------------------------------------------------------------

/** The state bucket `/sst/bootstrap` names, or undefined when SST has not bootstrapped the region (or would again). */
async function bootstrapStateBucket(clients: AwsClients): Promise<string | undefined> {
  let value: string | undefined;
  try {
    value = (await clients.ssm.send(new GetParameterCommand({ Name: SST_BOOTSTRAP_PARAMETER }))).Parameter?.Value;
  } catch (error) {
    if (errorNameOf(error) === "ParameterNotFound") return undefined;
    throw new Error(`checking the ${stateHomeResource(clients.region)} (SSM parameter ${SST_BOOTSTRAP_PARAMETER}) failed: ${describeAwsError(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    throw new Error(`SSM parameter ${SST_BOOTSTRAP_PARAMETER} is not SST's bootstrap record (not JSON); delete it and run setup-account again`);
  }
  const record = parsed as { version?: unknown; state?: unknown };
  if (typeof record.version !== "number" || record.version < SST_BOOTSTRAP_VERSION) return undefined; // SST re-bootstraps it
  if (typeof record.state !== "string" || record.state === "") return undefined;
  return record.state;
}

/** The state home's state: SST's bootstrap record and the state bucket it names, owned by this account. */
async function inspectStateHome(clients: AwsClients, accountId: string): Promise<BucketState> {
  const bucket = await bootstrapStateBucket(clients);
  if (bucket === undefined) return "absent";
  const state = await inspectBucket(clients.s3, bucket, accountId);
  if (state === "absent") {
    throw new Error(
      `SST's bootstrap record ${SST_BOOTSTRAP_PARAMETER} in ${clients.region} names the state bucket ${bucket}, which does not exist; delete the parameter and run setup-account again`,
    );
  }
  return state;
}

/** Makes SST bootstrap its AWS state home in `region`. */
export type BootstrapStateHome = (region: string) => Promise<void>;

/** The minimal SST app whose `sst unlock` bootstraps the state home (no resource, never deployed). */
export function bootstrapProgram(region: string): string {
  const data = { app: BOOTSTRAP_APP, provider: AWS_PROVIDER, region };
  return `/// <reference path="./.sst/platform/config.d.ts" />
// Generated by @lago-morph/prototype-framework (PROV setup-account). Bootstraps SST's AWS state home; declares nothing.
const input = ${JSON.stringify(data, null, 2)} as const;

export default $config({
  app() {
    return { name: input.app, home: "aws", providers: { aws: { version: input.provider, region: input.region } } };
  },
  async run() {
    return {};
  },
});
`;
}

/**
 * The real bootstrap (G-S2 Q4): writes the minimal app into `dir` (a fresh temporary directory
 * by default), runs `sst install`, then `sst unlock`, whose project load bootstraps the region.
 */
export function sstStateHomeBootstrap(options: { readonly env: Environment; readonly exec?: SstExec; readonly dir?: string }): BootstrapStateHome {
  const exec = options.exec ?? processSstExec();
  return async (region) => {
    const dir = options.dir ?? mkdtempSync(join(tmpdir(), "prototype-sst-home-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sst.config.ts"), bootstrapProgram(region));
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: `${BOOTSTRAP_APP}-sst`, private: true, type: "module" }, null, 2)}\n`);
    const env = sstEnvironment(options.env, region);
    for (const args of [
      ["install", "--stage", BOOTSTRAP_STAGE],
      ["unlock", "--stage", BOOTSTRAP_STAGE],
    ]) {
      const r = await exec(args, { cwd: dir, env });
      if (r.code !== 0) {
        const tail = r.output.trimEnd().split("\n").slice(-25).join("\n");
        throw new Error(`bootstrapping the ${stateHomeResource(region)}: sst ${args.join(" ")} failed (exit ${r.code}):\n${tail}`);
      }
    }
  };
}

// ---------------------------------------------------------------------------------------------
// The account
// ---------------------------------------------------------------------------------------------

export interface AwsAccountOptions {
  readonly env: Environment;
  /** The region chosen with `setup-account --region`; absent for deploy and when none was chosen. */
  readonly region?: string;
  /** Builds the clients for a region (default: `createAwsClients` with the proxy-aware handler). */
  readonly clients?: (region: string) => AwsClients;
  /** Bootstraps SST's state home (default: `sstStateHomeBootstrap`). */
  readonly bootstrapStateHome?: BootstrapStateHome;
}

export interface AwsAccount {
  /** This account's ID (STS `GetCallerIdentity`, once). */
  accountId(): Promise<string>;
  /** The account's region: the log bucket's location, else the chosen region, else PAR-060. */
  region(): Promise<string>;
  /** Deploy/setup step 1: missing credential variables by name, unusable credentials, and the engine check in the recorded region. */
  preflight(): Promise<string[]>;
  /** The shared resources and their state. Sends only reads. */
  inspectAccount(): Promise<SharedResource[]>;
  /** Creates the given absent shared resources after the engine check. Called only when none is foreign. */
  createSharedResources(absent: readonly SharedResource[]): Promise<void>;
  /** The shared network's identifiers in the account's region. */
  sharedNetwork(): Promise<SharedNetwork>;
}

export function awsAccount(options: AwsAccountOptions): AwsAccount {
  const cache = new Map<string, AwsClients>();
  const clientsFor = (region: string): AwsClients => {
    let c = cache.get(region);
    if (!c) {
      c = (options.clients ?? ((r) => createAwsClients(options.env, r)))(region);
      cache.set(region, c);
    }
    return c;
  };
  const home = (): AwsClients => clientsFor(options.region ?? DEFAULT_REGION);
  let accountIdPromise: Promise<string> | undefined;

  const accountId = (): Promise<string> => {
    accountIdPromise ??= checkCredentials(options.env, home().sts).then((r) => {
      if (!r.ok) throw new Error(r.problems.join("; "));
      return r.accountId;
    });
    return accountIdPromise;
  };

  /** The log bucket's state and the account's region it implies. */
  async function located(): Promise<{ readonly accountId: string; readonly logBucket: BucketState; readonly region: string }> {
    const id = await accountId();
    const bucket = logBucketName(id);
    const logBucket = await inspectBucket(home().s3, bucket, id);
    if (logBucket !== "owned") return { accountId: id, logBucket, region: options.region ?? DEFAULT_REGION };
    const region = await bucketRegion(home().s3, bucket, id);
    if (options.region !== undefined && options.region !== region) {
      throw new Error(
        `the account's region is ${region} (the location of S3 bucket ${bucket}); setup-account cannot move it to ${options.region}. Run setup-account --region ${region}, or remove the account's shared resources first`,
      );
    }
    return { accountId: id, logBucket, region };
  }

  return {
    accountId,
    region: async () => (await located()).region,

    async preflight() {
      const credentials = await checkCredentials(options.env, home().sts);
      if (!credentials.ok) return [...credentials.problems];
      accountIdPromise ??= Promise.resolve(credentials.accountId);
      const where = await located();
      if (where.logBucket !== "owned") return []; // inspectAccount reports the missing setup
      const engine = await checkEngine(clientsFor(where.region).rds, where.region);
      return engine.ok ? [] : [engine.problem];
    },

    async inspectAccount() {
      const where = await located();
      const clients = clientsFor(where.region);
      return [
        { name: logBucketResource(where.accountId, where.region), state: where.logBucket },
        { name: networkResource(where.region), state: await inspectNetwork(clients) },
        { name: stateHomeResource(where.region), state: await inspectStateHome(clients, where.accountId) },
      ];
    },

    async createSharedResources(absent) {
      const where = await located();
      const { region } = where;
      const names = { log: logBucketResource(where.accountId, region), network: networkResource(region), home: stateHomeResource(region) };
      const unknown = absent.filter((r) => !Object.values(names).includes(r.name));
      if (unknown.length > 0) throw new Error(`unknown AWS shared resource ${unknown.map((r) => r.name).join(", ")}`);
      const wanted = new Set(absent.map((r) => r.name));
      if (wanted.size === 0) return;

      const clients = clientsFor(region);
      const engine = await checkEngine(clients.rds, region);
      if (!engine.ok) throw new Error(`${engine.problem}; nothing was created. Choose another region with setup-account --region`);

      if (wanted.has(names.log)) await createLogBucket(home().s3, where.accountId, region);
      if (wanted.has(names.network)) await ensureSharedNetwork(clients);
      if (wanted.has(names.home)) {
        await (options.bootstrapStateHome ?? sstStateHomeBootstrap({ env: options.env }))(region);
        const state = await inspectStateHome(clients, where.accountId);
        if (state !== "owned") {
          throw new Error(
            state === "foreign"
              ? `the ${names.home}'s state bucket belongs to another account; nothing else was changed`
              : `bootstrapping the ${names.home} left no SST bootstrap record ${SST_BOOTSTRAP_PARAMETER}`,
          );
        }
      }
    },

    sharedNetwork: async () => readSharedNetwork(clientsFor((await located()).region)),
  };
}
