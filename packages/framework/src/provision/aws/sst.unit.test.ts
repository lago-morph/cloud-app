import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { awsLambdaSettings, LAMBDA_RUNTIME_VARIABLES, LAMBDA_VARIABLES as RUNTIME_VARIABLES } from "../../targets/aws/settings.js";
import { functionName } from "./names.js";
import { functionPermissions, infrastructureDeploy, runSst, sstProgram, stageOutputs, writeSstApp, type SstExec, type SstInput } from "./sst.js";

const stage = { app: "notes", stage: "test-abc" };
const account = { accountId: "123456789012", region: "us-east-1", network: { subnetIds: ["subnet-0aaa", "subnet-0bbb"], securityGroupId: "sg-0ccc" }, auroraVersion: "17.5" };
const secretArn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:notes-test-abc-database-credentials-AbCdEf";
const code = { bundle: "/app/.framework/aws/bundle", handler: "index.handler", assetsDirectory: "/app/dist/client", variables: { FRAMEWORK_DEPLOYMENT: "notes/test-abc" } };
const http = { database: "notes-test-abc-db-1", databaseSecretArn: secretArn, code };
const full: SstInput = { stage, account, http };
const infrastructureOnly: SstInput = { stage, account };

type Args = Record<string, unknown>;
interface Recorded {
  readonly type: string;
  readonly name: string;
  readonly args: Args;
  /** Each `transform.<key>` applied to an empty argument object. */
  readonly transformed: Record<string, Args>;
}
/** A stand-in for a Pulumi Output: which component property it came from. */
interface OutputRef {
  readonly output: string;
}
const isOutput = (v: unknown): v is OutputRef => typeof v === "object" && v !== null && "output" in v;

/**
 * Runs the generated `sst.config.ts` against stand-ins for SST's globals, the way SST evaluates
 * it, and records the app settings, each component's arguments (component outputs appear as
 * `{ output: "<Component>.<property>" }`), its transforms' results, and the global transforms.
 */
function evaluate(source: string) {
  const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const components: Recorded[] = [];
  const component = (type: string) =>
    function (this: object, name: string, args: Args = {}) {
      const transformed: Record<string, Args> = {};
      for (const [key, f] of Object.entries((args.transform as Record<string, (a: Args) => void> | undefined) ?? {})) {
        const a: Args = {};
        f(a);
        transformed[key] = a;
      }
      components.push({ type, name, args, transformed });
      return new Proxy(this, { get: (_t, property) => ({ output: `${name}.${String(property)}` }) });
    };
  const sst = { aws: Object.fromEntries(["Bucket", "Aurora", "Router", "StaticSite", "Function"].map((t) => [t, component(t)])) };
  const aws = {
    secretsmanager: { Secret: "aws.secretsmanager.Secret" },
    iam: { assumeRolePolicyForPrincipal: (principal: unknown) => ({ trust: principal }) },
  };
  const globalTransforms: { resource: unknown; f: (args: Args, opts: unknown, name: string) => void }[] = [];
  const $transform = (resource: unknown, f: (args: Args, opts: unknown, name: string) => void) => globalTransforms.push({ resource, f });
  let config: { app(input: unknown): unknown; run(): Promise<Record<string, unknown>> } | undefined;
  const $config = (c: typeof config) => (config = c);
  const module = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "$config", "$transform", "sst", "aws", js)(module, module.exports, $config, $transform, sst, aws);
  return { config: config!, components, globalTransforms };
}

