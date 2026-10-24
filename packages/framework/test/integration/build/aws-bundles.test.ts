/**
 * Bundle inspection of `npx <package> build --target aws --stage <s>` (CORE-REQ-006 AWS-bundle
 * clause, PROV-REQ-005 for aws; plan-aws G-06). It mirrors `cloudflare-bundles.test.ts`: the
 * inspected output is every file the build writes under `.framework/` (cli.md §2), and modules
 * are recognised by strings that survive bundling and minification (DEC-0240). Nothing is
 * deployed and no AWS endpoint is contacted: `build` makes no network call. A local build check,
 * never AWS evidence (plan-aws §2).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { FixtureApp, buildOutput, type RunResult } from "../../fixtures/support/app.js";

interface Build {
  readonly stage: string;
  readonly production: boolean;
  /** The marker of the values file this stage must read. */
  readonly marker: string;
  result?: RunResult;
  files?: Map<string, string>;
}

const MARKERS = ["marker-aws-test-json", "marker-aws-prod-json", "marker-aws-prodcheck-json", "marker-aws-mytest-1-json"];

const BUILDS: Build[] = [
  { stage: "test-g06t1", production: false, marker: "marker-aws-test-json" },
  { stage: "prod", production: true, marker: "marker-aws-prod-json" },
  { stage: "prodcheck", production: true, marker: "marker-aws-prodcheck-json" },
  { stage: "mytest-1", production: true, marker: "marker-aws-mytest-1-json" },
];

