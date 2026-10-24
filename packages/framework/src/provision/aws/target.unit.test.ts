/**
 * The AWS `TargetOperations` (G-10) against `aws-sdk-client-mock` and an injected fake SST, with
 * PROV's target-neutral deploy and remove sequences on top. No AWS call is made and `sst` never
 * runs: the network guard records any attempt to reach AWS, and the suite asserts it saw none.
 *
 * The fake SST models what root cause 2026-10-23-pass1 and DEC-PENDING-G-S2-3 established for
 * SST 4.17.2: `--target` resolves only against the stage's checkpoint (`app/<app>/<stage>.json`
 * in the state bucket), so a target on a new stage fails with `Target not found`; a targeted run
 * adds nothing to state; an untargeted run makes the state equal the program (deleting a Function
 * the program leaves out); `remove` without a checkpoint fails with `Stage not found`; with
 * `state.purge`, a successful remove deletes the stage's state objects and passphrase.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteFunctionConcurrencyCommand, GetFunctionCommand, LambdaClient, PutFunctionConcurrencyCommand } from "@aws-sdk/client-lambda";
import { DescribeDBClustersCommand, DescribeDBEngineVersionsCommand, DescribeOrderableDBInstanceOptionsCommand, RDSClient } from "@aws-sdk/client-rds";
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient } from "@aws-sdk/client-resource-groups-tagging-api";
import { DeleteObjectsCommand, HeadBucketCommand, HeadObjectCommand, ListObjectVersionsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";
import { DeleteSecretCommand, DescribeSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DeleteParameterCommand, DeleteParametersCommand, GetParameterCommand, GetParametersByPathCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import type { MigrationDatabase } from "../../mig/apply.js";
import type { Migration } from "../../mig/history.js";
import { runDeploy, type DeployRequest } from "../core/deploy.js";
import type { ListedDatabase, Stage, StageDatabase } from "../core/operations.js";
import { runRemove } from "../core/remove.js";
import type { AwsAccount } from "./account.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "./aws-network-guard.test-support.js";
import type { AwsDatabaseOperations } from "./databases.js";
import { clusterIdentifier, databaseSecretName, filesBucketName, functionName } from "./names.js";
import type { SstExec } from "./sst.js";
import { createAwsStageClients, createAwsTarget, kindOfArn, sstAppDir, sstPassphraseParameter, stageOfDatabase, type AwsTargetOptions } from "./target.js";

const ACCOUNT = "123456789012";
const REGION = "eu-west-1";
const STATE = "sst-state-abcdef123456";
const stage: Stage = { app: "notes", stage: "test-abc" };
const other: Stage = { app: "notes", stage: "test-abcd" };
const KEYS = { AWS_ACCESS_KEY_ID: "AKIDEXAMPLE", AWS_SECRET_ACCESS_KEY: "never-printed", PATH: "/usr/bin" };
const ORIGIN = "https://d111111abcdef8.cloudfront.net";

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  expect(guard.attempts).toEqual([]);
  guard.uninstall();
});

const lambda = mockClient(LambdaClient);
const rds = mockClient(RDSClient);
const s3 = mockClient(S3Client);
const secrets = mockClient(SecretsManagerClient);
const ssm = mockClient(SSMClient);
const tagging = mockClient(ResourceGroupsTaggingAPIClient);
const mocks = [lambda, rds, s3, secrets, ssm, tagging];
afterAll(() => mocks.forEach((m) => m.restore()));

const awsError = (name: string, status: number) => Object.assign(new Error(name), { name, $fault: "client", $metadata: { httpStatusCode: status } });

interface ObjectVersion {
  readonly key: string;
  readonly versionId: string;
  readonly deleteMarker?: boolean;
}

/** The in-memory account behind the mocks, and the ordered log of what changed it. */
class World {
  readonly functions = new Map<string, { reserved?: number }>();
  readonly clusters = new Map<string, { version: string }>();
  readonly secretArns = new Map<string, string>();
  readonly parameters = new Map<string, string>();
  readonly buckets = new Map<string, ObjectVersion[]>();
  readonly cors = new Map<string, unknown>();
  readonly tagged: { arn: string; app: string; stage: string; region: string }[] = [];
  /** SST's per-stage state: the logical components it has deployed. */
  readonly sstState = new Map<string, Set<string>>();
  readonly sstRuns: string[] = [];
  /** The program each SST run saw. */
  readonly programs: string[] = [];
  readonly log: string[] = [];
  readonly fail = new Map<string, Error>();
  readonly sstFail = new Set<string>();
  /** Database names per cluster (the injected Data API operations). */
  readonly databases = new Map<string, Set<string>>();
  readonly databaseArns: { resourceArn: string; secretArn: string }[] = [];
  private version = 0;

  constructor() {
    this.buckets.set(STATE, []);
    this.parameters.set("/sst/bootstrap", JSON.stringify({ version: 5, state: STATE, asset: "sst-asset-abcdef123456" }));
  }

  nextVersion = () => `v${++this.version}`;
  putObject(bucket: string, key: string) {
    this.buckets.get(bucket)!.push({ key, versionId: this.nextVersion() });
  }
  /** Current (non-deleted) keys of a bucket. */
  keys(bucket: string): string[] {
    const latest = new Map<string, ObjectVersion>();
    for (const v of this.buckets.get(bucket) ?? []) latest.set(v.key, v);
    return [...latest.values()].filter((v) => !v.deleteMarker).map((v) => v.key);
  }
  /** A versioned delete: adds a delete marker (as on the versioned state bucket). */
  deleteCurrent(bucket: string, key: string) {
    this.buckets.get(bucket)!.push({ key, versionId: this.nextVersion(), deleteMarker: true });
  }
  check(command: string) {
    const e = this.fail.get(command);
    if (e) throw e;
  }
}

let world: World;

