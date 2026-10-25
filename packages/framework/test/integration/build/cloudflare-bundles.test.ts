/**
 * Bundle inspection of `npx <package> build --target cloudflare --stage <s>` (CORE-REQ-006,
 * CF-REQ-003, PROV-REQ-005, LOCAL-REQ-004 cookie relaxation). Nothing is deployed.
 *
 * The inspected output is every file the build writes under `.framework/` (cli.md §2);
 * modules are recognised by strings that survive bundling and minification (package names,
 * import specifiers, route paths, property names). DEC-0240.
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

const MARKERS = ["marker-cf-test-json", "marker-cf-prod-json", "marker-cf-prodcheck-json", "marker-cf-mytest-1-json"];

const BUILDS: Build[] = [
  { stage: "test-b4t1", production: false, marker: "marker-cf-test-json" },
  { stage: "prod", production: true, marker: "marker-cf-prod-json" },
  { stage: "prodcheck", production: true, marker: "marker-cf-prodcheck-json" },
  { stage: "mytest-1", production: true, marker: "marker-cf-mytest-1-json" },
];

const MOCK = [/mock-login/];
const STUB_PROVIDER = [/stubLoginProvider/, /loginWithStub/, /stubFailure/];
const LOCAL_TRANSFER_ROUTE = [/__framework\/files/];
const TICKET_KEY = [/ticket[_-]?key/i, /SECRET_[A-Z0-9_]*TICKET/];
// An AWS endpoint host, except the issuer template of the credential library's (unused) Cognito
// social provider, `cognito-idp.${region}.amazonaws.com`, which better-auth/minimal bundles (PWD).
const AWS_SDK = [/@aws-sdk/, /aws-sdk/, /(?<!cognito-idp\.\$\{[\w.]+\}\.)amazonaws\.com/];
const PROVISIONING = [/@pulumi/, /pulumi/i, /["'`]sst["'`/]/, /node_modules\/sst\//, /\.sst\b/, /\/provision\//, /prototype-framework\/provision/, /setupAccount/, /listStageResources/];
const POSTGRES_HARNESS = [/pglite/i, /electric-sql/];
const SPECIFIER = (names: string): RegExp => new RegExp(`(?:from\\s*|require\\(\\s*|import\\(\\s*)["'](?:${names})["']`);
const FILESYSTEM = [SPECIFIER("(?:node:)?fs(?:/promises)?"), /node_modules\/(?:graceful-fs|fs-extra)\//];
const UNSUPPORTED_NODE = [SPECIFIER("(?:node:)?(?:child_process|worker_threads|cluster|repl|inspector|v8|tty|dgram)")];
const TOOLING = [
  SPECIFIER("eslint|typescript|typescript-eslint|drizzle-kit|wrangler|vite|vitest|esbuild|miniflare"),
  /node_modules\/(?:eslint|typescript|@typescript-eslint|typescript-eslint|drizzle-kit|wrangler|vite|vitest|esbuild|miniflare)\//,
];

function bundleText(build: Build): string {
  return [...(build.files ?? new Map<string, string>()).values()].join("\n");
}

function hits(text: string, patterns: readonly RegExp[]): string[] {
  return patterns.filter((p) => p.test(text)).map(String);
}

function assertBuilt(build: Build): string {
  const result = build.result;
  expect(result, `build for ${build.stage} did not run`).toBeDefined();
  if (result === undefined) return "";
  expect(result.code, `build --target cloudflare --stage ${build.stage} exit ${String(result.code)}:\n${result.output.slice(-10_000)}`).toBe(0);
  const files = [...(build.files ?? new Map<string, string>()).keys()];
  expect(files.some((f) => /\.m?js$/.test(f)), `no JavaScript bundle under .framework/: ${files.join(", ")}`).toBe(true);
  const text = bundleText(build);
  // Positive controls: the inspected output is this app's Worker bundle.
  expect(text, "bundle lacks the framework health route").toMatch(/__framework\/health/);
  expect(text, "bundle lacks this app's resolved configuration").toContain(build.marker);
  return text;
}

const apps: FixtureApp[] = [];

beforeAll(async () => {
  for (const build of BUILDS) {
    const app = await FixtureApp.create({ layers: ["apps/base", "build/stages"] });
    apps.push(app);
    build.result = await app.cli(["build", "--target", "cloudflare", "--stage", build.stage]);
    build.files = await buildOutput(app);
  }
}, 900_000);

afterAll(async () => {
  for (const app of apps) await app.dispose();
});

describe("PROV-REQ-005 test and production stages", () => {
  for (const build of BUILDS.filter((b) => b.production)) {
    it(tag("PROV-AC-005", `stage "${build.stage}" builds without the authentication mock or mock-login route and reads config/cloudflare/${build.stage}.json`), () => {
      const text = assertBuilt(build);
      expect(hits(text, MOCK)).toEqual([]);
      for (const other of MARKERS.filter((m) => m !== build.marker)) expect(text).not.toContain(other);
    });
  }

  it(tag("PROV-AC-005", 'stage "test-b4t1" builds with the authentication mock and reads config/cloudflare/test.json'), () => {
    const build = BUILDS[0];
    expect(build?.stage).toBe("test-b4t1");
    if (build === undefined) return;
    const text = assertBuilt(build);
    expect(hits(text, MOCK)).toEqual(MOCK.map(String));
    for (const other of MARKERS.filter((m) => m !== build.marker)) expect(text).not.toContain(other);
  });
});

describe("CORE-REQ-006 clean runtime bundles", () => {
  for (const build of BUILDS) {
    it(
      tag(
        "CORE-AC-006",
        `Cloudflare bundle part, stage "${build.stage}": no AWS SDK, provisioning or Postgres harness; no stub login provider, local file-transfer route or its ticket key${build.production ? "; no mock" : ""}`,
      ),
      () => {
        const text = assertBuilt(build);
        expect(hits(text, AWS_SDK), "AWS SDK").toEqual([]);
        expect(hits(text, PROVISIONING), "provisioning").toEqual([]);
        expect(hits(text, POSTGRES_HARNESS), "Postgres harness").toEqual([]);
        expect(hits(text, STUB_PROVIDER), "stub login provider").toEqual([]);
        expect(hits(text, LOCAL_TRANSFER_ROUTE), "local file-transfer route").toEqual([]);
        expect(hits(text, TICKET_KEY), "local ticket key").toEqual([]);
        if (build.production) expect(hits(text, MOCK), "authentication mock").toEqual([]);
      },
    );
  }
});

describe("CF-REQ-003 Workers-compatible bundle", () => {
  for (const build of BUILDS) {
    it(tag("CF-AC-003", `stage "${build.stage}": bundle inspection finds no AWS SDK, provisioning, Postgres harness, filesystem access, unsupported Node.js module or tooling`), () => {
      const text = assertBuilt(build);
      expect(hits(text, AWS_SDK), "AWS SDK").toEqual([]);
      expect(hits(text, PROVISIONING), "provisioning").toEqual([]);
      expect(hits(text, POSTGRES_HARNESS), "Postgres harness").toEqual([]);
      expect(hits(text, FILESYSTEM), "filesystem access").toEqual([]);
      expect(hits(text, UNSUPPORTED_NODE), "unsupported Node.js modules").toEqual([]);
      expect(hits(text, TOOLING), "tooling").toEqual([]);
    });
  }
});

describe("LOCAL-REQ-004 local cookie relaxation", () => {
  for (const build of BUILDS) {
    it(tag("LOCAL-AC-004", `cloud-build clause, stage "${build.stage}": the Cloudflare build carries the __Host-session cookie, never the local session_local setting`), () => {
      const text = assertBuilt(build);
      expect(text).toContain("__Host-session");
      expect(text).not.toContain("session_local");
    });
  }
});
