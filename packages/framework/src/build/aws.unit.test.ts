/**
 * `build --target aws` (plan-aws G-06; CORE-REQ-006, PROV-REQ-005; aws.md §2): the generated
 * Lambda entry, the Node 22 ESM bundle with the AWS SDK bundled, its inspection, and where it is
 * written (the `FunctionCode` the AWS stage program points the Function at,
 * `provision/aws/sst.ts`). Fixture apps import the framework's sources by absolute path, and the
 * entry imports the AWS runtime from the sources (`runtimeImport`), as in `build.unit.test.ts`.
 *
 * Offline: the network guard refuses any `amazonaws.com` request, and the runnable-bundle test
 * asserts none was attempted. These are local build checks, never AWS evidence (plan-aws §2).
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { createDeployment } from "../core/identity.js";
import { installAwsNetworkGuard } from "../provision/aws/aws-network-guard.test-support.js";
import { sstProgram } from "../provision/aws/sst.js";
import { bundleLambda } from "./bundle.js";
import { inspectBundle, isNodeBuiltin } from "./inspect.js";
import { AWS_BUNDLE_MAX_BYTES, AWS_BUNDLE_RULES, AWS_LAMBDA_CODE, buildApp, entrySource, type BuildOptions, type BuildResult } from "./public.js";

const SRC = dirname(dirname(fileURLToPath(import.meta.url)));
const AWS_RUNTIME = join(SRC, "targets", "aws", "public.ts");

const APP_SOURCE = (body = "", imports = "") => `
import { configString, defineApp, defineTable, id, text } from ${JSON.stringify(join(SRC, "index.ts"))};
${imports}
const notes = defineTable("notes", { id: id(), title: text() });
const app = defineApp({
  name: "awsbuild",
  config: { greeting: configString() },
  secrets: ["apiKey"],
  tables: { notes },
  routes: (api) => {
    api.get("/hello", (c) => c.json({ greeting: c.var.config.get("greeting") }));
    ${body}
  },
});
export default app;
`;

const MARKERS: Record<string, string> = {
  test: "marker-aws-test-json",
  prod: "marker-aws-prod-json",
  prodcheck: "marker-aws-prodcheck-json",
  "mytest-1": "marker-aws-mytest-1-json",
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "g06-build-"));
  dirs.push(dir);
  const all: Record<string, string> = { "src/app.ts": APP_SOURCE(), ...files };
  for (const [file, marker] of Object.entries(MARKERS)) all[`config/aws/${file}.json`] ??= JSON.stringify({ values: { greeting: marker }, framework: {} });
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function options(appDir: string, stage: string, env: Record<string, string | undefined> = {}): BuildOptions {
  return { appDir, target: "aws", stage, runtimeImport: AWS_RUNTIME, env };
}

/** One build per stage, shared by the tests that only read it. */
const built = new Map<string, Promise<BuildResult>>();
function buildOnce(stage: string): Promise<BuildResult> {
  let result = built.get(stage);
  if (result === undefined) {
    result = buildApp(options(fixture(), stage));
    built.set(stage, result);
  }
  return result;
}

const PRODUCTION_STAGES = ["prod", "prodcheck", "mytest-1"];
const STAGES = ["test-g06", ...PRODUCTION_STAGES];

describe("the generated Lambda entry", () => {
  const entry = (stage: string) =>
    entrySource({ deployment: createDeployment({ app: "notes", stage, target: "aws" }), appImport: "../src/app.ts", exportName: "default", configImport: "./config.mjs", runtimeImport: "x/targets/aws" });

  it("a production stage exports `handler` from createAwsLambdaHandler, without the mock", () => {
    const source = entry("prod");
    expect(source).toContain('import { createAwsLambdaHandler } from "x/targets/aws";');
    expect(source).toContain("export const handler = createAwsLambdaHandler(app, config);");
    expect(source).not.toContain("createAuthMock");
    expect(source).not.toMatch(/createCloudflareWorker|createLocalWorker|export default/);
  });

  it("a test stage passes createAuthMock", () => {
    const source = entry("test-g06");
    expect(source).toContain('import { createAuthMock, createAwsLambdaHandler } from "x/targets/aws";');
    expect(source).toContain("export const handler = createAwsLambdaHandler(app, config, { mock: createAuthMock });");
  });
});