/** Every Output reference anywhere inside `value`. */
function outputsIn(value: unknown): string[] {
  if (isOutput(value)) return [value.output];
  if (Array.isArray(value)) return value.flatMap(outputsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(outputsIn);
  return [];
}

async function run(input: SstInput) {
  const e = evaluate(sstProgram(input));
  const outputs = await e.config.run();
  const byName = (name: string) => {
    const c = e.components.find((x) => x.name === name);
    if (!c) throw new Error(`no component ${name}`);
    return c;
  };
  return { ...e, outputs, byName };
}

describe("the SST app of an AWS stage, built from the app definition (PROV-REQ-001; aws.md §2; DEC-0438)", () => {
  it("has SST's settings: app name, never retains resources, state home on AWS with purge, the pinned provider in the account's region", () => {
    const { config } = evaluate(sstProgram(full));
    expect(config.app({ stage: "test-abc" })).toEqual({
      name: "notes",
      removal: "remove",
      home: "aws",
      state: { purge: true },
      providers: { aws: { version: "7.20.0", region: "us-east-1" } },
    });
  });

  it("[AWS-AC-001] declares Files, Database, Router, Site and Http, in that order, with no link anywhere", async () => {
    const { components } = await run(full);
    expect(components.map((c) => `${c.type} ${c.name}`)).toEqual(["Bucket Files", "Aurora Database", "Router Router", "StaticSite Site", "Function Http"]);
    for (const c of components) expect(c.args).not.toHaveProperty("link");
  });

  it("the files bucket has its fixed name, no CORS rule by default, and SST's default (blocked) public access", async () => {
    const { byName } = await run(full);
    const files = byName("Files");
    expect(files.transformed.bucket).toEqual({ bucket: "notes-test-abc-files-123456789012" });
    expect(files.args.cors).toBe(false);
    expect(files.args).not.toHaveProperty("access");
    const cors = { allowOrigins: ["https://d1.cloudfront.net"], allowMethods: ["GET", "PUT"] as const, allowHeaders: ["content-type"], exposeHeaders: ["ETag"], maxAge: "300 seconds" as const };
    const withCors = await run({ ...full, filesCors: { ...cors, allowMethods: [...cors.allowMethods] } });
    expect(withCors.byName("Files").args.cors).toEqual({ ...cors, allowMethods: ["GET", "PUT"] });
  });

  it("the cluster: Postgres PAR-110 with the Data API, 0–4 ACU pausing after 5 minutes, in the shared network, fixed identifier, no final snapshot", async () => {
    const { byName } = await run(full);
    const db = byName("Database");
    expect(db.args).toMatchObject({
      engine: "postgres",
      version: "17.5",
      dataApi: true,
      scaling: { min: "0 ACU", max: "4 ACU", pauseAfter: "5 minutes" },
      vpc: { subnets: ["subnet-0aaa", "subnet-0bbb"], securityGroups: ["sg-0ccc"] },
    });
    expect(db.transformed.cluster).toEqual({ clusterIdentifier: "notes-test-abc", skipFinalSnapshot: true, deletionProtection: false });
  });

  it("names SST's credentials secret by a global transform, and only that secret (DEC-0441)", async () => {
    const { globalTransforms } = await run(full);
    expect(globalTransforms.map((t) => t.resource)).toEqual(["aws.secretsmanager.Secret"]);
    const mine: Args = {};
    globalTransforms[0]!.f(mine, {}, "DatabaseProxySecret");
    expect(mine).toEqual({ name: "notes-test-abc-database-credentials" });
    const other: Args = {};
    globalTransforms[0]!.f(other, {}, "SomethingElse");
    expect(other).toEqual({});
  });

  it("[AWS-AC-002, AWS-AC-005] the Function: fixed name, nodejs22.x on arm64 set explicitly, 1024 MB, PAR-270 timeout, no VPC, URL without CORS routed at /api with PAR-271", async () => {
    const { byName } = await run(full);
    const fn = byName("Http");
    expect(fn.args).toMatchObject({
      name: functionName(stage),
      bundle: code.bundle,
      handler: "index.handler",
      runtime: "nodejs22.x",
      architecture: "arm64",
      memory: "1024 MB",
      timeout: "55 seconds",
    });
    expect(fn.args).not.toHaveProperty("vpc");
    const url = fn.args.url as { cors: unknown; router: { instance: unknown; path: string; readTimeout: string } };
    expect(url.cors).toBe(false);
    expect(url.router.path).toBe("/api");
    expect(url.router.readTimeout).toBe("60 seconds");
    expect(isOutput(url.router.instance) || typeof url.router.instance === "object").toBe(true);
    const seconds = (s: string) => Number(s.split(" ")[0]);
    expect(seconds(url.router.readTimeout)).toBeGreaterThan(seconds(fn.args.timeout as string));
    expect(seconds(fn.args.timeout as string)).toBeGreaterThan(45 + 2); // PAR-210 + PAR-260 (AWS-REQ-005)
  });

  it("the Function's role trusts Lambda only (DEC-0443)", async () => {
    const { byName } = await run(full);
    expect(byName("Http").transformed.role).toEqual({ assumeRolePolicy: { trust: { Service: "lambda.amazonaws.com" } } });
  });

  it("the Function's environment: the framework variables, the stage's database, cluster, secret, buckets and account, and router.url as the public origin", async () => {
    const { byName } = await run(full);
    expect(byName("Http").args.environment).toEqual({
      FRAMEWORK_DEPLOYMENT: "notes/test-abc",
      FRAMEWORK_DATABASE: "notes-test-abc-db-1",
      FRAMEWORK_DATABASE_CLUSTER_ARN: "arn:aws:rds:us-east-1:123456789012:cluster:notes-test-abc",
      FRAMEWORK_DATABASE_SECRET_ARN: secretArn,
      FRAMEWORK_FILES_BUCKET: "notes-test-abc-files-123456789012",
      FRAMEWORK_LOG_BUCKET: "prototype-logs-123456789012",
      FRAMEWORK_ACCOUNT_ID: "123456789012",
      FRAMEWORK_PUBLIC_ORIGIN: { output: "Router.url" },
    });
  });

  it("the framework variables the program sets are exactly the ones the AWS runtime reads (DEC-0469)", async () => {
    const { byName } = await run(full);
    const environment = byName("Http").args.environment as Record<string, unknown>;
    const set = Object.keys(environment).filter((name) => !(name in code.variables)).sort();
    // Every variable the runtime's settings reader asks for, through each of its getters.
    const read = new Set<string>();
    const env = new Proxy({} as Record<string, string | undefined>, {
      get: (_t, name) => {
        if (typeof name === "string") read.add(name);
        return typeof name === "string" && name.startsWith("AWS_") ? "x" : `value-of-${String(name)}`;
      },
    });
    const settings = awsLambdaSettings(env);
    void [settings.region, settings.accountId, settings.publicOrigin, settings.filesBucket, settings.database, settings.credentials, settings.logBucket];
    const runtimeOwn = new Set<string>(Object.values(LAMBDA_RUNTIME_VARIABLES));
    expect([...read].filter((name) => !runtimeOwn.has(name)).sort()).toEqual(set);
    expect(set).toEqual(Object.values(RUNTIME_VARIABLES).sort());
    // And the runtime reads the program's values back as the stage's.
    const deployed = awsLambdaSettings({ ...environment, FRAMEWORK_PUBLIC_ORIGIN: "https://d111.cloudfront.net" } as Record<string, string>);
    expect(deployed.database).toEqual({ clusterArn: "arn:aws:rds:us-east-1:123456789012:cluster:notes-test-abc", secretArn, name: "notes-test-abc-db-1" });
    expect(deployed.filesBucket).toBe("notes-test-abc-files-123456789012");
    expect(deployed.accountId).toBe("123456789012");
  });

  it("serves the prebuilt client on the router; without a client there is no Site", async () => {
    const { byName } = await run(full);
    expect(byName("Site").args).toEqual({ path: "/app/dist/client", router: { instance: expect.anything() } });
    const { assetsDirectory: _client, ...withoutClient } = code;
    const noClient = await run({ ...full, http: { ...http, code: withoutClient } });
    expect(noClient.components.map((c) => c.name)).toEqual(["Files", "Database", "Router", "Http"]);
  });

  it("step 3 safety: nothing under Router, Site or Http takes an output of Files or Database; the only output the Function takes is router.url (DEC-0440)", async () => {
    const { components } = await run(full);
    for (const c of components.filter((x) => ["Router", "Site", "Http"].includes(x.name))) {
      const refs = [...outputsIn(c.args), ...outputsIn(c.transformed)];
      expect(refs.filter((r) => r.startsWith("Files.") || r.startsWith("Database.")), c.name).toEqual([]);
    }
    expect(outputsIn(components.find((c) => c.name === "Http")!.args)).toEqual(["Router.url"]);
  });

  it("returns the outputs step 3 reads back: the secret ARN and cluster ARN; with the Function also the router and Function URLs", async () => {
    expect((await run(full)).outputs).toEqual({
      databaseSecretArn: { output: "Database.secretArn" },
      clusterArn: { output: "Database.clusterArn" },
      url: { output: "Router.url" },
      functionUrl: { output: "Http.url" },
    });
    expect((await run(infrastructureOnly)).outputs).toEqual({ databaseSecretArn: { output: "Database.secretArn" }, clusterArn: { output: "Database.clusterArn" } });
  });

  it("without the Function (step 3 of a first deploy; remove) declares only Files and Database", async () => {
    const { components } = await run(infrastructureOnly);
    expect(components.map((c) => c.name)).toEqual(["Files", "Database"]);
  });

  it("refuses SECRET_*, runtime-reserved and framework-set variable names, a foreign secret ARN, and an invalid cluster identifier", () => {
    const withVariables = (variables: Record<string, string>): SstInput => ({ ...full, http: { ...http, code: { ...code, variables } } });
    expect(() => sstProgram(withVariables({ SECRET_API_KEY: "x" }))).toThrow(/SECRET_API_KEY.*SSM parameters/);
    expect(() => sstProgram(withVariables({ AWS_REGION: "x" }))).toThrow(/AWS_REGION.*reserves/);
    expect(() => sstProgram(withVariables({ SST_KEY: "x" }))).toThrow(/SST_KEY/);
    expect(() => sstProgram(withVariables({ FRAMEWORK_PUBLIC_ORIGIN: "x" }))).toThrow(/set by the stage program/);
    for (const arn of [
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:notes-other-database-credentials-AbCdEf",
      "arn:aws:secretsmanager:us-east-1:999999999999:secret:notes-test-abc-database-credentials-AbCdEf",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:notes-test-abc-database-credentials-*",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:*",
    ]) {
      expect(() => sstProgram({ ...full, http: { ...http, databaseSecretArn: arn } }), arn).toThrow(/is not the stage's secret/);
    }
    for (const bad of ["test--abc", "test-abc-"]) expect(() => sstProgram({ ...full, stage: { app: "notes", stage: bad } }), bad).toThrow(/cluster identifier/);
    expect(() => sstProgram({ ...full, stage: { app: "1notes", stage: "s" } })).toThrow(/start with a letter/);
    expect(() => sstProgram({ ...full, account: { ...account, network: { subnetIds: [], securityGroupId: "sg-0ccc" } } })).toThrow(/shared network/);
  });

  it("a variable that is not a literal-safe string is embedded as JSON, never as code", async () => {
    const { byName } = await run({ ...full, http: { ...http, code: { ...code, variables: { X: '"; process.exit(1); "`${x}`' } } } });
    expect((byName("Http").args.environment as Record<string, unknown>).X).toBe('"; process.exit(1); "`${x}`');
  });
});

describe("the Function's IAM statements (AWS-REQ-003; AWS-AC-003 and SEC-AC-003, offline part)", () => {
  const statements = functionPermissions({ stage, account }, secretArn);

  it("name exact ARNs: the cluster, the credentials secret, the stage bucket's objects, the stage's log prefix (put only) and its SSM secrets path", () => {
    expect(statements).toEqual([
      {
        actions: ["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement", "rds-data:BeginTransaction", "rds-data:CommitTransaction", "rds-data:RollbackTransaction"],
        resources: ["arn:aws:rds:us-east-1:123456789012:cluster:notes-test-abc"],
      },
      { actions: ["secretsmanager:GetSecretValue"], resources: [secretArn] },
      { actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], resources: ["arn:aws:s3:::notes-test-abc-files-123456789012/*"] },
      { actions: ["s3:ListBucket"], resources: ["arn:aws:s3:::notes-test-abc-files-123456789012"] },
      { actions: ["s3:PutObject"], resources: ["arn:aws:s3:::prototype-logs-123456789012/notes/test-abc/*"] },
      { actions: ["ssm:GetParameter"], resources: ["arn:aws:ssm:us-east-1:123456789012:parameter/notes/test-abc/secrets/*"] },
    ]);
  });

  it("no action wildcard, no resource wildcard outside an object-key or parameter-path position, and every resource is the stage's", () => {
    for (const s of statements) {
      for (const a of s.actions) expect(a).not.toContain("*");
      for (const r of s.resources) {
        expect(r.indexOf("*") === -1 || (r.endsWith("/*") && r.indexOf("*") === r.length - 1), r).toBe(true);
        expect(r.includes("notes-test-abc") || r.includes("/notes/test-abc/"), r).toBe(true);
      }
    }
  });

  it("the log bucket can only be put to: no statement grants a read, list or delete on it", () => {
    const onLogs = statements.filter((s) => s.resources.some((r) => r.includes("prototype-logs-")));
    expect(onLogs).toEqual([{ actions: ["s3:PutObject"], resources: ["arn:aws:s3:::prototype-logs-123456789012/notes/test-abc/*"] }]);
  });

  it("the program embeds exactly these statements on the Function", async () => {
    const { byName } = await run(full);
    expect(byName("Http").args.permissions).toEqual(statements);
  });
});

describe("step 3 on AWS (DEC-0440; root cause 2026-10-23-pass1)", () => {
  it("a stage without a database (first deploy): the program without the Function, untargeted", async () => {
    const plan = infrastructureDeploy(full, false);
    expect(plan.target).toBeUndefined();
    expect(plan.input.http).toBeUndefined();
    expect((await run(plan.input)).components.map((c) => c.name)).toEqual(["Files", "Database"]);
  });

  it("a stage with a database: the full program, targeted at Files and Database", () => {
    expect(infrastructureDeploy(full, true)).toEqual({ input: full, target: "Files,Database" });
  });

  it("a stage with a database but no built code is refused before any SST run", () => {
    expect(() => infrastructureDeploy(infrastructureOnly, true)).toThrow(/no built Function code/);
  });
});

describe("running SST on AWS", () => {
  const exec = (code = 0, output = "✓ Complete"): SstExec & { calls: { args: readonly string[]; cwd: string; env: Record<string, string> }[] } => {
    const calls: { args: readonly string[]; cwd: string; env: Record<string, string> }[] = [];
    const f: SstExec = async (args, options) => {
      calls.push({ args, cwd: options.cwd, env: options.env });
      return { code, output };
    };
    return Object.assign(f, { calls });
  };

  it("writes the app into its own directory with a package.json", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "sst-aws-")), "sst");
    writeSstApp(dir, full);
    expect(readFileSync(join(dir, "sst.config.ts"), "utf8")).toBe(sstProgram(full));
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))).toEqual({ name: "notes-sst", private: true, type: "module" });
  });

  it("installs SST's platform once, then runs the command in the account's region with the SST environment and an optional target", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sst-aws-"));
    const e = exec();
    await runSst(e, { dir, env: { AWS_ACCESS_KEY_ID: "placeholder", AWS_REGION: "eu-west-1" }, stage, region: "us-east-1" }, "deploy", { target: "Files,Database" });
    expect(e.calls.map((c) => c.args)).toEqual([
      ["install", "--stage", "test-abc"],
      ["deploy", "--stage", "test-abc", "--target", "Files,Database"],
    ]);
    expect(e.calls[1]!.cwd).toBe(dir);
    expect(e.calls[1]!.env).toMatchObject({ AWS_REGION: "us-east-1", NODE_USE_ENV_PROXY: "1", AWS_ACCESS_KEY_ID: "placeholder" });

    mkdirSync(join(dir, ".sst", "platform"), { recursive: true });
    const again = exec();
    await runSst(again, { dir, env: {}, stage, region: "us-east-1" }, "remove");
    expect(again.calls.map((c) => c.args)).toEqual([["remove", "--stage", "test-abc"]]);
  });

  it("a failing SST run throws with the command and the end of its output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sst-aws-"));
    mkdirSync(join(dir, ".sst", "platform"), { recursive: true });
    await expect(runSst(exec(1, "a\n✕  Target not found: Files"), { dir, env: {}, stage, region: "us-east-1" }, "deploy", { target: "Files,Database" })).rejects.toThrow(
      /sst deploy --stage test-abc --target Files,Database failed \(exit 1\):[\s\S]*Target not found/,
    );
  });

  it("reads step 3's outputs back and checks they are the stage's", () => {
    const dir = mkdtempSync(join(tmpdir(), "sst-aws-"));
    expect(() => stageOutputs(dir, { stage, account })).toThrow(/wrote no outputs/);
    mkdirSync(join(dir, ".sst"), { recursive: true });
    const write = (o: object) => writeFileSync(join(dir, ".sst", "outputs.json"), JSON.stringify(o));
    write({ databaseSecretArn: secretArn, clusterArn: "arn:aws:rds:us-east-1:123456789012:cluster:notes-test-abc" });
    expect(stageOutputs(dir, { stage, account })).toEqual({ databaseSecretArn: secretArn, clusterArn: "arn:aws:rds:us-east-1:123456789012:cluster:notes-test-abc" });
    write({ databaseSecretArn: secretArn, clusterArn: "arn:aws:rds:us-east-1:123456789012:cluster:notes-test-abc", url: "https://d1.cloudfront.net", functionUrl: "https://x.lambda-url.us-east-1.on.aws/" });
    expect(stageOutputs(dir, { stage, account }).url).toBe("https://d1.cloudfront.net");
    write({ databaseSecretArn: secretArn, clusterArn: "arn:aws:rds:us-east-1:123456789012:cluster:other" });
    expect(() => stageOutputs(dir, { stage, account })).toThrow(/not the stage's cluster/);
    write({ clusterArn: "x" });
    expect(() => stageOutputs(dir, { stage, account })).toThrow(/no databaseSecretArn/);
  });
});