const MOCK = [/mock-login/];
const STUB_PROVIDER = [/stubLoginProvider/, /loginWithStub/, /stubFailure/];
const LOCAL_TRANSFER_ROUTE = [/__framework\/files/];
const TICKET_KEY = [/ticket[_-]?key/i, /SECRET_[A-Z0-9_]*TICKET/];
const SPECIFIER = (names: string): RegExp => new RegExp(`(?:from\\s*|import\\s*|require\\(\\s*|import\\(\\s*)["'](?:${names})["']`);
/** Cloudflare-only: Workers runtime imports, the R2/D1 binding adapters, Wrangler and Miniflare. */
const CLOUDFLARE_ONLY = [SPECIFIER("cloudflare:[a-z-]+"), /\/cloudflare\//, /node_modules\/(?:wrangler|miniflare|@cloudflare\/)/, /\bwaitUntil\b/, /\bR2Bucket\b/, /\bD1Database\b/];
const PROVISIONING = [/@pulumi/, /pulumi/i, /["'`]sst["'`/]/, /node_modules\/sst\//, /\/provision\//, /prototype-framework\/provision/, /setupAccount/, /listStageResources/];
const POSTGRES_HARNESS = [/pglite/i, /electric-sql/];
const TOOLING = [
  SPECIFIER("eslint|typescript|typescript-eslint|drizzle-kit|wrangler|vite|vitest|esbuild|miniflare"),
  /node_modules\/(?:eslint|typescript|@typescript-eslint|typescript-eslint|drizzle-kit|wrangler|vite|vitest|esbuild|miniflare)\//,
];
/** A package import left for the Lambda runtime to resolve (the SDK must be bundled). */
const EXTERNAL_PACKAGE = /(?:^|[;\n])import\s*(?:[^"';]*?from\s*)?["'](?!node:)(?:@[a-z0-9-]+\/)?(?:aws-sdk|@aws-sdk|@smithy|hono|drizzle-orm|aws4fetch)[^"']*["']/;

function bundleText(build: Build): string {
  return [...(build.files ?? new Map<string, string>()).entries()]
    .filter(([file]) => file.includes(".framework/aws/bundle/"))
    .map(([, text]) => text)
    .join("\n");
}

function hits(text: string, patterns: readonly RegExp[]): string[] {
  return patterns.filter((p) => p.test(text)).map(String);
}

function assertBuilt(build: Build): string {
  const result = build.result;
  expect(result, `build for ${build.stage} did not run`).toBeDefined();
  if (result === undefined) return "";
  expect(result.code, `build --target aws --stage ${build.stage} exit ${String(result.code)}:\n${result.output.slice(-10_000)}`).toBe(0);
  const files = [...(build.files ?? new Map<string, string>()).keys()];
  // The Function's code directory holds exactly the bundle SST points the handler at.
  expect(files.filter((f) => f.includes(".framework/aws/bundle/")), files.join(", ")).toEqual([".framework/aws/bundle/index.mjs"]);
  const text = bundleText(build);
  // Positive controls: the inspected output is this app's Lambda bundle.
  expect(text, "bundle lacks the framework health route").toMatch(/__framework\/health/);
  expect(text, "bundle lacks this app's resolved configuration").toContain(build.marker);
  expect(text, "bundle lacks the Lambda handler export").toMatch(/export\s*\{[^}]*\bas handler\b[^}]*\}|export\s*\{[^}]*\bhandler\b[^}]*\}/);
  return text;
}

const apps: FixtureApp[] = [];

beforeAll(async () => {
  for (const build of BUILDS) {
    const app = await FixtureApp.create({ layers: ["apps/base", "build/stages"] });
    apps.push(app);
    build.result = await app.cli(["build", "--target", "aws", "--stage", build.stage]);
    build.files = await buildOutput(app);
  }
}, 900_000);

afterAll(async () => {
  for (const app of apps) await app.dispose();
});

describe("PROV-REQ-005 test and production stages (aws)", () => {
  for (const build of BUILDS.filter((b) => b.production)) {
    it(tag("PROV-AC-005", `aws: stage "${build.stage}" builds without the authentication mock or mock-login route and reads config/aws/${build.stage}.json`), () => {
      const text = assertBuilt(build);
      expect(hits(text, MOCK)).toEqual([]);
      for (const other of MARKERS.filter((m) => m !== build.marker)) expect(text).not.toContain(other);
    });
  }

  it(tag("PROV-AC-005", 'aws: stage "test-g06t1" builds with the authentication mock and reads config/aws/test.json'), () => {
    const build = BUILDS[0];
    expect(build?.stage).toBe("test-g06t1");
    if (build === undefined) return;
    const text = assertBuilt(build);
    expect(hits(text, MOCK)).toEqual(MOCK.map(String));
    for (const other of MARKERS.filter((m) => m !== build.marker)) expect(text).not.toContain(other);
  });
});

describe("CORE-REQ-006 clean runtime bundles (aws)", () => {
  for (const build of BUILDS) {
    it(
      tag(
        "CORE-AC-006",
        `AWS bundle part, stage "${build.stage}": no Cloudflare-only module, provisioning or Postgres harness; no stub login provider, local file-transfer route or its ticket key${build.production ? "; no mock" : ""}; the AWS SDK bundled`,
      ),
      () => {
        const text = assertBuilt(build);
        expect(hits(text, CLOUDFLARE_ONLY), "Cloudflare-only").toEqual([]);
        expect(hits(text, PROVISIONING), "provisioning").toEqual([]);
        expect(hits(text, POSTGRES_HARNESS), "Postgres harness").toEqual([]);
        expect(hits(text, STUB_PROVIDER), "stub login provider").toEqual([]);
        expect(hits(text, LOCAL_TRANSFER_ROUTE), "local file-transfer route").toEqual([]);
        expect(hits(text, TICKET_KEY), "local ticket key").toEqual([]);
        expect(hits(text, TOOLING), "tooling").toEqual([]);
        if (build.production) expect(hits(text, MOCK), "authentication mock").toEqual([]);
        // The SDK is in the bundle (the Data API client), not imported from the managed runtime.
        expect(text).toContain("rds-data");
        expect(text).not.toMatch(EXTERNAL_PACKAGE);
      },
    );
  }
});