describe("buildApp --target aws: output", { timeout: 120_000 }, () => {
  it("writes <app>/.framework/aws/bundle/index.mjs, handler index.handler, as the stage program's FunctionCode expects", async () => {
    const result = await buildOnce("prod");
    const appDir = dirname(dirname(result.outDir));
    expect(result.outDir).toBe(join(appDir, ".framework", "aws"));
    expect(result.lambda).toEqual({ bundle: join(result.outDir, "bundle"), handler: "index.handler" });
    expect(result.bundle).toBe(join(result.outDir, "bundle", "index.mjs"));
    expect(AWS_LAMBDA_CODE).toEqual({ bundleDir: "bundle", file: "index.mjs", handler: "index.handler" });
    // SST zips the whole bundle directory: it holds the bundle only (no entry, config or map).
    expect(readdirSync(result.lambda?.bundle ?? "")).toEqual(["index.mjs"]);
    expect(result.wranglerConfig).toBeUndefined();
    // The handler file is the bundle's root module, as SST's `bundle` option requires.
    const [file, exported] = AWS_LAMBDA_CODE.handler.split(".");
    expect(existsSync(join(result.lambda?.bundle ?? "", `${file ?? ""}.mjs`))).toBe(true);
    expect(exported).toBe("handler");
  });

  it("the stage program takes the build's Lambda code unchanged", async () => {
    const result = await buildOnce("prod");
    const lambda = result.lambda;
    expect(lambda).toBeDefined();
    if (lambda === undefined) return;
    const program = sstProgram({
      stage: { app: result.deployment.app, stage: result.deployment.stage },
      account: { accountId: "123456789012", region: "eu-west-1", network: { subnetIds: ["subnet-0aaa", "subnet-0bbb"], securityGroupId: "sg-0ccc" }, auroraVersion: "17.5" },
      http: {
        database: "awsbuild-prod-db-1",
        databaseSecretArn: "arn:aws:secretsmanager:eu-west-1:123456789012:secret:awsbuild-prod-database-credentials-AbCdEf",
        code: { bundle: lambda.bundle, handler: lambda.handler },
      },
    });
    expect(program).toContain(JSON.stringify(lambda.bundle).slice(1, -1));
    expect(program).toContain('"index.handler"');
  });

  it("bundles the AWS SDK clients the runtime uses (rds-data, ssm; S3 is signed fetch) instead of taking the Lambda runtime's copy", async () => {
    const result = await buildOnce("prod");
    for (const client of ["client-rds-data", "client-ssm"]) expect(result.modules.some((m) => m.includes(`node_modules/@aws-sdk/${client}/`)), client).toBe(true);
    expect(result.modules.some((m) => /node_modules\/@smithy\//.test(m))).toBe(true);
    // Only Node built-ins stay external (esbuild's metafile, through a fresh bundle of the same entry).
    const scratch = mkdtempSync(join(tmpdir(), "g06-externals-"));
    dirs.push(scratch);
    const { externals } = await bundleLambda(result.entry, join(scratch, "index.mjs"));
    expect(externals?.length).toBeGreaterThan(0);
    for (const specifier of externals ?? []) expect(isNodeBuiltin(specifier), specifier).toBe(true);
    // The bundle's own top-level imports are built-ins too.
    const text = readFileSync(result.bundle, "utf8");
    const imports = [...text.matchAll(/(?:^|[;\n])import\s*(?:[^"';]*?from\s*)?["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(isNodeBuiltin(specifier), specifier).toBe(true);
  });

  it("the bundle is within the size bound", async () => {
    const result = await buildOnce("prod");
    expect(statSync(result.bundle).size).toBeLessThanOrEqual(AWS_BUNDLE_MAX_BYTES);
  });

  it("the bundle runs in Node and answers app routes and JSON 404s through the Function URL handler", async () => {
    const result = await buildOnce("prod");
    const guard = installAwsNetworkGuard();
    vi.stubEnv("AWS_REGION", "eu-west-1");
    vi.stubEnv("FRAMEWORK_PUBLIC_ORIGIN", "https://d111111abcdef8.cloudfront.net");
    // Read when the request's services are built; no route here sends a Data API request.
    vi.stubEnv("FRAMEWORK_DATABASE_CLUSTER_ARN", "arn:aws:rds:eu-west-1:123456789012:cluster:awsbuild-prod");
    vi.stubEnv("FRAMEWORK_DATABASE_SECRET_ARN", "arn:aws:secretsmanager:eu-west-1:123456789012:secret:awsbuild-prod-database-credentials-AbCdEf");
    vi.stubEnv("FRAMEWORK_DATABASE", "awsbuild-prod-db-1");
    try {
      const module = (await import(`${pathToFileURL(result.bundle).href}?t=${String(Date.now())}`)) as { handler: (event: unknown, context: unknown) => Promise<{ statusCode: number; body: string }> };
      const hello = await module.handler(functionUrlEvent("/api/hello"), {});
      expect(hello.statusCode).toBe(200);
      expect(JSON.parse(hello.body)).toEqual({ greeting: "marker-aws-prod-json" });
      const missing = await module.handler(functionUrlEvent("/api/nope"), {});
      expect(missing.statusCode).toBe(404);
      expect((JSON.parse(missing.body) as { error: { code: string } }).error.code).toBe("HTTP.NOT_FOUND");
    } finally {
      vi.unstubAllEnvs();
      guard.uninstall();
    }
    expect(guard.attempts).toEqual([]);
  });
});

describe("buildApp --target aws: test and production stages (PROV-REQ-005)", { timeout: 120_000 }, () => {
  it(tag("PROV-AC-005", "build part (aws): a test-<id> stage reads config/aws/test.json and includes the mock"), async () => {
    const result = await buildOnce("test-g06");
    expect(result.deployment).toMatchObject({ stage: "test-g06", target: "aws", isTestStage: true });
    const text = readFileSync(result.bundle, "utf8");
    expect(text).toContain("__framework/health");
    expect(text).toContain(MARKERS.test);
    for (const [file, marker] of Object.entries(MARKERS)) if (file !== "test") expect(text).not.toContain(marker);
    expect(text).toContain("mock-login");
    expect(result.modules.some((m) => m.endsWith("auth/mock.ts"))).toBe(true);
  });

  for (const stage of PRODUCTION_STAGES) {
    it(tag("PROV-AC-005", `build part (aws): production stage "${stage}" reads config/aws/${stage}.json and has no mock or mock-login route`), async () => {
      const result = await buildOnce(stage);
      expect(result.deployment.isTestStage).toBe(false);
      const text = readFileSync(result.bundle, "utf8");
      expect(text).toContain("__framework/health");
      expect(text).toContain(MARKERS[stage]);
      for (const [file, marker] of Object.entries(MARKERS)) if (file !== stage) expect(text).not.toContain(marker);
      expect(text).not.toContain("mock-login");
      expect(result.modules.some((m) => m.endsWith("auth/mock.ts"))).toBe(false);
    });
  }

  it("a production stage without its own values file fails naming the file, even with test.json present (CFG-REQ-002)", async () => {
    const dir = fixture();
    rmSync(join(dir, "config", "aws", "prod.json"));
    await expect(buildApp(options(dir, "prod"))).rejects.toThrow(/config\/aws\/prod\.json/);
    expect(existsSync(join(dir, ".framework", "aws"))).toBe(false);
  });
});

describe("buildApp --target aws: clean runtime bundle (CORE-REQ-006)", { timeout: 120_000 }, () => {
  for (const stage of ["test-g06", "prod"]) {
    it(
      tag(
        "CORE-AC-006",
        `AWS bundle part, stage "${stage}": no Cloudflare-only module; no provisioning, CLI-only SDK client, Postgres harness, stub login provider, local file-transfer route or its ticket key${stage === "prod" ? "; no mock" : ""}`,
      ),
      async () => {
        const result = await buildOnce(stage);
        const text = readFileSync(result.bundle, "utf8");
        // Positive controls: this is the app's Lambda bundle, framework included.
        expect(text).toContain("__framework/health");
        expect(result.modules.some((m) => m.endsWith("targets/aws/handler.ts"))).toBe(true);
        expect(result.modules.some((m) => m.endsWith("targets/stage.ts"))).toBe(true);
        // No module under a cloudflare/ directory, Wrangler or Miniflare.
        for (const module of result.modules) {
          expect(module).not.toMatch(/(?:^|\/)cloudflare\//);
          expect(module).not.toMatch(/node_modules\/(?:wrangler|miniflare|@cloudflare\/)/);
          expect(module).not.toMatch(/\/provision\/|node_modules\/(?:sst|@pulumi)\//);
          expect(module).not.toMatch(/@aws-sdk\/client-(?:ec2|iam|rds|sts|secrets-manager|lambda|resource-groups-tagging-api)\//);
          expect(module).not.toMatch(/pglite|electric-sql|sql\/postgres\.|auth\/stub-provider|files\/local\/|\/testing\//);
          if (stage === "prod") expect(module).not.toMatch(/auth\/mock\./);
        }
        expect(text).not.toMatch(/(?:from\s*|import\(\s*)["']cloudflare:/);
        expect(text).not.toMatch(/__framework\/files/);
        expect(text).not.toMatch(/stubLoginProvider|loginWithStub|stubFailure/);
        expect(text).not.toMatch(/ticket[_-]?key/i);
      },
    );
  }

  it(tag("CORE-AC-006", "AWS bundle part: the build fails when app code pulls a Cloudflare-only module into the Lambda bundle"), async () => {
    const dir = fixture({
      "src/app.ts": APP_SOURCE('api.get("/binding", (c) => c.json({ binding: BINDINGS.database }));', `import { BINDINGS } from ${JSON.stringify(join(SRC, "targets", "cloudflare", "bindings.ts"))};`),
    });
    const failure = await buildApp(options(dir, "prod")).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(FrameworkError);
    expect((failure as FrameworkError).code).toBe("CORE.MISCONFIGURED");
    expect((failure as Error).message).toMatch(/Cloudflare-only module: module .*targets\/cloudflare\/bindings\.ts/);
    // A failed inspection leaves no deployable bundle behind.
    expect(existsSync(join(dir, ".framework", "aws", "bundle"))).toBe(false);
  });

  it(tag("CORE-AC-006", "AWS bundle part: the build fails when app code pulls provisioning or a CLI-only AWS SDK client into the Lambda bundle"), async () => {
    const dir = fixture({
      "src/app.ts": APP_SOURCE(
        'api.get("/who", async (c) => c.json({ who: await checkCredentials({}, { send: async () => ({}) } as never) }));',
        `import { checkCredentials } from ${JSON.stringify(join(SRC, "provision", "aws", "environment.ts"))};`,
      ),
    });
    await expect(buildApp(options(dir, "prod"))).rejects.toThrow(/provisioning: module .*provision\/aws\/environment\.ts.*CLI-only AWS SDK client: module .*@aws-sdk\/client-sts\//);
  });

  it("the build fails, without printing it, when a secret value the build can see is compiled into the bundle", async () => {
    const value = "s3cr3t-value-for-g06-inspection";
    const dir = fixture({ "src/app.ts": APP_SOURCE(`api.get("/leak", (c) => c.json({ v: ${JSON.stringify(value)} }));`) });
    const fromEnv = await buildApp(options(dir, "prod", { SECRET_API_KEY: value })).catch((e: unknown) => e);
    expect((fromEnv as Error).message).toMatch(/secret values: 1 secret value\(s\) visible to the build appear in the bundle/);
    expect((fromEnv as Error).message).not.toContain(value);
    writeFileSync(join(dir, ".dev.vars"), `SECRET_API_KEY=${value}\n`);
    await expect(buildApp(options(dir, "prod"))).rejects.toThrow(/secret values: 1 secret value/);
    await expect(buildApp(options(dir, "prod", { AWS_SECRET_ACCESS_KEY: value }))).rejects.toThrow(/secret values/);
  });

  it("positive control: the same app's Cloudflare bundle fails the AWS rules as Cloudflare-only, so the rules see real Workers code", async () => {
    const dir = fixture({ "config/cloudflare/prod.json": JSON.stringify({ values: { greeting: "marker-cf-prod-json" }, framework: {} }) });
    const result = await buildApp({ appDir: dir, target: "cloudflare", stage: "prod", runtimeImport: join(SRC, "targets", "cloudflare", "public.ts") });
    const violations = inspectBundle({ text: readFileSync(result.bundle, "utf8"), bytes: statSync(result.bundle).size, modules: result.modules, production: true, secretValues: [] });
    expect(violations.some((v) => /^Cloudflare-only module: module .*targets\/cloudflare\/public\.ts$/.test(v))).toBe(true);
  });

  it("the rules name every forbidden kind CORE-REQ-006 lists for the AWS bundle", () => {
    expect(AWS_BUNDLE_RULES.map((r) => r.what)).toEqual([
      "Cloudflare-only module",
      "provisioning",
      "CLI-only AWS SDK client",
      "Postgres harness",
      "stub login provider or test helpers",
      "local file-transfer route or its ticket key",
      "tooling",
      "authentication mock",
    ]);
  });
});

/** A Function URL (payload 2.0) event, as AWS documents it. */
function functionUrlEvent(path: string): unknown {
  const host = "abcdefghij.lambda-url.eu-west-1.on.aws";
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: { host, "x-forwarded-proto": "https" },
    isBase64Encoded: false,
    requestContext: {
      accountId: "anonymous",
      apiId: "abcdefghij",
      domainName: host,
      domainPrefix: "abcdefghij",
      http: { method: "GET", path, protocol: "HTTP/1.1", sourceIp: "203.0.113.7", userAgent: "g06" },
      requestId: "c6af9ac6-7b61-11e6-9a41-93e8deadbeef",
      routeKey: "$default",
      stage: "$default",
      time: "24/Oct/2026:12:00:00 +0000",
      timeEpoch: 1792843200000,
    },
  };
}