// ---------------------------------------------------------------------------------------------
// Type-check of the generated programs against SST 4.17.2's platform types (as G-S2 did)
// ---------------------------------------------------------------------------------------------

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** A cached SST 4.17.2 platform with @pulumi/aws 7.20.0, if this machine has one. */
function cachedPlatform(): string | undefined {
  const candidates: string[] = [];
  if (process.env.PROTOTYPE_SST_PLATFORM) candidates.push(process.env.PROTOTYPE_SST_PLATFORM);
  const apps = join(repoRoot, "apps");
  for (const app of existsSync(apps) ? readdirSync(apps) : []) {
    for (const target of ["aws", "cloudflare"]) candidates.push(join(apps, app, ".framework", "provision", target, ".sst", "platform"));
  }
  return candidates.find((dir) => {
    try {
      return (
        readFileSync(join(dir, "version"), "utf8").trim() === "4.17.2" &&
        (JSON.parse(readFileSync(join(dir, "node_modules/@pulumi/aws/package.json"), "utf8")) as { version: string }).version === "7.20.0"
      );
    } catch {
      return false;
    }
  });
}

/** `config.d.ts` as `sst install` writes it for `providers: { aws }` (G-S2 setup-platform.mjs). */
const AWS_CONFIG_D_TS = `import "./src/global.d.ts"
import "../types.generated"
import { AppInput, App, Config } from "./src/config"
import * as _aws from "@pulumi/aws";


declare global {
  // @ts-expect-error
  export import aws = _aws
  interface Providers {
    providers?: {
      "aws"?:  (_aws.ProviderArgs & { package?: string, version: string }) | string;
    }
  }
  export const $config: (
    input: Omit<Config, "app"> & {
      app(input: AppInput): Promise<Omit<App, "providers"> & Providers> | (Omit<App, "providers"> & Providers);
    },
  ) => Config;
}
`;