function installMocks() {
  mocks.forEach((m) => m.reset());
  const w = world;
  const logged =
    <I, O>(command: string, f: (input: I) => O) =>
    (input: I) => {
      w.check(command);
      w.log.push(command);
      return f(input);
    };
  lambda.on(GetFunctionCommand).callsFake((input: { FunctionName: string }) => {
    w.check("GetFunction");
    if (!w.functions.has(input.FunctionName)) throw awsError("ResourceNotFoundException", 404);
    return { Configuration: { FunctionName: input.FunctionName, FunctionArn: `arn:aws:lambda:${REGION}:${ACCOUNT}:function:${input.FunctionName}` } };
  });
  lambda.on(PutFunctionConcurrencyCommand).callsFake(
    logged("PutFunctionConcurrency", (input: { FunctionName: string; ReservedConcurrentExecutions: number }) => {
      const f = w.functions.get(input.FunctionName);
      if (!f) throw awsError("ResourceNotFoundException", 404);
      f.reserved = input.ReservedConcurrentExecutions;
      return {};
    }),
  );
  lambda.on(DeleteFunctionConcurrencyCommand).callsFake(
    logged("DeleteFunctionConcurrency", (input: { FunctionName: string }) => {
      const f = w.functions.get(input.FunctionName);
      if (!f) throw awsError("ResourceNotFoundException", 404);
      delete f.reserved;
      return {};
    }),
  );
  rds.on(DescribeDBClustersCommand).callsFake((input: { DBClusterIdentifier: string }) => {
    w.check("DescribeDBClusters");
    const c = w.clusters.get(input.DBClusterIdentifier);
    if (!c) throw awsError("DBClusterNotFoundFault", 404);
    return { DBClusters: [{ DBClusterIdentifier: input.DBClusterIdentifier, DBClusterArn: `arn:aws:rds:${REGION}:${ACCOUNT}:cluster:${input.DBClusterIdentifier}`, EngineVersion: c.version }] };
  });
  rds.on(DescribeDBEngineVersionsCommand).resolves({ DBEngineVersions: [{ Engine: "aurora-postgresql", EngineVersion: "17.5", Status: "available", ServerlessV2FeaturesSupport: { MinCapacity: 0, MaxCapacity: 256 } }] });
  rds.on(DescribeOrderableDBInstanceOptionsCommand).resolves({ OrderableDBInstanceOptions: [{ EngineVersion: "17.5", DBInstanceClass: "db.serverless", SupportsHttpEndpoint: true }] });
  secrets.on(DescribeSecretCommand).callsFake((input: { SecretId: string }) => {
    w.check("DescribeSecret");
    const arn = w.secretArns.get(input.SecretId);
    if (!arn) throw awsError("ResourceNotFoundException", 400);
    return { ARN: arn, Name: input.SecretId };
  });
  secrets.on(DeleteSecretCommand).callsFake(
    logged("DeleteSecret", (input: { SecretId: string; ForceDeleteWithoutRecovery?: boolean }) => {
      if (!input.ForceDeleteWithoutRecovery) throw new Error("test: a recovery window was requested");
      if (!w.secretArns.delete(input.SecretId)) throw awsError("ResourceNotFoundException", 400);
      return {};
    }),
  );
  ssm.on(PutParameterCommand).callsFake(
    logged("PutParameter", (input: { Name: string; Value: string; Type: string; Overwrite: boolean }) => {
      if (input.Type !== "SecureString" || !input.Overwrite) throw new Error("test: not an overwriting SecureString");
      w.parameters.set(input.Name, input.Value);
      return { Version: 1 };
    }),
  );
  ssm.on(GetParameterCommand).callsFake((input: { Name: string }) => {
    w.check("GetParameter");
    const v = w.parameters.get(input.Name);
    if (v === undefined) throw awsError("ParameterNotFound", 400);
    return { Parameter: { Name: input.Name, Value: v } };
  });
  ssm.on(GetParametersByPathCommand).callsFake((input: { Path: string; Recursive?: boolean; NextToken?: string }) => {
    w.check("GetParametersByPath");
    const names = [...w.parameters.keys()].filter((n) => n.startsWith(input.Path) && (input.Recursive || !n.slice(input.Path.length).includes("/"))).sort();
    // Two per page, to exercise pagination.
    const start = input.NextToken === undefined ? 0 : Number(input.NextToken);
    const page = names.slice(start, start + 2).map((Name) => ({ Name, Type: "SecureString" }));
    return { Parameters: page, ...(start + 2 < names.length ? { NextToken: String(start + 2) } : {}) };
  });
  ssm.on(DeleteParametersCommand).callsFake(
    logged("DeleteParameters", (input: { Names: string[] }) => {
      if (input.Names.length > 10) throw new Error("test: more than 10 names");
      for (const n of input.Names) w.parameters.delete(n);
      return { DeletedParameters: input.Names };
    }),
  );
  ssm.on(DeleteParameterCommand).callsFake(
    logged("DeleteParameter", (input: { Name: string }) => {
      if (!w.parameters.delete(input.Name)) throw awsError("ParameterNotFound", 400);
      return {};
    }),
  );
  s3.on(HeadBucketCommand).callsFake((input: { Bucket: string; ExpectedBucketOwner?: string }) => {
    if (input.ExpectedBucketOwner !== ACCOUNT) throw new Error("test: no expected owner");
    if (!w.buckets.has(input.Bucket)) throw awsError("NotFound", 404);
    return {};
  });
  s3.on(HeadObjectCommand).callsFake((input: { Bucket: string; Key: string }) => {
    w.check("HeadObject");
    if (!w.keys(input.Bucket).includes(input.Key)) throw awsError("NotFound", 404);
    return {};
  });
  s3.on(ListObjectVersionsCommand).callsFake((input: { Bucket: string; Prefix?: string; KeyMarker?: string; ExpectedBucketOwner?: string }) => {
    w.check("ListObjectVersions");
    if (input.ExpectedBucketOwner !== ACCOUNT) throw new Error("test: no expected owner");
    const all = w.buckets.get(input.Bucket);
    if (!all) throw awsError("NoSuchBucket", 404);
    const matching = all.filter((v) => v.key.startsWith(input.Prefix ?? ""));
    // Pages of three versions; the marker is an index in this test.
    const start = input.KeyMarker === undefined ? 0 : Number(input.KeyMarker);
    const page = matching.slice(start, start + 3);
    const truncated = start + 3 < matching.length;
    return {
      Versions: page.filter((v) => !v.deleteMarker).map((v) => ({ Key: v.key, VersionId: v.versionId })),
      DeleteMarkers: page.filter((v) => v.deleteMarker).map((v) => ({ Key: v.key, VersionId: v.versionId })),
      IsTruncated: truncated,
      ...(truncated ? { NextKeyMarker: String(start + 3), NextVersionIdMarker: "x" } : {}),
    };
  });
  s3.on(DeleteObjectsCommand).callsFake(
    logged("DeleteObjects", (input: { Bucket: string; Delete: { Objects: { Key: string; VersionId?: string }[] } }) => {
      const all = w.buckets.get(input.Bucket)!;
      for (const o of input.Delete.Objects) {
        if (o.VersionId === undefined) throw new Error("test: an unversioned delete");
        const i = all.findIndex((v) => v.key === o.Key && v.versionId === o.VersionId);
        if (i >= 0) all.splice(i, 1);
      }
      return {};
    }),
  );
  s3.on(PutBucketCorsCommand).callsFake(
    logged("PutBucketCors", (input: { Bucket: string; CORSConfiguration: unknown }) => {
      if (!w.buckets.has(input.Bucket)) throw awsError("NoSuchBucket", 404);
      w.cors.set(input.Bucket, input.CORSConfiguration);
      return {};
    }),
  );
  tagging.on(GetResourcesCommand).callsFake(async (input: { TagFilters: { Key: string; Values: string[] }[] }, getClient: () => ResourceGroupsTaggingAPIClient) => {
    const region = await getClient().config.region();
    const app = input.TagFilters.find((f) => f.Key === "sst:app")?.Values[0];
    const st = input.TagFilters.find((f) => f.Key === "sst:stage")?.Values[0];
    return { ResourceTagMappingList: w.tagged.filter((t) => t.app === app && t.stage === st && t.region === region).map((t) => ({ ResourceARN: t.arn })), PaginationToken: "" };
  });
}

