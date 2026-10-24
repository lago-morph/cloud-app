/**
 * G-11: the per-target operations factory and the AWS wiring of the cloud commands. The AWS
 * account and target are injected or built without any request; the AWS network guard records
 * every attempt to reach `*.amazonaws.com` and the suite asserts it saw none. `sst` never runs:
 * a fake `SstExec` records what it would have been given.
 */
import https from "node:https";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { awsAccount, type AwsAccountOptions } from "../../provision/aws/account.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "../../provision/aws/aws-network-guard.test-support.js";
import { createAwsClients } from "../../provision/aws/environment.js";
import { runSst, type FunctionCode, type SstExec } from "../../provision/aws/sst.js";
import type { AwsTargetOptions } from "../../provision/aws/target.js";
import { FakeTarget } from "../../provision/core/fake-target.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { awsChildEnvironment, awsOperations, awsOperationsWith } from "./aws-operations.js";
import { cloudflareOperations, OPERATIONS_FACTORIES, targetOperations, type OperationsFactory, type OperationsInput } from "./operations.js";

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  expect(guard.attempts).toEqual([]);
  guard.uninstall();
});

const appDir = () => mkdtempSync(join(tmpdir(), "g11-ops-"));
const CREDENTIALS = { AWS_ACCESS_KEY_ID: "AKIDPLACEHOLDER", AWS_SECRET_ACCESS_KEY: "placeholder" };
const CA = "/root/.ccr/ca-bundle.crt";
const PROXY = "http://127.0.0.1:9";

