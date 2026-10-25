import { describe, expect, it } from "vitest";
import { createFrameworkSecrets, createSecretsService, envSecretReader } from "./service.js";

/** A generated dummy value, never a real credential. */
const dummy = (label: string) => `${label}-${crypto.randomUUID()}`;

describe("[SEC-AC-001] SecretsService reads declared secrets by logical name", () => {
  it("returns a declared secret's value from SECRET_<NAME> in the Worker env", async () => {
    const value = dummy("api");
    const secrets = createSecretsService({
      declared: ["apiKey"],
      read: envSecretReader({ SECRET_API_KEY: value }, "local"),
    });
    await expect(secrets.get("apiKey")).resolves.toBe(value);
  });

  it.each(["notDeclared", "SECRET_API_KEY", "frameworkSessionKey"])(
    "an undeclared name (%s) fails with SEC.UNDECLARED even when the env has a value for it",
    async (name) => {
      const env = { SECRET_NOT_DECLARED: dummy("x"), SECRET_FRAMEWORK_SESSION_KEY: dummy("k"), SECRET_API_KEY: dummy("a") };
      const secrets = createSecretsService<string>({ declared: ["apiKey"], read: envSecretReader(env, "local") });
      await expect(secrets.get(name)).rejects.toMatchObject({ name: "FrameworkError", code: "SEC.UNDECLARED" });
    },
  );

  it.each([
    ["absent", {}],
    ["empty", { SECRET_API_KEY: "" }],
    ["not a string", { SECRET_API_KEY: { binding: true } }],
  ])("a declared name whose value is %s fails with SEC.MISSING", async (_label, env) => {
    const secrets = createSecretsService({ declared: ["apiKey"], read: envSecretReader(env, "local") });
    await expect(secrets.get("apiKey")).rejects.toMatchObject({ name: "FrameworkError", code: "SEC.MISSING" });
  });

  it("reuses a value within one service (one request) and reads again in a new one", async () => {
    let reads = 0;
    let current = dummy("v1");
    const read = async () => {
      reads += 1;
      return current;
    };
    const first = createSecretsService({ declared: ["apiKey"], read });
    const v1 = current;
    await expect(first.get("apiKey")).resolves.toBe(v1);
    current = dummy("v2");
    await expect(first.get("apiKey")).resolves.toBe(v1);
    expect(reads).toBe(1);
    const second = createSecretsService({ declared: ["apiKey"], read });
    await expect(second.get("apiKey")).resolves.toBe(current);
    expect(reads).toBe(2);
  });

  it("does not remember a missing value: a later read in the same request reads again", async () => {
    let value: string | undefined = undefined;
    const secrets = createSecretsService({ declared: ["apiKey"], read: async () => value });
    await expect(secrets.get("apiKey")).rejects.toMatchObject({ code: "SEC.MISSING" });
    value = dummy("late");
    await expect(secrets.get("apiKey")).resolves.toBe(value);
  });

  it("an unreachable store fails with SEC.UNAVAILABLE and writes one error entry", async () => {
    const entries: { component: string; severity: string; message: string }[] = [];
    const log = { write: (component: string, severity: string, message: string) => void entries.push({ component, severity, message }) };
    const secrets = createSecretsService({
      declared: ["apiKey"],
      read: async () => {
        throw new Error("store unreachable");
      },
      log: log as never,
    });
    const failure = await secrets.get("apiKey").catch((e: unknown) => e);
    expect(failure).toMatchObject({ name: "FrameworkError", code: "SEC.UNAVAILABLE" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ component: "SEC", severity: "error" });
    expect(entries[0]!.message).toContain("SEC.UNAVAILABLE");
  });

  it("passes a FrameworkError from the store through unchanged", async () => {
    const secrets = createSecretsService({
      declared: ["apiKey"],
      read: async () => {
        const { FrameworkError } = await import("../core/errors.js");
        throw new FrameworkError("SEC.UNAVAILABLE", "timed out");
      },
    });
    await expect(secrets.get("apiKey")).rejects.toMatchObject({ code: "SEC.UNAVAILABLE", message: "timed out" });
  });

  it("the framework-internal reader reads framework names and refuses app names", async () => {
    const key = dummy("session");
    const env = { SECRET_FRAMEWORK_SESSION_KEY: key, SECRET_API_KEY: dummy("a") };
    const internal = createFrameworkSecrets({ read: envSecretReader(env, "cloudflare") });
    await expect(internal.get("frameworkSessionKey")).resolves.toBe(key);
    await expect(internal.get("frameworkAuthSecret")).rejects.toMatchObject({ code: "SEC.MISSING" });
    // Retired with GOOGLE (DEC-0513): no longer a framework-internal name.
    await expect(internal.get("frameworkGoogleClientSecret" as never)).rejects.toMatchObject({ code: "SEC.UNDECLARED" });
    await expect(internal.get("apiKey" as never)).rejects.toMatchObject({ code: "SEC.UNDECLARED" });
  });

  it("the local ticket key is readable only when the target passes it as an extra framework name", async () => {
    const ticket = dummy("ticket");
    const env = { SECRET_FRAMEWORK_LOCAL_TICKET_KEY: ticket };
    const cloud = createFrameworkSecrets({ read: envSecretReader(env, "cloudflare") });
    await expect(cloud.get("frameworkLocalTicketKey")).rejects.toMatchObject({ code: "SEC.UNDECLARED" });
    const local = createFrameworkSecrets({ read: envSecretReader(env, "local"), extra: ["frameworkLocalTicketKey"] });
    await expect(local.get("frameworkLocalTicketKey")).resolves.toBe(ticket);
  });

  it("an app declaration of a reserved framework name does not make it readable", async () => {
    const secrets = createSecretsService<string>({
      declared: ["frameworkSessionKey"],
      read: envSecretReader({ SECRET_FRAMEWORK_SESSION_KEY: dummy("k") }, "local"),
    });
    await expect(secrets.get("frameworkSessionKey")).rejects.toMatchObject({ code: "SEC.UNDECLARED" });
  });
});