/** Writes each program into its own SST app directory over a view of the cached platform and runs strict `tsc` over them. */
function typecheck(platform: string, programs: Record<string, string>): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), "sst-aws-typecheck-"));
  const view = join(root, "platform");
  mkdirSync(view);
  for (const entry of readdirSync(platform)) {
    if (entry === "config.d.ts" || entry.startsWith("sst.config.")) continue;
    symlinkSync(join(platform, entry), join(view, entry));
  }
  writeFileSync(join(view, "config.d.ts"), AWS_CONFIG_D_TS);
  const files: string[] = [];
  for (const [name, source] of Object.entries(programs)) {
    mkdirSync(join(root, name, ".sst"), { recursive: true });
    symlinkSync(view, join(root, name, ".sst", "platform"));
    writeFileSync(join(root, name, "sst.config.ts"), source);
    files.push(`${name}/sst.config.ts`);
  }
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, isolatedModules: true, types: [], typeRoots: [join(view, "node_modules/@types")] },
      files,
    }),
  );
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  const r = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.json")], { encoding: "utf8" });
  return { status: r.status, output: `${r.stdout}${r.stderr}` };
}

const platform = cachedPlatform();

// The platform is installed by `sst install` (npm registry) and is not part of the repository: set
// PROTOTYPE_SST_PLATFORM to a cached `.sst/platform`, or run a deploy once. Without one, this is skipped.
describe.skipIf(platform === undefined)("the generated programs type-check against SST 4.17.2's platform types (G-S2 §1)", () => {
  it("the full program, the step-3 program and the program with a CORS rule type-check strictly; a broken program does not", () => {
    const cors = { allowOrigins: ["https://d1.cloudfront.net"], allowMethods: ["GET" as const, "PUT" as const], allowHeaders: ["content-type"], exposeHeaders: ["ETag"], maxAge: "300 seconds" as const };
    const good = typecheck(platform!, { full: sstProgram(full), step3: sstProgram(infrastructureOnly), cors: sstProgram({ ...full, filesCors: cors }) });
    expect(good.output).toBe("");
    expect(good.status).toBe(0);

    const broken = sstProgram(full)
      .replace('runtime: "nodejs22.x";', 'runtime: "nodejs23.x";')
      .replace('engine: "postgres",', 'engine: "postgresql",');
    const bad = typecheck(platform!, { broken });
    expect(bad.status).not.toBe(0);
    expect(bad.output).toMatch(/nodejs23\.x/);
    expect(bad.output).toMatch(/"postgresql"/);
  }, 120_000);
});
