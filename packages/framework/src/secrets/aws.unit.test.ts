/**
 * The AWS secret reader (secrets.md §2 "AWS"): `GetParameter` with decryption at
 * `/<app>/<stage>/secrets/<name>`; `ParameterNotFound` → `SEC.MISSING`, any other failure →
 * `SEC.UNAVAILABLE`; nothing cached across requests (SEC-AC-005). Every client is an
 * aws-sdk-client-mock; a network guard refuses any real `*.amazonaws.com` request.
 */
import https from "node:https";
import { GetParameterCommand, InternalServerError, ParameterNotFound, SSMClient } from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { createDeployment } from "../core/identity.js";
import type { LogEntry } from "../log/entry.js";
import { createLogWriter } from "../log/writer.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "../provision/aws/aws-network-guard.test-support.js";
import { createSsmClient, ssmSecretReader } from "./aws.js";
import { FRAMEWORK_SECRETS } from "./names.js";
import { createFrameworkSecrets, createSecretsService } from "./service.js";

const SCOPE = { app: "notes", stage: "test-abc" };
const ssm = mockClient(SSMClient);
const client = new SSMClient({ region: "eu-west-1", credentials: { accessKeyId: "AKIDMOCK", secretAccessKey: "mock" } });

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  guard.uninstall();
  ssm.restore();
});
beforeEach(() => {
  ssm.reset();
});

const notFound = () => new ParameterNotFound({ message: "Parameter /notes/test-abc/secrets/apiKey not found.", $metadata: { httpStatusCode: 400 } });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (thrown) {
    if (thrown instanceof FrameworkError) return thrown.code;
    throw thrown;
  }
  throw new Error("expected a FrameworkError");
}

describe("ssmSecretReader", () => {
  it("reads /<app>/<stage>/secrets/<name> with GetParameter and decryption", async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Name: "/notes/test-abc/secrets/apiKey", Type: "SecureString", Value: "v-1" } });
    expect(await ssmSecretReader(client, SCOPE)("apiKey")).toBe("v-1");
    expect(ssm.commandCalls(GetParameterCommand).map((c) => c.args[0].input)).toEqual([{ Name: "/notes/test-abc/secrets/apiKey", WithDecryption: true }]);
  });

  it("framework-internal secrets live under the same stage path", async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: "k" } });
    const secrets = createFrameworkSecrets({ read: ssmSecretReader(client, SCOPE) });
    expect(await secrets.get(FRAMEWORK_SECRETS.sessionKey)).toBe("k");
    expect(ssm.commandCalls(GetParameterCommand)[0]!.args[0].input.Name).toBe("/notes/test-abc/secrets/frameworkSessionKey");
  });

  it("ParameterNotFound, an absent value and an empty value resolve undefined", async () => {
    const read = ssmSecretReader(client, SCOPE);
    ssm.on(GetParameterCommand).rejectsOnce(notFound()).resolvesOnce({}).resolvesOnce({ Parameter: { Value: "" } });
    expect(await read("apiKey")).toBeUndefined();
    expect(await read("apiKey")).toBeUndefined();
    expect(await read("apiKey")).toBeUndefined();
  });

  it("ParameterNotFound is recognised by name (another copy of the SDK's class)", async () => {
    ssm.on(GetParameterCommand).rejects(Object.assign(new Error("x"), { name: "ParameterNotFound" }));
    expect(await ssmSecretReader(client, SCOPE)("apiKey")).toBeUndefined();
  });

  it("any other failure rejects with a plain error naming only the SDK error", async () => {
    ssm.on(GetParameterCommand).rejects(Object.assign(new Error("User: arn:aws:sts::123:assumed-role/x is not authorized"), { name: "AccessDeniedException" }));
    const failure = await ssmSecretReader(client, SCOPE)("apiKey").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(FrameworkError);
    expect((failure as Error).message).toBe("SSM GetParameter failed with AccessDeniedException");
  });
});

