import { describe, expect, it } from "vitest";
import type { CloudflareApi } from "./api.js";
import { listSetSecrets, logicalSecretName, setRoute, setSecret } from "./worker.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const stage = { app: "notes", stage: "test-abc" };
const SCRIPT = `/accounts/${ACCOUNT}/workers/scripts/notes-test-abc`;

type Reply = { status: number; body: unknown };
const ok = (result: unknown): Reply => ({ status: 200, body: { success: true, errors: [], messages: [], result } });
const err = (status: number, code: number, message: string): Reply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

function stubApi(replies: Record<string, Reply>): CloudflareApi & { requests: string[] } {
  const requests: string[] = [];
  const api = async (method: string, path: string, body?: unknown) => {
    requests.push(`${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`);
    const reply = replies[`${method} ${path}`];
    if (!reply) throw new Error(`unexpected request ${method} ${path}`);
    return reply;
  };
  return Object.assign(api, { requests });
}

describe("Worker secrets on Cloudflare (SEC-REQ-003; cloudflare.md `setSecret`)", () => {
  it("setSecret writes the Worker secret SECRET_<NAME> through the script's secrets API", async () => {
    const api = stubApi({ [`PUT ${SCRIPT}/secrets`]: ok({ name: "SECRET_API_KEY", type: "secret_text" }) });
    await setSecret(api, ACCOUNT, stage, "apiKey", "value-123");
    expect(api.requests).toEqual([`PUT ${SCRIPT}/secrets {"name":"SECRET_API_KEY","text":"value-123","type":"secret_text"}`]);
  });

  it("a failure names the secret and the Worker but never the value; a missing Worker says to deploy first", async () => {
    const failing = stubApi({ [`PUT ${SCRIPT}/secrets`]: err(500, 10013, "internal") });
    const e1 = await setSecret(failing, ACCOUNT, stage, "apiKey", "value-123").catch((e: unknown) => e as Error);
    expect(e1.message).toMatch(/setting secret apiKey on Worker notes-test-abc failed: HTTP 500/);
    expect(e1.message).not.toContain("value-123");
    const missing = stubApi({ [`PUT ${SCRIPT}/secrets`]: err(404, 10007, "This Worker does not exist on your account.") });
    await expect(setSecret(missing, ACCOUNT, stage, "apiKey", "v")).rejects.toThrow(/Worker notes-test-abc does not exist yet; run deploy first/);
  });

  it("listSetSecrets maps the Worker's SECRET_* names back to logical names; null while the Worker does not exist", async () => {
    const api = stubApi({
      [`GET ${SCRIPT}/secrets`]: ok([
        { name: "SECRET_API_KEY", type: "secret_text" },
        { name: "SECRET_FRAMEWORK_R2_ACCESS_KEY_ID", type: "secret_text" },
        { name: "OTHER", type: "secret_text" },
      ]),
    });
    expect(await listSetSecrets(api, ACCOUNT, stage)).toEqual(new Set(["apiKey", "frameworkR2AccessKeyId"]));
    expect(await listSetSecrets(stubApi({ [`GET ${SCRIPT}/secrets`]: err(404, 10007, "This Worker does not exist on your account.") }), ACCOUNT, stage)).toBeNull();
    await expect(listSetSecrets(stubApi({ [`GET ${SCRIPT}/secrets`]: err(403, 10000, "Authentication error") }), ACCOUNT, stage)).rejects.toThrow(/HTTP 403/);
  });

  it("logical names round-trip through the SECRET_<UPPER_SNAKE> location", () => {
    expect(logicalSecretName("SECRET_FRAMEWORK_SESSION_KEY")).toBe("frameworkSessionKey");
    expect(logicalSecretName("SECRET_KEY2X")).toBe("key2x");
    expect(logicalSecretName("FRAMEWORK_PUBLIC_ORIGIN")).toBeUndefined();
  });
});

describe("stopApp / startApp on Cloudflare: the workers.dev route off and on (DEC-0078, DEC-0090)", () => {
  it("stop sends enabled false and start enabled true, both always with previews_enabled false", async () => {
    const api = stubApi({ [`POST ${SCRIPT}/subdomain`]: ok({ enabled: false, previews_enabled: false }) });
    await setRoute(api, ACCOUNT, stage, false);
    const on = stubApi({ [`POST ${SCRIPT}/subdomain`]: ok({ enabled: true, previews_enabled: false }) });
    await setRoute(on, ACCOUNT, stage, true);
    expect(api.requests).toEqual([`POST ${SCRIPT}/subdomain {"enabled":false,"previews_enabled":false}`]);
    expect(on.requests).toEqual([`POST ${SCRIPT}/subdomain {"enabled":true,"previews_enabled":false}`]);
  });

  it("an answer whose state differs from the one asked for is a failure, as is an error answer", async () => {
    const wrong = stubApi({ [`POST ${SCRIPT}/subdomain`]: ok({ enabled: false, previews_enabled: false }) });
    await expect(setRoute(wrong, ACCOUNT, stage, true)).rejects.toThrow(/turning on the workers\.dev route of Worker notes-test-abc.*enabled false/);
    const failing = stubApi({ [`POST ${SCRIPT}/subdomain`]: err(500, 1, "internal") });
    await expect(setRoute(failing, ACCOUNT, stage, false)).rejects.toThrow(/turning off the workers\.dev route of Worker notes-test-abc failed: HTTP 500/);
  });
});