const secretArnOf = (s: Stage) => `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:${databaseSecretName(s)}-AbCdEf`;
const routerArn = (s: Stage) => `arn:aws:cloudfront::${ACCOUNT}:distribution/E${s.stage.toUpperCase().replace(/-/g, "")}`;
const roleArn = (s: Stage) => `arn:aws:iam::${ACCOUNT}:role/${s.app}-${s.stage}-HttpRole-abcd1234`;

/** The fake SST binary (see the file header). */
function fakeSst(w: World): SstExec {
  return async (args, { cwd }) => {
    const [command] = args;
    const st = args[args.indexOf("--stage") + 1]!;
    const program = readFileSync(join(cwd, "sst.config.ts"), "utf8");
    const app = /"app": "([^"]+)"/.exec(program)![1]!;
    const s = { app, stage: st };
    const key = `${app}/${st}`;
    const run = args.join(" ");
    w.sstRuns.push(run);
    w.programs.push(program);
    w.log.push(`sst ${run}`);
    if (command === "install") {
      mkdirSync(join(cwd, ".sst", "platform"), { recursive: true });
      return { code: 0, output: "installed" };
    }
    if (w.sstFail.has(command!)) return { code: 1, output: `✕  ${command} failed (injected)` };
    if (!w.parameters.has(sstPassphraseParameter(s))) w.parameters.set(sstPassphraseParameter(s), "passphrase");
    w.putObject(STATE, `update/${app}/${st}/${w.nextVersion()}.json`);
    const checkpoint = `app/${app}/${st}.json`;
    const state = w.keys(STATE).includes(checkpoint) ? (w.sstState.get(key) ?? new Set<string>()) : new Set<string>();
    if (command === "deploy") {
      const target = args.includes("--target") ? args[args.indexOf("--target") + 1]!.split(",") : undefined;
      if (target) {
        for (const t of target) if (!state.has(t)) return { code: 1, output: `~  Deploy\n✕  Target not found: ${t}` };
        // A targeted run deploys only the targets (and their dependents: none here); state is unchanged.
      } else {
        const declared = new Set(["Files", "Database"]);
        if (!program.includes('"http": null')) ["Router", "Http"].forEach((c) => declared.add(c));
        for (const c of state) if (!declared.has(c) && c === "Http") w.functions.delete(functionName(s));
        if (!w.buckets.has(filesBucketName(s, ACCOUNT))) w.buckets.set(filesBucketName(s, ACCOUNT), []);
        if (!w.clusters.has(clusterIdentifier(s))) w.clusters.set(clusterIdentifier(s), { version: /"auroraVersion": "([^"]+)"/.exec(program)![1]! });
        if (!w.secretArns.has(databaseSecretName(s))) w.secretArns.set(databaseSecretName(s), secretArnOf(s));
        if (!w.databases.has(clusterIdentifier(s))) w.databases.set(clusterIdentifier(s), new Set(["postgres"]));
        if (declared.has("Http")) {
          if (!w.functions.has(functionName(s))) w.functions.set(functionName(s), {});
          for (const arn of [routerArn(s), roleArn(s)]) if (!w.tagged.some((t) => t.arn === arn)) w.tagged.push({ arn, app, stage: st, region: arn.includes("cloudfront") ? "us-east-1" : REGION });
        } else {
          w.tagged.splice(0, w.tagged.length, ...w.tagged.filter((t) => !(t.app === app && t.stage === st && (t.arn.includes("cloudfront") || t.arn.includes("role/")))));
        }
        w.sstState.set(key, declared);
        w.putObject(STATE, checkpoint);
      }
      const outputs = {
        databaseSecretArn: secretArnOf(s),
        clusterArn: `arn:aws:rds:${REGION}:${ACCOUNT}:cluster:${clusterIdentifier(s)}`,
        ...(program.includes('"http": null') ? {} : { url: `${ORIGIN}/`, functionUrl: "https://abc.lambda-url.eu-west-1.on.aws/" }),
      };
      mkdirSync(join(cwd, ".sst"), { recursive: true });
      writeFileSync(join(cwd, ".sst", "outputs.json"), JSON.stringify(outputs));
      return { code: 0, output: "✓  Complete" };
    }
    if (command === "remove") {
      if (!w.keys(STATE).includes(checkpoint)) return { code: 1, output: "✕  Stage not found" };
      const bucket = filesBucketName(s, ACCOUNT);
      if ((w.buckets.get(bucket)?.length ?? 0) > 0) return { code: 1, output: "✕  BucketNotEmpty" };
      w.buckets.delete(bucket);
      w.functions.delete(functionName(s));
      w.clusters.delete(clusterIdentifier(s));
      w.databases.delete(clusterIdentifier(s));
      w.secretArns.delete(databaseSecretName(s));
      w.tagged.splice(0, w.tagged.length, ...w.tagged.filter((t) => !(t.app === app && t.stage === st)));
      w.sstState.delete(key);
      // state.purge: the stage's state objects (every version) and the passphrase.
      w.buckets.set(STATE, w.buckets.get(STATE)!.filter((v) => !v.key.includes(`/${app}/${st}/`) && !v.key.endsWith(`/${app}/${st}.json`)));
      w.parameters.delete(sstPassphraseParameter(s));
      return { code: 0, output: "✓  Removed" };
    }
    return { code: 1, output: `unknown command ${command}` };
  };
}

