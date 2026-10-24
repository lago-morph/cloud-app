/**
 * The AWS Lambda bundle inspection rules (`inspect.ts`; CORE-REQ-006, PROV-REQ-005;
 * DEC-0474), one forbidden kind at a time over a synthetic clean bundle. The real
 * bundles are inspected in `aws.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { AWS_BUNDLE_MAX_BYTES, MIN_SECRET_LENGTH, environmentSecretValues, inspectBundle, isNodeBuiltin, type BundleUnderInspection } from "./inspect.js";

const CLEAN: BundleUnderInspection = {
  text: 'import{createRequire as r}from"node:module";var a="/api/__framework/health";export{a as handler};',
  bytes: 1000,
  modules: [
    "packages/framework/src/targets/aws/handler.ts",
    "packages/framework/src/targets/stage.ts",
    "packages/framework/src/files/disposition.ts",
    "../../node_modules/@aws-sdk/client-rds-data/dist-es/RDSDataClient.js",
    "../../node_modules/@aws-sdk/client-ssm/dist-es/SSMClient.js",
    "../../node_modules/@aws-sdk/nested-clients/dist-es/submodules/sts/STSClient.js",
  ],
  externals: ["node:module", "crypto", "node:fs/promises", "stream"],
  production: true,
  secretValues: [],
};

const inspect = (change: Partial<BundleUnderInspection>): string[] => inspectBundle({ ...CLEAN, ...change });

describe("inspectBundle", () => {
  it("a clean production bundle has no violations", () => {
    expect(inspectBundle(CLEAN)).toEqual([]);
  });

  const MODULES: readonly (readonly [string, string])[] = [
    ["Cloudflare-only module", "packages/framework/src/targets/cloudflare/bindings.ts"],
    ["Cloudflare-only module", "packages/framework/dist/files/cloudflare/keys.js"],
    ["Cloudflare-only module", "packages/framework/src/log/cloudflare/sink.ts"],
    ["Cloudflare-only module", "../../node_modules/miniflare/dist/index.js"],
    ["Cloudflare-only module", "../../node_modules/@cloudflare/workers-types/index.js"],
    ["provisioning", "packages/framework/src/provision/aws/sst.ts"],
    ["provisioning", "../../node_modules/sst/dist/index.js"],
    ["provisioning", "../../node_modules/@pulumi/aws/index.js"],
    ["CLI-only AWS SDK client", "../../node_modules/@aws-sdk/client-sts/dist-es/STSClient.js"],
    ["CLI-only AWS SDK client", "../../node_modules/@aws-sdk/client-rds/dist-es/RDSClient.js"],
    ["CLI-only AWS SDK client", "../../node_modules/@aws-sdk/client-ec2/dist-es/EC2Client.js"],
    ["CLI-only AWS SDK client", "../../node_modules/@aws-sdk/client-lambda/dist-es/LambdaClient.js"],
    ["CLI-only AWS SDK client", "../../node_modules/@aws-sdk/client-secrets-manager/dist-es/index.js"],
    ["Postgres harness", "../../node_modules/@electric-sql/pglite/dist/index.js"],
    ["Postgres harness", "packages/framework/src/sql/postgres.ts"],
    ["stub login provider or test helpers", "packages/framework/src/auth/stub-provider.ts"],
    ["stub login provider or test helpers", "packages/framework/src/testing/test-app.ts"],
    ["stub login provider or test helpers", "packages/framework/src/files/fake-store.test-support.ts"],
    ["local file-transfer route or its ticket key", "packages/framework/src/files/local/route.ts"],
    ["tooling", "../../node_modules/typescript/lib/typescript.js"],
    ["authentication mock", "packages/framework/src/auth/mock.ts"],
  ];
  for (const [what, module] of MODULES) {
    it(tag("CORE-AC-006", `AWS bundle part, inspection rule: a bundled ${module} is a ${what}`), () => {
      expect(inspect({ modules: [...CLEAN.modules, module] })).toEqual([`${what}: module ${module}`]);
    });
  }

  it("framework rules match the framework's own modules, installed or in the repository, never the app's", () => {
    expect(inspect({ modules: ["../node_modules/@lago-morph/prototype-framework/dist/targets/cloudflare/bindings.js"] })).toHaveLength(1);
    expect(inspect({ modules: ["../node_modules/@lago-morph/prototype-framework/dist/provision/aws/sst.js"] })).toHaveLength(1);
    expect(inspect({ modules: ["src/server/cloudflare/notes.ts", "src/testing/helpers.ts", "src/provision/plan.ts", "src/auth/mock.ts"] })).toEqual([]);
  });

  it("rds-data is not mistaken for the CLI-only rds client, nor nested STS for client-sts", () => {
    expect(inspect({ modules: ["../../node_modules/@aws-sdk/client-rds-data/dist-es/index.js", "../../node_modules/@aws-sdk/nested-clients/dist-es/submodules/sts/index.js"] })).toEqual([]);
  });

  const TEXTS: readonly (readonly [string, string])[] = [
    ["Cloudflare-only module", 'import{env}from"cloudflare:workers";'],
    ["provisioning", 'import"@pulumi/aws";'],
    ["provisioning", "setupAccount(x)"],
    ["Postgres harness", "new PGlite()"],
    ["stub login provider or test helpers", "loginWithStub()"],
    ["local file-transfer route or its ticket key", '"/api/__framework/files/"'],
    ["local file-transfer route or its ticket key", '"SECRET_FRAMEWORK_LOCAL_TICKET_KEY"'],
    ["tooling", 'import"esbuild";'],
    ["authentication mock", '"/api/__framework/mock-login"'],
  ];
  for (const [what, text] of TEXTS) {
    it(`a bundle text ${JSON.stringify(text)} is a ${what}`, () => {
      const violations = inspect({ text: `${CLEAN.text}${text}` });
      expect(violations.length).toBeGreaterThan(0);
      for (const v of violations) expect(v.startsWith(`${what}: text matches`)).toBe(true);
    });
  }

  it(tag("PROV-AC-005", "build part (aws), inspection rule: the mock is allowed in a test-stage bundle only"), () => {
    const mock = { modules: [...CLEAN.modules, "packages/framework/src/auth/mock.ts"], text: `${CLEAN.text}"/api/__framework/mock-login"` };
    expect(inspect({ ...mock, production: false })).toEqual([]);
    expect(inspect({ ...mock, production: true })).toHaveLength(2);
  });

  it("only Node built-ins may stay external: a package import fails", () => {
    expect(inspect({ externals: [...(CLEAN.externals ?? []), "@aws-sdk/client-ssm"] })).toEqual(["external import: @aws-sdk/client-ssm is not bundled (only Node built-ins may be left to the runtime)"]);
    expect(inspect({ externals: ["hono"] })).toHaveLength(1);
    expect(isNodeBuiltin("node:fs/promises")).toBe(true);
    expect(isNodeBuiltin("http2")).toBe(true);
    expect(isNodeBuiltin("aws-sdk")).toBe(false);
  });

  it("a secret value the build can see fails the inspection, and the violation never contains it", () => {
    const value = "very-secret-value-123";
    const violations = inspect({ text: `${CLEAN.text}"${value}"`, secretValues: [value, value, "other-secret-not-there"] });
    expect(violations).toEqual(["secret values: 1 secret value(s) visible to the build appear in the bundle"]);
    expect(violations.join("")).not.toContain(value);
    // Values too short to search for meaningfully are skipped.
    expect(inspect({ secretValues: ["a".repeat(MIN_SECRET_LENGTH - 1), "health"] })).toEqual([]);
  });

  it("an AWS access key ID in the bundle fails the inspection", () => {
    expect(inspect({ text: `${CLEAN.text}"AKIAIOSFODNN7EXAMPLE"` })).toEqual(["secret values: the bundle contains an AWS access key ID"]);
    expect(inspect({ text: `${CLEAN.text}"ASIAIOSFODNN7EXAMPLE"` })).toHaveLength(1);
  });

  it("a bundle above the size bound fails the inspection", () => {
    expect(inspect({ bytes: AWS_BUNDLE_MAX_BYTES })).toEqual([]);
    expect(inspect({ bytes: AWS_BUNDLE_MAX_BYTES + 1 })).toEqual([`size: the bundle is ${String(AWS_BUNDLE_MAX_BYTES + 1)} bytes, above the bound of ${String(AWS_BUNDLE_MAX_BYTES)} bytes`]);
    expect(inspect({ bytes: 11, maxBytes: 10 })).toHaveLength(1);
  });

  it("environmentSecretValues takes every SECRET_* variable and the AWS credentials, nothing else", () => {
    expect(
      environmentSecretValues({ SECRET_API_KEY: "k1", SECRET_EMPTY: "", AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "sk", AWS_SESSION_TOKEN: "tok", AWS_REGION: "eu-west-1", PATH: "/bin", MY_SECRET: "no" }).sort(),
    ).toEqual(["id", "k1", "sk", "tok"]);
  });
});
