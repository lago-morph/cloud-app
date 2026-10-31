import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isRegistered, type D1Like } from "../../auth-app/store.js";
import type { CloudflareApi } from "./api.js";
import { openFakeD1Api, type FakeD1Api } from "./d1/fake-d1-api.js";
import { cloudflareAuthAppLink, listSetSecrets, logicalSecretName, setRoute, setSecret } from "./worker.js";

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
    const e1 = await setSecret(failing, ACCOUNT, stage, "apiKey", "value-123").then(() => new Error("no rejection"), (e: unknown) => e as Error);
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

describe("the stage's link to the account's auth app: its registry on deploy and remove (plan-v0.2.0 §3, §4.1 step 2; DEC-0667)", () => {
  const AUTH = `/accounts/${ACCOUNT}/workers/scripts/prototype-auth/settings`;
  const APP = "notes-prod";
  const URL_ = "https://notes-prod.example.workers.dev/api/auth/callback";
  let fake: FakeD1Api;
  let uuid: string;
  let registry: D1Like;

  beforeAll(async () => {
    fake = await openFakeD1Api({ accountId: ACCOUNT });
    const created = await fake.api("POST", `/accounts/${ACCOUNT}/d1/database`, { name: "prototype-auth" });
    uuid = (created.body as { result: { uuid: string } }).result.uuid;
    registry = fake.database(uuid) as unknown as D1Like;
  }, 60_000);
  afterAll(async () => {
    await fake?.close();
  });

  /** The auth app's settings answered by `settings`; every D1 request goes to the fake D1 HTTP API (local D1). */
  const linkWith = (settings: Reply) => {
    const requests: string[] = [];
    const api: CloudflareApi = async (method, path, body) => {
      requests.push(`${method} ${path}`);
      if (path === AUTH && method === "GET") return settings;
      if (path.startsWith(`/accounts/${ACCOUNT}/d1/`)) return fake.api(method, path, body);
      throw new Error(`unexpected request ${method} ${path}`);
    };
    return { link: cloudflareAuthAppLink(api, ACCOUNT), requests };
  };
  const deployed = () => ok({ bindings: [{ type: "d1", name: "DB", id: uuid }, { type: "secrets_store_secret", name: "AUTH_APP_CLIENT_SECRET" }] });

  it("names the auth app when its Worker is absent, and its registry when the Worker has no DB binding; nothing when both exist", async () => {
    expect(await linkWith(err(404, 10007, "This Worker does not exist on your account.")).link.problems()).toEqual([
      "the account's auth app (Worker prototype-auth) is not deployed; a production stage signs in through it: run account setup in the admin app first",
    ]);
    expect(await linkWith(ok({ bindings: [{ type: "d1", name: "OTHER", id: uuid }] })).link.problems()).toEqual([
      "the account's auth app (Worker prototype-auth) has no registry (its D1 binding DB); run account setup in the admin app again",
    ]);
    expect(await linkWith(deployed()).link.problems()).toEqual([]);
    await expect(linkWith(err(403, 10000, "Authentication error")).link.problems()).rejects.toThrow(/reading the settings of the auth app's Worker prototype-auth failed: HTTP 403/);
  });

  it("register writes the exact (app, return URL) pair the auth app's own lookup then finds; it is idempotent and needs no schema in place", async () => {
    const { link } = linkWith(deployed());
    await link.register(APP, URL_);
    await link.register(APP, URL_);
    expect(await isRegistered(registry, APP, URL_)).toBe(true);
    // Exact match only (plan §4.1 step 2): neither a prefix, another app nor another case is registered.
    expect(await isRegistered(registry, APP, "https://notes-prod.example.workers.dev/api/auth")).toBe(false);
    expect(await isRegistered(registry, "notes-prodx", URL_)).toBe(false);
    expect(await isRegistered(registry, APP, URL_.toUpperCase())).toBe(false);
    const rows = await registry.prepare("SELECT app, return_url FROM registry WHERE app = ?1").bind(APP).all();
    expect(rows.results).toEqual([{ app: APP, return_url: URL_ }]);
  });

  it("register refuses a return URL the auth app could not match (not canonical, or plain http off localhost) and writes nothing", async () => {
    const { link } = linkWith(deployed());
    await expect(link.register("notes-bad", "http://notes-bad.example.workers.dev/api/auth/callback")).rejects.toThrow(/not a valid return URL/);
    await expect(link.register("notes-bad", "https://Notes-Bad.example.workers.dev/api/auth/callback")).rejects.toThrow(/not a valid return URL/);
    expect((await registry.prepare("SELECT 1 FROM registry WHERE app = ?1").bind("notes-bad").all()).results).toEqual([]);
  });

  it("register on an account without the auth app fails naming it, before any D1 request", async () => {
    const { link, requests } = linkWith(err(404, 10007, "This Worker does not exist on your account."));
    await expect(link.register(APP, URL_)).rejects.toThrow(/auth app \(Worker prototype-auth\) is not deployed/);
    expect(requests.filter((r) => r.includes("/d1/"))).toEqual([]);
  });

  it("unregister clears only that app's return URLs and outstanding codes; other apps stay", async () => {
    const { link } = linkWith(deployed());
    await link.register(APP, URL_);
    await link.register("notes-other", "https://notes-other.example.workers.dev/api/auth/callback");
    await registry.prepare("INSERT INTO codes (code_hash, sub, app, return_url, expires_at, used) VALUES ('h1', 's', ?1, ?2, 0, 0)").bind(APP, URL_).run();
    await link.unregister(APP);
    expect(await isRegistered(registry, APP, URL_)).toBe(false);
    expect((await registry.prepare("SELECT 1 FROM codes WHERE app = ?1").bind(APP).all()).results).toEqual([]);
    expect(await isRegistered(registry, "notes-other", "https://notes-other.example.workers.dev/api/auth/callback")).toBe(true);
  });

  it("unregister with the auth app or its registry absent has nothing to clear and sends no D1 request", async () => {
    for (const settings of [err(404, 10007, "This Worker does not exist on your account."), ok({ bindings: [] })]) {
      const { link, requests } = linkWith(settings);
      await link.unregister(APP);
      expect(requests).toEqual([`GET ${AUTH}`]);
    }
  });
});