/** The injected Data API operations: databases per cluster, created and dropped in memory. */
function fakeDatabases(w: World): NonNullable<AwsTargetOptions["databases"]> {
  return ({ resourceArn, secretArn }) => {
    w.databaseArns.push({ resourceArn, secretArn });
    const cluster = resourceArn.split(":cluster:")[1]!;
    const dbs = () => {
      const d = w.databases.get(cluster);
      if (!d) throw new Error("test: no cluster");
      return d;
    };
    const records = new Map<string, Set<string>>();
    const sdb = (name: string): StageDatabase => ({ name, number: Number(/(\d+)$/.exec(name)![1]), id: name });
    const migrationDatabase = (database: StageDatabase): MigrationDatabase => ({
      dialect: "postgres",
      recordedIds: async () => new Set(records.get(database.name) ?? []),
      applyAtomically: async (m: Migration) => {
        w.log.push(`migrate ${database.name} ${m.id}`);
        records.set(database.name, new Set([...(records.get(database.name) ?? []), m.id]));
      },
    });
    const ops: AwsDatabaseOperations = {
      waitForResume: async () => {},
      createDatabase: async (_s, name) => (w.log.push(`create ${name}`), dbs().add(name), sdb(name)),
      copyDatabase: async (_s, from, name) => {
        w.log.push(`copy ${from.name} ${name}`);
        dbs().add(name);
        records.set(name, new Set(records.get(from.name) ?? []));
        return sdb(name);
      },
      dropDatabase: async (_s, db) => void (w.log.push(`drop ${db.name}`), dbs().delete(db.name)),
      listDatabases: async (): Promise<ListedDatabase[]> => [...dbs()].sort().map((name) => ({ name, id: name })),
      migrationDatabase,
      checkMigratedDatabase: async () => {},
    };
    return ops;
  };
}

const network = { vpcId: "vpc-0aaa", subnetIds: ["subnet-0aaa", "subnet-0bbb"], dbSubnetGroupName: "prototype-shared", securityGroupId: "sg-0ccc" };
const stubAccount = (): AwsAccount => ({
  accountId: async () => ACCOUNT,
  region: async () => REGION,
  preflight: async () => [],
  inspectAccount: async () => [{ name: "S3 bucket prototype-logs-123456789012 (eu-west-1)", state: "owned" }],
  createSharedResources: async () => {},
  sharedNetwork: async () => network,
});

/** Health 204; S3 preflight allows exactly the origin in the bucket's CORS rule. */
function fakeFetch(w: World): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname === "/api/__framework/health") return new Response(null, { status: 204 });
    const bucket = u.hostname.split(".s3.")[0]!;
    const rule = (w.cors.get(bucket) as { CORSRules: { AllowedOrigins: string[] }[] } | undefined)?.CORSRules[0];
    const origin = new Headers(init?.headers).get("Origin") ?? "";
    return new Response(null, { status: 200, headers: rule?.AllowedOrigins.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {} });
  }) as typeof fetch;
}

const code = { bundle: "/app/.framework/aws/bundle", handler: "index.handler", assetsDirectory: "/app/dist/client" };

function setup(overrides: Partial<AwsTargetOptions> = {}) {
  const options: AwsTargetOptions = {
    env: KEYS,
    appDir: mkdtempSync(join(tmpdir(), "aws-target-")),
    account: stubAccount(),
    databases: fakeDatabases(world),
    sst: fakeSst(world),
    code,
    fetch: fakeFetch(world),
    randomKey: () => "generated-session-key",
    sleep: async () => {},
    ...overrides,
  };
  return { options, target: createAwsTarget(options) };
}

const migration = (id: string): Migration => ({ id, name: id.split("/")[1]!, file: `${id}.sql`, text: "", checksum: "", statements: [] });
const MIGRATIONS = { framework: [migration("framework/0001_init")], app: [migration("app/0001_schema")] };
const request = (s = stage, migrations = MIGRATIONS): DeployRequest => ({ stage: s, migrations, requiredSecrets: [] });
const db1: StageDatabase = { name: "notes-test-abc-db-1", number: 1, id: "notes-test-abc-db-1" };

beforeEach(() => {
  world = new World();
  installMocks();
});

