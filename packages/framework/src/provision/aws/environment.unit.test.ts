import https from "node:https";
import { GetCallerIdentityCommand, STSClient, STSServiceException } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "./aws-network-guard.test-support.js";
import { checkCredentials, clientConfig, createAwsClients, describeAwsError, missingCredentials, sstEnvironment } from "./environment.js";

const KEYS = { AWS_ACCESS_KEY_ID: "AKIDEXAMPLE", AWS_SECRET_ACCESS_KEY: "secret-value-never-printed" };

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  guard.uninstall();
});

describe("AWS credentials by name (PROV §2 Credentials)", () => {
  it("names both variables of the static pair when no credential source is set", () => {
    expect(missingCredentials({})).toEqual(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
    expect(missingCredentials({ AWS_ACCESS_KEY_ID: "AKID", AWS_SECRET_ACCESS_KEY: "" })).toEqual(["AWS_SECRET_ACCESS_KEY"]);
    expect(missingCredentials({ AWS_SECRET_ACCESS_KEY: "x" })).toEqual(["AWS_ACCESS_KEY_ID"]);
  });

  it("a profile, web identity or container source counts as present", () => {
    expect(missingCredentials(KEYS)).toEqual([]);
    expect(missingCredentials({ AWS_PROFILE: "owner" })).toEqual([]);
    expect(missingCredentials({ AWS_WEB_IDENTITY_TOKEN_FILE: "/t" })).toEqual([]);
    expect(missingCredentials({ AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://169.254.170.23/x" })).toEqual([]);
  });
});

describe("preflight: STS GetCallerIdentity", () => {
  const sts = mockClient(STSClient);
  afterEach(() => sts.reset());
  afterAll(() => sts.restore());

  it("a missing variable is named and nothing is sent", async () => {
    expect(await checkCredentials({}, new STSClient({ region: "us-east-1" }))).toEqual({ ok: false, problems: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] });
    expect(sts.calls()).toHaveLength(0);
  });

  it("usable credentials yield the account ID", async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Account: "123456789012", Arn: "arn:aws:iam::123456789012:user/owner", UserId: "AIDA" });
    expect(await checkCredentials(KEYS, new STSClient({ region: "us-east-1" }))).toEqual({ ok: true, accountId: "123456789012" });
    expect(sts.commandCalls(GetCallerIdentityCommand)).toHaveLength(1);
  });

  it("unusable credentials are reported by error name and status only, never with a value or the AWS message", async () => {
    sts.on(GetCallerIdentityCommand).rejects(
      new STSServiceException({ name: "InvalidClientTokenId", $fault: "client", $metadata: { httpStatusCode: 403 }, message: `token AKIDEXAMPLE ${KEYS.AWS_SECRET_ACCESS_KEY}` }),
    );
    const r = await checkCredentials(KEYS, new STSClient({ region: "us-east-1" }));
    expect(r).toEqual({ ok: false, problems: ["AWS credentials are not usable: STS GetCallerIdentity failed with InvalidClientTokenId (HTTP 403)"] });
    expect(JSON.stringify(r)).not.toContain("AKIDEXAMPLE");
    expect(JSON.stringify(r)).not.toContain(KEYS.AWS_SECRET_ACCESS_KEY);
  });

  it("describeAwsError never includes the message", () => {
    expect(describeAwsError(Object.assign(new Error("secret text"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }))).toBe("AccessDenied (HTTP 403)");
  });
});

describe("SDK clients reach the proxy through an explicit NodeHttpHandler (G-S1 §5)", () => {
  it("every client gets a NodeHttpHandler whose https.Agent carries proxyEnv", async () => {
    const env = { HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "localhost" };
    const clients = createAwsClients(env, "eu-west-1");
    for (const client of [clients.sts, clients.s3, clients.ec2, clients.rds, clients.ssm]) {
      const handler = client.config.requestHandler as unknown as { constructor: { name: string }; configProvider: Promise<{ httpsAgent?: unknown }> };
      expect(handler.constructor.name).toBe("NodeHttpHandler");
      const agent = (await handler.configProvider).httpsAgent;
      expect(agent).toBeInstanceOf(https.Agent);
      expect((agent as https.Agent & { options: { proxyEnv?: unknown; keepAlive?: boolean } }).options).toMatchObject({ proxyEnv: env, keepAlive: true });
      expect(await client.config.region()).toBe("eu-west-1");
    }
    expect(clientConfig(env, "us-east-1").region).toBe("us-east-1");
  });
});

describe("network guard: no unit test reaches *.amazonaws.com", () => {
  it("a real (unmocked) SDK request to AWS is refused before any socket opens, and recorded", async () => {
    const before = guard.attempts.length;
    // A dead local proxy as a second barrier: even past the guard nothing could leave the machine.
    const client = new STSClient({ ...clientConfig({ HTTPS_PROXY: "http://127.0.0.1:9" }, "us-east-1"), maxAttempts: 1, credentials: { accessKeyId: "AKIDGUARD", secretAccessKey: "guard" } });
    await expect(client.send(new GetCallerIdentityCommand({}))).rejects.toThrow(/blocked: a unit test tried to reach AWS \(sts\.us-east-1\.amazonaws\.com\)/);
    expect(guard.attempts.slice(before)).toContain("sts.us-east-1.amazonaws.com");
    await expect(fetch("https://s3.us-east-1.amazonaws.com/")).rejects.toThrow(/blocked/);
    guard.attempts.splice(before);
  });

  it("no other test in this file attempted an AWS request", () => {
    expect(guard.attempts).toEqual([]);
  });
});

describe("SST environment", () => {
  it("adds the region and DEC-0107's settings to the caller's environment", () => {
    expect(sstEnvironment({ ...KEYS, UNSET: undefined }, "eu-central-1")).toEqual({ ...KEYS, AWS_REGION: "eu-central-1", NODE_USE_ENV_PROXY: "1", SST_TELEMETRY_DISABLED: "1", CI: "1" });
  });
});