describe("targetOperations: one factory per cloud target (G-11)", () => {
  function recording() {
    const seen: string[] = [];
    const factory =
      (name: string): OperationsFactory =>
      (options) =>
      (input: OperationsInput) => {
        seen.push(`${name} ${input.target} requireCredentials=${String(options.requireCredentials)}${input.region === undefined ? "" : ` region=${input.region}`}${input.code === undefined ? "" : " code"}`);
        return new FakeTarget() as TargetOperations;
      };
    return { seen, factories: { cloudflare: factory("cloudflare"), aws: factory("aws") } };
  }

  it("registers Cloudflare's unchanged factory and the AWS one", () => {
    expect(OPERATIONS_FACTORIES.cloudflare).toBe(cloudflareOperations);
    expect(OPERATIONS_FACTORIES.aws).toBe(awsOperations);
  });

  it("dispatches each target to its own factory, passing the options, the code and the region", () => {
    const { seen, factories } = recording();
    const make = targetOperations({ env: {}, requireCredentials: true }, factories);
    make({ appDir: "/a", target: "cloudflare", code: {} });
    make({ appDir: "/a", target: "aws", region: "eu-west-1" });
    expect(seen).toEqual(["cloudflare cloudflare requireCredentials=true code", "aws aws requireCredentials=true region=eu-west-1"]);
  });

  it("refuses local, an unknown target and a region for Cloudflare, before any factory runs", () => {
    const { seen, factories } = recording();
    const make = targetOperations({ env: {}, requireCredentials: false }, factories);
    expect(() => make({ appDir: "/a", target: "local" })).toThrow(/no provisioning operations for target local/);
    expect(() => make({ appDir: "/a", target: "gcp" as never })).toThrow(/no provisioning operations for target gcp/);
    expect(() => make({ appDir: "/a", target: "cloudflare", region: "eu-west-1" })).toThrow(/region is chosen only for target aws/);
    expect(seen).toEqual([]);
  });

  it("each target's factory refuses the other's target, so nothing falls through", () => {
    const env = { ...CREDENTIALS, CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: "acc123" };
    expect(() => cloudflareOperations({ env, requireCredentials: true })({ appDir: appDir(), target: "aws" })).toThrow(/only Cloudflare's operations/);
    expect(() => awsOperations({ env, requireCredentials: true })({ appDir: appDir(), target: "cloudflare" })).toThrow(/only AWS's operations/);
  });

  it("the real factory gives Cloudflare's and AWS's operations by --target, without a request", () => {
    const env = { ...CREDENTIALS, CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: "acc123" };
    const make = targetOperations({ env, requireCredentials: true, fetch: async () => new Response("{}") });
    expect(make({ appDir: appDir(), target: "cloudflare" }).target).toBe("cloudflare");
    const aws = make({ appDir: appDir(), target: "aws" });
    expect(aws.target).toBe("aws");
    expect(aws.dialect).toBe("postgres");
  });
});

describe("awsChildEnvironment: the proxy and CA for SST, Pulumi and the Go providers", () => {
  it("sets SSL_CERT_FILE from NODE_EXTRA_CA_CERTS and both spellings of the proxy variables", () => {
    expect(awsChildEnvironment({ NODE_EXTRA_CA_CERTS: CA, HTTPS_PROXY: PROXY, no_proxy: "localhost", PATH: "/bin" })).toEqual({
      NODE_EXTRA_CA_CERTS: CA,
      SSL_CERT_FILE: CA,
      HTTPS_PROXY: PROXY,
      https_proxy: PROXY,
      NO_PROXY: "localhost",
      no_proxy: "localhost",
      PATH: "/bin",
    });
    expect(awsChildEnvironment({ https_proxy: PROXY })).toEqual({ HTTPS_PROXY: PROXY, https_proxy: PROXY });
  });

  it("never replaces the owner's SSL_CERT_FILE, and adds nothing on a machine without a proxy or CA", () => {
    expect(awsChildEnvironment({ NODE_EXTRA_CA_CERTS: CA, SSL_CERT_FILE: "/etc/mine.pem" }).SSL_CERT_FILE).toBe("/etc/mine.pem");
    expect(awsChildEnvironment({ PATH: "/bin" })).toEqual({ PATH: "/bin" });
    expect(awsChildEnvironment({ NODE_EXTRA_CA_CERTS: "" })).toEqual({ NODE_EXTRA_CA_CERTS: "" });
  });
});

describe("awsOperations: G-10's target on G-07's account", () => {
  function injected() {
    const accounts: AwsAccountOptions[] = [];
    const targets: AwsTargetOptions[] = [];
    const factory = awsOperationsWith({
      account: (o) => (accounts.push(o), awsAccount(o)),
      createTarget: (o) => (targets.push(o), new FakeTarget() as TargetOperations),
    });
    return { accounts, targets, factory };
  }

  it("builds the account and the target with the child environment, the region, the Lambda code and fetch", () => {
    const { accounts, targets, factory } = injected();
    const code: FunctionCode = { bundle: "/app/.framework/aws/bundle", handler: "index.handler", assetsDirectory: "/app/.framework/aws/client" };
    const stub: typeof fetch = async () => new Response("ok");
    const env = { ...CREDENTIALS, NODE_EXTRA_CA_CERTS: CA, HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: "1" };
    factory({ env, requireCredentials: true, fetch: stub })({ appDir: "/app", target: "aws", code, region: "eu-west-1" });
    const child = awsChildEnvironment(env);
    expect(accounts).toEqual([{ env: child, region: "eu-west-1" }]);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ env: child, appDir: "/app", code, fetch: stub });
    expect(targets[0]?.env.SSL_CERT_FILE).toBe(CA);
  });

  it("without --region the account keeps its recorded region (none is passed)", () => {
    const { accounts, factory } = injected();
    factory({ env: CREDENTIALS, requireCredentials: false })({ appDir: "/app", target: "aws" });
    expect(accounts).toEqual([{ env: CREDENTIALS }]);
  });

  it("with requireCredentials, missing credential variables are named before anything is built; a profile counts", () => {
    const { accounts, targets, factory } = injected();
    expect(() => factory({ env: { AWS_ACCESS_KEY_ID: "AKIDPLACEHOLDER" }, requireCredentials: true })({ appDir: "/app", target: "aws" })).toThrow(
      /missing AWS credentials: AWS_SECRET_ACCESS_KEY \(set them in the environment, or name a profile with AWS_PROFILE; values are never printed\)/,
    );
    expect(accounts).toEqual([]);
    expect(targets).toEqual([]);
    factory({ env: { AWS_PROFILE: "sandbox" }, requireCredentials: true })({ appDir: "/app", target: "aws" });
    expect(targets).toHaveLength(1);
  });

  it("for deploy (no requireCredentials) the real target is built, and its preflight names the missing credentials without a request", async () => {
    const ops = awsOperations({ env: {}, requireCredentials: false })({ appDir: appDir(), target: "aws" });
    expect(await ops.preflight({ app: "notes", stage: "test-abc" })).toEqual(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
  });

  it("the SDK clients get the proxy-aware handler of targets/aws/sdk.ts with the child environment as proxyEnv", async () => {
    const { accounts, factory } = injected();
    factory({ env: { ...CREDENTIALS, NODE_EXTRA_CA_CERTS: CA, https_proxy: PROXY }, requireCredentials: true })({ appDir: "/app", target: "aws" });
    const env = accounts[0]!.env;
    const clients = createAwsClients(env, "eu-west-1");
    for (const client of [clients.sts, clients.s3, clients.ssm]) {
      const handler = client.config.requestHandler as unknown as { constructor: { name: string }; configProvider: Promise<{ httpsAgent?: unknown }> };
      expect(handler.constructor.name).toBe("NodeHttpHandler");
      const agent = (await handler.configProvider).httpsAgent as https.Agent & { options: { proxyEnv?: Record<string, string> } };
      expect(agent).toBeInstanceOf(https.Agent);
      expect(agent.options.proxyEnv).toMatchObject({ HTTPS_PROXY: PROXY, https_proxy: PROXY, SSL_CERT_FILE: CA });
    }
  });

  it("SST (and through it Pulumi and the Go provider) runs with SSL_CERT_FILE, the proxy and NODE_USE_ENV_PROXY=1", async () => {
    const { targets, factory } = injected();
    factory({ env: { ...CREDENTIALS, NODE_EXTRA_CA_CERTS: CA, HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: "1" }, requireCredentials: true })({ appDir: "/app", target: "aws" });
    const runs: Record<string, string>[] = [];
    const exec: SstExec = async (_args, options) => (runs.push({ ...options.env }), { code: 0, output: "" });
    await runSst(exec, { dir: appDir(), env: targets[0]!.env, stage: { app: "notes", stage: "test-abc" }, region: "eu-west-1" }, "deploy");
    expect(runs.length).toBeGreaterThan(0);
    for (const env of runs) {
      expect(env).toMatchObject({ SSL_CERT_FILE: CA, NODE_EXTRA_CA_CERTS: CA, HTTPS_PROXY: PROXY, https_proxy: PROXY, NODE_USE_ENV_PROXY: "1", AWS_REGION: "eu-west-1" });
    }
  });
});