describe("AWS deploy (PROV-REQ-002 steps 3, 5, 6, 7)", () => {
  it("a first deploy: step 3 untargeted without the Function, the first database, the session key, step 5 untargeted with it, CORS by API, start, health", async () => {
    const { target } = setup();
    const io = captureIo();
    const result = await runDeploy(target, request(), io);
    expect(io.err).toBe("");
    expect(result).toEqual({ status: 0, publicOrigin: ORIGIN });
    expect(world.sstRuns).toEqual(["install --stage test-abc", "deploy --stage test-abc", "deploy --stage test-abc"]);
    expect(world.log).toEqual([
      "sst install --stage test-abc",
      "sst deploy --stage test-abc",
      "create notes-test-abc-db-1",
      "migrate notes-test-abc-db-1 framework/0001_init",
      "migrate notes-test-abc-db-1 app/0001_schema",
      "PutParameter",
      "sst deploy --stage test-abc",
      "PutBucketCors",
      "DeleteFunctionConcurrency",
    ]);
    expect(world.parameters.get("/notes/test-abc/secrets/frameworkSessionKey")).toBe("generated-session-key");
    expect(world.cors.get(filesBucketName(stage, ACCOUNT))).toEqual({
      CORSRules: [{ AllowedOrigins: [ORIGIN], AllowedMethods: ["PUT", "GET"], AllowedHeaders: ["Content-Type"], ExposeHeaders: [], MaxAgeSeconds: 60 }],
    });
    expect(world.functions.get(functionName(stage))).toEqual({});
    // The Data API operations name the fixed cluster ARN and the secret found by its name.
    expect(world.databaseArns[0]).toEqual({ resourceArn: `arn:aws:rds:${REGION}:${ACCOUNT}:cluster:notes-test-abc`, secretArn: secretArnOf(stage) });
    // The program of step 3 declared no Function; step 5's did, against the new database.
    expect(world.programs[1]).toContain('"http": null');
    expect(world.programs[2]).toContain('"FRAMEWORK_DATABASE": "notes-test-abc-db-1"');
    expect(world.programs[2]).toContain(`"FRAMEWORK_DATABASE_SECRET_ARN": "${secretArnOf(stage)}"`);
  });

  it("a later deploy: step 3 targets Files,Database with the full program and leaves the Function alone; step 5 is untargeted; the session key is kept", async () => {
    const { target, options } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    await target.setSecret(stage, "apiKey", "v-1");
    const fn = world.functions.get(functionName(stage));
    world.log.length = 0;
    world.sstRuns.length = 0;
    await target.deployInfrastructure({ stage, database: db1 });
    expect(world.sstRuns).toEqual(["deploy --stage test-abc --target Files,Database"]);
    expect(world.functions.get(functionName(stage))).toBe(fn);
    const program = readFileSync(join(sstAppDir(options.appDir), "sst.config.ts"), "utf8");
    expect(program).toContain(`"name": "notes-test-abc-http"`);
    expect(program).toContain(`"FRAMEWORK_DATABASE": "notes-test-abc-db-1"`);

    world.log.length = 0;
    world.sstRuns.length = 0;
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    expect(world.log).toEqual(["sst deploy --stage test-abc --target Files,Database", "sst deploy --stage test-abc", "PutBucketCors", "DeleteFunctionConcurrency"]);
    expect(world.parameters.get("/notes/test-abc/secrets/frameworkSessionKey")).toBe("generated-session-key");
    expect(world.parameters.get("/notes/test-abc/secrets/apiKey")).toBe("v-1");
  });

  it("a schema-changing deploy stops the Function (reserved concurrency 0) before the copy and starts it after step 5", async () => {
    const { target } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    world.log.length = 0;
    const more = { ...MIGRATIONS, app: [...MIGRATIONS.app, migration("app/0002_more")] };
    expect((await runDeploy(target, request(stage, more), captureIo())).status).toBe(0);
    expect(world.log).toEqual([
      "sst deploy --stage test-abc --target Files,Database",
      "PutFunctionConcurrency",
      "copy notes-test-abc-db-1 notes-test-abc-db-2",
      "migrate notes-test-abc-db-2 app/0002_more",
      "drop notes-test-abc-db-1",
      "sst deploy --stage test-abc",
      "PutBucketCors",
      "DeleteFunctionConcurrency",
    ]);
    expect(lambda.commandCalls(PutFunctionConcurrencyCommand)[0]?.args[0].input).toEqual({ FunctionName: "notes-test-abc-http", ReservedConcurrentExecutions: 0 });
    expect(world.programs.at(-1)).toContain('"FRAMEWORK_DATABASE": "notes-test-abc-db-2"');
  });

  it("an existing cluster keeps its engine version; a new one gets the engine check's", async () => {
    const { target, options } = setup();
    await target.deployInfrastructure({ stage });
    expect(readFileSync(join(sstAppDir(options.appDir), "sst.config.ts"), "utf8")).toContain(`"auroraVersion": "17.5"`);
    world.clusters.get(clusterIdentifier(stage))!.version = "17.4";
    world.databases.get(clusterIdentifier(stage))!.add("notes-test-abc-db-1");
    await target.deployInfrastructure({ stage, database: db1 });
    expect(readFileSync(join(sstAppDir(options.appDir), "sst.config.ts"), "utf8")).toContain(`"auroraVersion": "17.4"`);
  });

  it("R1: step 3 of a stage with a database but no built code is refused before SST runs", async () => {
    const { code: _c, ...rest } = setup().options;
    const target = createAwsTarget(rest);
    await expect(target.deployInfrastructure({ stage, database: db1 })).rejects.toThrow(/no built Function code; build --target aws/);
    await expect(target.deployCode({ stage, database: db1 })).rejects.toThrow(/no built Function code/);
    expect(world.sstRuns).toEqual([]);
  });

  it("R2: step 3 of a stage whose Function exists but which has no database is refused before SST runs; the Function and the secrets stay", async () => {
    const { target } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    await target.setSecret(stage, "apiKey", "v-1");
    world.databases.get(clusterIdentifier(stage))!.clear();
    world.sstRuns.length = 0;
    const io = captureIo();
    const result = await runDeploy(target, request(), io);
    expect(result.failure?.step).toBe("infrastructure");
    expect(io.err).toMatch(/Lambda function notes-test-abc-http but no database; step 3 would delete the function; restore the database or run remove/);
    expect(world.sstRuns).toEqual([]);
    expect(world.functions.has(functionName(stage))).toBe(true);
    expect(world.parameters.get("/notes/test-abc/secrets/apiKey")).toBe("v-1");
  });

  it("the fake SST models the root cause: a targeted first deploy would fail with Target not found", async () => {
    const { options } = setup();
    const dir = sstAppDir(options.appDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sst.config.ts"), `const input = { "app": "notes", "http": null };`);
    expect(await fakeSst(world)(["deploy", "--stage", "test-abc", "--target", "Files,Database"], { cwd: dir, env: {} })).toEqual({ code: 1, output: "~  Deploy\n✕  Target not found: Files" });
  });

  it("failures name the step and never carry a value: SST, a CORS rule, the session key, the start", async () => {
    const a = setup();
    world.sstFail.add("deploy");
    const io = captureIo();
    expect((await runDeploy(a.target, request(), io)).failure?.step).toBe("infrastructure");
    expect(io.err).toMatch(/sst deploy --stage test-abc failed \(exit 1\)/);

    world = new World();
    installMocks();
    const b = setup();
    world.fail.set("PutBucketCors", awsError("AccessDenied", 403));
    const io2 = captureIo();
    expect((await runDeploy(b.target, request(), io2)).failure?.step).toBe("code");
    expect(io2.err).toMatch(/setting the CORS rule of S3 bucket notes-test-abc-files-123456789012 failed: AccessDenied \(HTTP 403\)/);

    world = new World();
    installMocks();
    const c = setup();
    world.fail.set("PutParameter", Object.assign(awsError("ThrottlingException", 400), { message: "contains generated-session-key" }));
    const io3 = captureIo();
    expect((await runDeploy(c.target, request(), io3)).failure?.step).toBe("code");
    expect(io3.err).toMatch(/setting SSM parameter \/notes\/test-abc\/secrets\/frameworkSessionKey failed: ThrottlingException \(HTTP 400\)/);
    expect(io3.err).not.toContain("generated-session-key");

    world = new World();
    installMocks();
    const d = setup();
    world.fail.set("DeleteFunctionConcurrency", awsError("ServiceException", 500));
    const io4 = captureIo();
    expect((await runDeploy(d.target, request(), io4)).failure?.step).toBe("start");
    expect(io4.err).toMatch(/starting Lambda function notes-test-abc-http \(removing its reserved concurrency\) failed: ServiceException \(HTTP 500\)/);
  });

  it("deployCode without a credentials secret (step 3 never ran) fails naming it", async () => {
    const { target } = setup();
    await expect(target.deployCode({ stage, database: db1 })).rejects.toThrow(/database-credentials secret notes-test-abc-database-credentials does not exist/);
    expect(world.sstRuns).toEqual([]);
  });

  it("a credentials secret that is not the stage's is refused", async () => {
    const { target } = setup();
    world.secretArns.set(databaseSecretName(stage), `arn:aws:secretsmanager:${REGION}:${ACCOUNT}:secret:other-secret-AbCdEf`);
    world.clusters.set(clusterIdentifier(stage), { version: "17.5" });
    await expect(target.deployCode({ stage, database: db1 })).rejects.toThrow(/is not the stage's secret/);
  });
});

describe("AWS secrets, stop and start (SEC-REQ-003; DEC-0078)", () => {
  it("secrets are SecureString parameters under /<app>/<stage>/secrets/; the listing pages and is never null", async () => {
    const { target } = setup();
    expect(await target.listSetSecrets(stage)).toEqual(new Set());
    for (const n of ["a", "b", "c"]) await target.setSecret(stage, n, `v-${n}`);
    await target.setSecret(other, "x", "v-x");
    world.parameters.set("/notes/test-abc/secrets/nested/deep", "not a secret name");
    expect(await target.listSetSecrets(stage)).toEqual(new Set(["a", "b", "c"]));
    expect(ssm.commandCalls(PutParameterCommand)[0]?.args[0].input).toEqual({ Name: "/notes/test-abc/secrets/a", Value: "v-a", Type: "SecureString", Overwrite: true });
  });

  it("a failed secret write names the parameter and the error, never the value", async () => {
    const { target } = setup();
    world.fail.set("PutParameter", Object.assign(awsError("AccessDeniedException", 400), { message: "the value s3cr3t" }));
    const error = (await target.setSecret(stage, "apiKey", "s3cr3t").then(
      () => undefined,
      (e: unknown) => e,
    )) as Error;
    expect(error.message).toBe("setting SSM parameter /notes/test-abc/secrets/apiKey failed: AccessDeniedException (HTTP 400)");
  });

  it("stop sets reserved concurrency 0, start removes it; stopping a stage without a Function is a no-op; other failures are reported", async () => {
    const { target } = setup();
    await expect(target.stopApp(stage)).resolves.toBeUndefined();
    world.functions.set(functionName(stage), {});
    await target.stopApp(stage);
    expect(world.functions.get(functionName(stage))).toEqual({ reserved: 0 });
    await target.startApp(stage);
    expect(world.functions.get(functionName(stage))).toEqual({});
    world.fail.set("PutFunctionConcurrency", awsError("TooManyRequestsException", 429));
    await expect(target.stopApp(stage)).rejects.toThrow(/stopping Lambda function notes-test-abc-http \(reserved concurrency 0\) failed: TooManyRequestsException \(HTTP 429\)/);
    world.functions.delete(functionName(stage));
    world.fail.clear();
    await expect(target.startApp(stage)).rejects.toThrow(/ResourceNotFoundException/);
  });
});

describe("AWS health (PROV-REQ-002 step 7)", () => {
  it("passes when the health endpoint answers and S3 allows the stage's origin; fails naming storage otherwise", async () => {
    const { target } = setup({ healthTimeoutMs: 0 });
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    expect(await target.checkHealth(stage, { publicOrigin: ORIGIN })).toEqual({ ok: true });
    world.cors.clear();
    const outcome = await target.checkHealth(stage, { publicOrigin: ORIGIN });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).toMatch(/refused a CORS preflight/);
  });
});

describe("AWS listStageResources (PROV-AC-006: exact identifiers, from a clean machine)", () => {
  it("lists the fixed-name resources, the stage's parameters, SST's passphrase and state objects, and the tagged rest, never another stage's", async () => {
    const first = setup();
    expect((await runDeploy(first.target, request(), captureIo())).status).toBe(0);
    expect((await runDeploy(setup().target, request(other), captureIo())).status).toBe(0);
    await first.target.setSecret(stage, "apiKey", "v-1");

    // A clean machine: a new app directory, no `.sst`, no outputs.
    const clean = setup();
    expect(existsSync(join(sstAppDir(clean.options.appDir), ".sst"))).toBe(false);
    const listed = await clean.target.listStageResources(stage);
    const ids = listed.resources.map((r) => `${r.kind} ${r.id}`);
    expect(ids.slice(0, 7)).toEqual([
      `Lambda function arn:aws:lambda:${REGION}:${ACCOUNT}:function:notes-test-abc-http`,
      `S3 bucket arn:aws:s3:::notes-test-abc-files-${ACCOUNT}`,
      `Aurora cluster arn:aws:rds:${REGION}:${ACCOUNT}:cluster:notes-test-abc`,
      `Secrets Manager secret ${secretArnOf(stage)}`,
      "SSM parameter /notes/test-abc/secrets/apiKey",
      "SSM parameter /notes/test-abc/secrets/frameworkSessionKey",
      "SSM parameter /sst/passphrase/notes/test-abc",
    ]);
    expect(ids).toContain(`SST state object ${STATE}/app/notes/test-abc.json`);
    expect(ids.some((i) => i.startsWith(`SST state object ${STATE}/update/notes/test-abc/`))).toBe(true);
    expect(ids).toContain(`iam role ${roleArn(stage)}`);
    expect(ids).toContain(`cloudfront distribution ${routerArn(stage)}`);
    expect(ids.join("\n")).not.toMatch(/test-abcd/);
    expect(listed.databases).toEqual([
      { name: "notes-test-abc-db-1", id: "notes-test-abc-db-1" },
      { name: "postgres", id: "postgres" },
    ]);
    // The tagged lookup ran in the account's region and in us-east-1 (CloudFront).
    const regions = await Promise.all(tagging.commandCalls(GetResourcesCommand).slice(-2).map((c) => (c.thisValue as ResourceGroupsTaggingAPIClient).config.region()));
    expect(regions).toEqual([REGION, "us-east-1"]);
  });

  it("a stage with nothing deployed lists nothing and no databases", async () => {
    const { target } = setup();
    expect(await target.listStageResources(stage)).toEqual({ resources: [], databases: [] });
  });

  it("a failing lookup fails the listing, naming what could not be checked", async () => {
    const { target } = setup();
    world.fail.set("GetFunction", awsError("AccessDeniedException", 403));
    await expect(target.listStageResources(stage)).rejects.toThrow(/checking Lambda function notes-test-abc-http failed: AccessDeniedException \(HTTP 403\)/);
  });
});

describe("AWS removeStage (PROV-REQ-003; provisioning.md §2 Removal)", () => {
  it("[PROV-AC-003] unit part: in order, empties the bucket (every version), deletes the SSM path, sst remove, force-deletes the secret, deletes the state; the other stage stays", async () => {
    const { target } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    expect((await runDeploy(setup().target, request(other), captureIo())).status).toBe(0);
    await target.setSecret(stage, "apiKey", "v-1");
    const bucket = filesBucketName(stage, ACCOUNT);
    for (const k of ["a", "b", "a", "c"]) world.putObject(bucket, k);
    world.deleteCurrent(bucket, "b");
    for (let i = 0; i < 12; i++) world.parameters.set(`/notes/test-abc/config/p${i}`, "x");
    world.log.length = 0;

    const io = captureIo();
    const result = await runRemove(target, stage, io);
    expect(io.err).toBe("");
    expect(result).toEqual({ status: 0, leftovers: [] });
    expect(world.log).toEqual([
      "drop notes-test-abc-db-1",
      "DeleteObjects",
      "DeleteParameters",
      "DeleteParameters",
      "sst remove --stage test-abc",
      // SST removed the secret and purged the state; the fallbacks find nothing, which counts as done.
      "DeleteSecret",
      "DeleteParameter",
    ]);
    expect(secrets.commandCalls(DeleteSecretCommand)[0]?.args[0].input).toEqual({ SecretId: "notes-test-abc-database-credentials", ForceDeleteWithoutRecovery: true });
    expect(world.functions.has(functionName(other))).toBe(true);
    expect(world.buckets.has(filesBucketName(other, ACCOUNT))).toBe(true);
    expect(world.keys(STATE)).toContain("app/notes/test-abcd.json");
    expect(world.parameters.has("/notes/test-abcd/secrets/frameworkSessionKey")).toBe(true);
    expect(world.parameters.has("/sst/bootstrap")).toBe(true);
  });

  it("when sst remove fails, the secret is still force-deleted, SST's state and passphrase are kept for a retry, and what is left is reported", async () => {
    const { target } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    world.sstFail.add("remove");
    world.log.length = 0;
    const io = captureIo();
    const result = await runRemove(target, stage, io);
    expect(result.status).toBe(1);
    expect(world.log.filter((l) => !l.startsWith("drop"))).toEqual(["DeleteParameters", "sst remove --stage test-abc", "DeleteSecret"]);
    expect(world.secretArns.has(databaseSecretName(stage))).toBe(false);
    expect(world.keys(STATE)).toContain("app/notes/test-abc.json");
    expect(world.parameters.has(sstPassphraseParameter(stage))).toBe(true);
    expect(io.err).toMatch(/sst remove --stage test-abc failed \(exit 1\)/);
    expect(io.err).toMatch(/SST state and passphrase were kept/);
    expect(result.leftovers).toContain(`SST state object ${STATE}/app/notes/test-abc.json`);

    // The retry runs SST again and then removes everything.
    world.sstFail.clear();
    expect(await runRemove(target, stage, captureIo())).toEqual({ status: 0, leftovers: [] });
    expect(result.leftovers).toEqual(
      expect.arrayContaining([
        `Lambda function arn:aws:lambda:${REGION}:${ACCOUNT}:function:notes-test-abc-http`,
        `S3 bucket arn:aws:s3:::notes-test-abc-files-${ACCOUNT}`,
        `Aurora cluster arn:aws:rds:${REGION}:${ACCOUNT}:cluster:notes-test-abc`,
      ]),
    );
  });

  it("R3: remove after a failed first deploy (no checkpoint) skips sst remove and deletes the state objects and passphrase", async () => {
    const { target } = setup();
    world.putObject(STATE, "update/notes/test-abc/1.json");
    world.parameters.set(sstPassphraseParameter(stage), "passphrase");
    const result = await runRemove(target, stage, captureIo());
    expect(result).toEqual({ status: 0, leftovers: [] });
    expect(world.sstRuns).toEqual([]);
    expect(world.keys(STATE)).toEqual([]);
  });

  it("R3: when the checkpoint cannot be checked, sst remove still runs and the failure is reported", async () => {
    const { target } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    world.fail.set("HeadObject", awsError("AccessDenied", 403));
    world.sstRuns.length = 0;
    const io = captureIo();
    const result = await runRemove(target, stage, io);
    expect(world.sstRuns).toEqual(["remove --stage test-abc"]);
    expect(result.status).toBe(1);
    expect(result.leftovers).toEqual([]);
    expect(io.err).toMatch(/checking SST's checkpoint app\/notes\/test-abc.json failed: AccessDenied \(HTTP 403\)/);
  });

  it("a failing bucket emptying is reported, and the later steps still run", async () => {
    const { target } = setup();
    expect((await runDeploy(target, request(), captureIo())).status).toBe(0);
    world.putObject(filesBucketName(stage, ACCOUNT), "k");
    world.fail.set("DeleteObjects", awsError("AccessDenied", 403));
    world.log.length = 0;
    const io = captureIo();
    const result = await runRemove(target, stage, io);
    expect(result.status).toBe(1);
    expect(io.err).toMatch(/deleting objects of S3 bucket notes-test-abc-files-123456789012 failed: AccessDenied \(HTTP 403\)/);
    expect(world.log).toContain("sst remove --stage test-abc");
    expect(world.log).toContain("DeleteSecret");
    expect(result.leftovers).toContain(`S3 bucket arn:aws:s3:::notes-test-abc-files-${ACCOUNT}`);
  });

  it("a failing forced secret delete is reported", async () => {
    const { target } = setup();
    world.secretArns.set(databaseSecretName(stage), secretArnOf(stage));
    world.fail.set("DeleteSecret", awsError("InternalServiceError", 500));
    await expect(target.removeStage(stage)).rejects.toThrow(/deleting Secrets Manager secret notes-test-abc-database-credentials failed: InternalServiceError \(HTTP 500\)/);
  });
});

describe("AWS account operations and clients", () => {
  it("preflight, inspectAccount and createSharedResources are G-07's account operations", async () => {
    const calls: string[] = [];
    const account: AwsAccount = {
      ...stubAccount(),
      preflight: async () => (calls.push("preflight"), ["AWS_ACCESS_KEY_ID"]),
      inspectAccount: async () => (calls.push("inspect"), []),
      createSharedResources: async (absent) => void calls.push(`create ${absent.length}`),
    };
    const { target } = setup({ account });
    expect(target.target).toBe("aws");
    expect(target.dialect).toBe("postgres");
    expect(await target.preflight(stage)).toEqual(["AWS_ACCESS_KEY_ID"]);
    expect(await target.inspectAccount()).toEqual([]);
    await target.createSharedResources([{ name: "x", state: "absent" }]);
    expect(calls).toEqual(["preflight", "inspect", "create 1"]);
  });

  it("an account lookup failure fails the operation and is retried on the next call", async () => {
    let fail = true;
    const account: AwsAccount = { ...stubAccount(), region: async () => (fail ? Promise.reject(new Error("STS GetCallerIdentity failed")) : REGION) };
    const { target } = setup({ account });
    await expect(target.listSetSecrets(stage)).rejects.toThrow(/STS GetCallerIdentity failed/);
    fail = false;
    expect(await target.listSetSecrets(stage)).toEqual(new Set());
  });

  it("a failing secret listing names the path", async () => {
    const { target } = setup();
    world.fail.set("GetParametersByPath", awsError("AccessDeniedException", 400));
    await expect(target.listSetSecrets(stage)).rejects.toThrow("listing the SSM parameters under /notes/test-abc/secrets/ failed: AccessDeniedException (HTTP 400)");
  });

  it("the stage clients are in the account's region, the global Tagging API in us-east-1, all with the proxy-aware handler", async () => {
    const c = createAwsStageClients(KEYS, REGION);
    for (const client of [c.s3, c.ssm, c.lambda, c.secrets, c.rds, c.tagging]) expect(await client.config.region()).toBe(REGION);
    expect(await c.globalTagging.config.region()).toBe("us-east-1");
    const same = createAwsStageClients(KEYS, "us-east-1");
    expect(same.globalTagging).toBe(same.tagging);
  });
});

describe("AWS target helpers", () => {
  it("finds the stage of a database name and the kind of an ARN", () => {
    expect(stageOfDatabase("notes-test-abc-db-12")).toEqual(stage);
    expect(() => stageOfDatabase("notes-test-abc")).toThrow(/not a stage database name/);
    expect(kindOfArn(`arn:aws:cloudfront::${ACCOUNT}:distribution/E1`)).toBe("cloudfront distribution");
    expect(kindOfArn(`arn:aws:lambda:${REGION}:${ACCOUNT}:function:f`)).toBe("lambda function");
    expect(kindOfArn("arn:aws:s3:::b")).toBe("S3 bucket");
  });

  it("migrationDatabase works on a clean target: it finds the stage from the database name", async () => {
    const a = setup();
    await a.target.deployInfrastructure({ stage });
    const fresh = setup();
    const db = await fresh.target.createDatabase(stage, "notes-test-abc-db-1");
    await fresh.target.migrationDatabase(db).applyAtomically(migration("app/0001_schema"), 0);
    expect(await setup().target.migrationDatabase(db).recordedIds()).toBeInstanceOf(Set);
    expect(world.log).toContain("migrate notes-test-abc-db-1 app/0001_schema");
  });
});