describe("the AWS reader under the SecretsService (SEC-AC-001, SEC-REQ-005)", () => {
  const deployment = createDeployment({ app: "notes", stage: "test-abc", target: "aws" });

  it(tag("SEC-AC-001", "unit (AWS): a declared secret with a value is returned; undeclared is SEC.UNDECLARED; ParameterNotFound is SEC.MISSING"), async () => {
    ssm
      .on(GetParameterCommand, { Name: "/notes/test-abc/secrets/apiKey" })
      .resolves({ Parameter: { Value: "v-1" } })
      .on(GetParameterCommand, { Name: "/notes/test-abc/secrets/other" })
      .rejects(notFound());
    const secrets = createSecretsService<"apiKey" | "other">({ declared: ["apiKey", "other"], read: ssmSecretReader(client, SCOPE) });
    expect(await secrets.get("apiKey")).toBe("v-1");
    expect(await codeOf(secrets.get("other"))).toBe("SEC.MISSING");
    expect(await codeOf(secrets.get("nope" as "apiKey"))).toBe("SEC.UNDECLARED");
    expect(ssm.commandCalls(GetParameterCommand).map((c) => c.args[0].input.Name)).not.toContain("/notes/test-abc/secrets/nope");
  });

  it("every non-ParameterNotFound failure is SEC.UNAVAILABLE, logged once, without the store's text", async () => {
    const failures: unknown[] = [
      Object.assign(new Error("not authorized to perform ssm:GetParameter on secret-path"), { name: "AccessDeniedException" }),
      new InternalServerError({ message: "internal", $metadata: { httpStatusCode: 500 } }),
      Object.assign(new Error("throttled"), { name: "ThrottlingException" }),
      Object.assign(new Error("Unable to decrypt with KMS key"), { name: "KMSAccessDeniedException" }),
      new TypeError("socket hang up"),
    ];
    for (const failure of failures) {
      ssm.reset();
      ssm.on(GetParameterCommand).rejects(failure as Error);
      const entries: LogEntry[] = [];
      const log = createLogWriter({ deployment, requestId: "r-1", request: { method: "GET", path: "/api/x" } }, (e) => void entries.push(e));
      const secrets = createSecretsService<"apiKey">({ declared: ["apiKey"], read: ssmSecretReader(client, SCOPE), log });
      const thrown = await secrets.get("apiKey").then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(thrown).toBeInstanceOf(FrameworkError);
      expect((thrown as FrameworkError).code).toBe("SEC.UNAVAILABLE");
      expect((thrown as FrameworkError).message).not.toMatch(/authorized|internal|throttled|KMS|socket/);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ component: "SEC", severity: "error" });
      expect(JSON.stringify(entries)).not.toMatch(/secret-path|decrypt with KMS/);
    }
  });

  it(tag("SEC-AC-005", "unit (AWS): nothing is cached across requests; a new value and a deleted parameter are seen by the next request"), async () => {
    const read = ssmSecretReader(client, SCOPE); // one reader per cold start, as the runtime shares it
    const request = () => createSecretsService<"apiKey">({ declared: ["apiKey"], read });
    ssm.on(GetParameterCommand).resolvesOnce({ Parameter: { Value: "old" } }).resolvesOnce({ Parameter: { Value: "new" } }).rejectsOnce(notFound());
    expect(await request().get("apiKey")).toBe("old");
    expect(await request().get("apiKey")).toBe("new");
    expect(await codeOf(request().get("apiKey"))).toBe("SEC.MISSING");
    expect(ssm.commandCalls(GetParameterCommand)).toHaveLength(3);
  });

  it("within one request a found value is reused (SEC-REQ-005 MAY); a missing one is asked again", async () => {
    ssm.on(GetParameterCommand).rejectsOnce(notFound()).resolves({ Parameter: { Value: "v" } });
    const secrets = createSecretsService<"apiKey">({ declared: ["apiKey"], read: ssmSecretReader(client, SCOPE) });
    expect(await codeOf(secrets.get("apiKey"))).toBe("SEC.MISSING");
    expect(await secrets.get("apiKey")).toBe("v");
    expect(await secrets.get("apiKey")).toBe("v");
    expect(ssm.commandCalls(GetParameterCommand)).toHaveLength(2);
  });

  it("the reader itself never remembers a value", async () => {
    ssm.on(GetParameterCommand).resolvesOnce({ Parameter: { Value: "a" } }).resolvesOnce({ Parameter: { Value: "b" } });
    const read = ssmSecretReader(client, SCOPE);
    expect([await read("apiKey"), await read("apiKey")]).toEqual(["a", "b"]);
  });
});

describe("createSsmClient", () => {
  it("is in the given region with the shared proxy-aware NodeHttpHandler", async () => {
    const env = { HTTPS_PROXY: "http://127.0.0.1:9" };
    const created = createSsmClient(env, "eu-west-1");
    expect(await created.config.region()).toBe("eu-west-1");
    const handler = created.config.requestHandler as unknown as { constructor: { name: string }; configProvider: Promise<{ httpsAgent?: unknown }> };
    expect(handler.constructor.name).toBe("NodeHttpHandler");
    const agent = (await handler.configProvider).httpsAgent as https.Agent & { options: { proxyEnv?: unknown; keepAlive?: boolean } };
    expect(agent).toBeInstanceOf(https.Agent);
    expect(agent.options).toMatchObject({ proxyEnv: env, keepAlive: true });
  });
});

describe("network guard: the SSM reader reaches no real AWS endpoint", () => {
  it("an unmocked client's GetParameter is refused by the guard and surfaces as SEC.UNAVAILABLE", async () => {
    ssm.restore();
    const inner = installAwsNetworkGuard();
    try {
      const real = new SSMClient({ region: "eu-west-1", maxAttempts: 1, credentials: { accessKeyId: "AKIDGUARD", secretAccessKey: "guard" }, requestHandler: { httpsAgent: new https.Agent() } });
      const secrets = createSecretsService<"apiKey">({ declared: ["apiKey"], read: ssmSecretReader(real, SCOPE) });
      expect(await codeOf(secrets.get("apiKey"))).toBe("SEC.UNAVAILABLE");
      expect(inner.attempts).toEqual(["ssm.eu-west-1.amazonaws.com"]);
    } finally {
      inner.uninstall();
      ssm.restore();
    }
  });

  it("no other test in this file attempted an AWS request", () => {
    expect(guard.attempts).toEqual([]);
  });
});
