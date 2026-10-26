// The live wizard pass's guards (guarded-api.ts), against a fake fetch. No network; fake values only.
import { describe, expect, it } from "vitest";
import { LivePassRefusal, LivePassStopped, MAX_TOKEN_LIFETIME_MS, refusalOf, startLivePass, WIZARD_TOKEN_PREFIX, type LivePassOptions } from "./guarded-api.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const ENV_TOKEN = "fake-env-token-value-MARKER-0000000000000";
const ENV_TOKEN_ID = "aaaaaaaabbbbbbbbccccccccdddddddd";
const SUBDOMAIN = "pf-fakesubdomain";
const ZONE_ID = "eeeeeeeeffffffff0000000011111111";
const NOW = Date.parse("2026-10-26T12:00:00Z");

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly auth: string | null;
}

interface FakeToken {
  id: string;
  name: string;
}

/** A small fake of the Cloudflare API: verify, subdomain, zones, account tokens (list, create, delete). */
function fakeCloudflare(options: { readonly tokens?: FakeToken[]; readonly status429After?: number } = {}) {
  const sent: Sent[] = [];
  const tokens: FakeToken[] = options.tokens ?? [{ id: ENV_TOKEN_ID, name: "admin" }];
  let created = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/client\/v4/, "");
    sent.push({ method, path: `${path}${url.search}`, auth: new Headers(init?.headers).get("authorization") });
    if (options.status429After !== undefined && sent.length > options.status429After) return json(429, { success: false, errors: [{ code: 971, message: "rate limited" }] });
    if (path === `/accounts/${ACCOUNT}/tokens/verify`) return json(200, { success: true, result: { id: ENV_TOKEN_ID, status: "active" } });
    if (path === `/accounts/${ACCOUNT}/workers/subdomain`) return json(200, { success: true, result: { subdomain: SUBDOMAIN } });
    if (path === "/zones") return json(200, { success: true, result: [{ id: ZONE_ID, name: "example.test" }] });
    if (path === `/accounts/${ACCOUNT}/tokens` && method === "GET") return json(200, { success: true, result: tokens.map((t) => ({ ...t })), result_info: { total_pages: 1 } });
    if (path === `/accounts/${ACCOUNT}/tokens` && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { name: string };
      created++;
      const t = { id: `${String(created).padStart(2, "0")}${"9".repeat(30)}`, name: body.name };
      tokens.push(t);
      return json(200, { success: true, result: { ...t, value: `created-token-value-${String(created)}-xxxxxxxxxxxx` } });
    }
    const del = new RegExp(`^/accounts/${ACCOUNT}/tokens/([^/]+)$`).exec(path);
    if (del !== null && method === "DELETE") {
      const i = tokens.findIndex((t) => t.id === del[1]);
      if (i < 0) return json(404, { success: false, errors: [] });
      tokens.splice(i, 1);
      return json(200, { success: true, result: { id: del[1] } });
    }
    if (del !== null && method === "PUT") return json(200, { success: true, result: { id: del[1] } });
    return json(200, { success: true, result: [] });
  }) as typeof fetch;
  return { fetch: fetchFn, sent, tokens };
}

async function start(fake: ReturnType<typeof fakeCloudflare>, extra: Partial<LivePassOptions> = {}) {
  const lines: string[] = [];
  let clock = NOW;
  const pass = await startLivePass({ accountId: ACCOUNT, envToken: ENV_TOKEN, fetch: fake.fetch, now: () => clock, log: (l) => lines.push(l), ...extra });
  return { pass, lines, advance: (ms: number) => (clock += ms) };
}

const expiry = (ms: number) => new Date(NOW + ms).toISOString().replace(/\.\d{3}Z$/, "Z");

describe("live pass start", () => {
  it("reads the environment token's own ID and the subdomain first, and protects the ID", async () => {
    const fake = fakeCloudflare();
    const { pass } = await start(fake);
    expect(fake.sent.map((s) => s.path)).toEqual([`/accounts/${ACCOUNT}/tokens/verify`, `/accounts/${ACCOUNT}/workers/subdomain`]);
    expect(pass.protectedTokenIds).toEqual([ENV_TOKEN_ID]);
    expect(pass.envTokenStatus).toEqual({ status: "active", hasExpiry: false });
  });

  it("refuses to start when the token cannot be verified as an account token", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ success: false, errors: [{ code: 1000, message: "Invalid API Token" }] }), { status: 400 })) as typeof fetch;
    await expect(startLivePass({ accountId: ACCOUNT, envToken: ENV_TOKEN, fetch: fetchFn, log: () => undefined })).rejects.toBeInstanceOf(LivePassRefusal);
  });
});

describe("protected token guard", () => {
  for (const [method, path] of [
    ["DELETE", `/accounts/${ACCOUNT}/tokens/${ENV_TOKEN_ID}`],
    ["PUT", `/accounts/${ACCOUNT}/tokens/${ENV_TOKEN_ID}`],
    ["PUT", `/accounts/${ACCOUNT}/tokens/${ENV_TOKEN_ID}/value`],
    ["DELETE", `/user/tokens/${ENV_TOKEN_ID}`],
    ["PUT", `/user/tokens/${ENV_TOKEN_ID.toUpperCase()}`],
    ["DELETE", `/accounts/${ACCOUNT}/tokens/${ENV_TOKEN_ID}?x=1`],
  ] as const) {
    it(`refuses ${method} ${path.replace(ACCOUNT, "<a>").replace(ENV_TOKEN_ID, "<id>")} without sending it`, async () => {
      const fake = fakeCloudflare();
      const { pass } = await start(fake);
      const before = fake.sent.length;
      const error = await pass.api(method, path, method === "PUT" ? { name: "admin" } : undefined).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LivePassRefusal);
      expect(String((error as Error).message)).not.toContain(ENV_TOKEN_ID);
      expect(String((error as Error).message)).not.toContain(ACCOUNT);
      expect(fake.sent.length).toBe(before);
    });
  }

  it("judges the path the URL parser sends: dot segments, backslashes, tabs and newlines, encoded segments (DEC-0615)", async () => {
    const fake = fakeCloudflare();
    const { pass } = await start(fake);
    const before = fake.sent.length;
    const ids = new Set([ENV_TOKEN_ID]);
    for (const [method, path] of [
      ["DELETE", `/accounts/${ACCOUNT}/x/../tokens/${ENV_TOKEN_ID}`],
      ["DELETE", `/accounts/${ACCOUNT}/tokens\\${ENV_TOKEN_ID}`],
      ["DELETE", `/accounts/${ACCOUNT}/tok\tens/${ENV_TOKEN_ID}`],
      ["DELETE", `/accounts/${ACCOUNT}/tokens/${ENV_TOKEN_ID.slice(0, 4)}\n${ENV_TOKEN_ID.slice(4)}`],
      ["DELETE", `/user/./tokens/${ENV_TOKEN_ID}`],
      ["DELETE", `/accounts/${ACCOUNT}/%74okens/${ENV_TOKEN_ID}`],
      ["DELETE", `/accounts/${ACCOUNT}/tokens/x/%2e%2e/${ENV_TOKEN_ID}`],
      ["DELETE", `/accounts/${ACCOUNT}/tokens%2F${ENV_TOKEN_ID}`],
      ["DELETE", `/accounts/${ACCOUNT}/tokens/%2561${ENV_TOKEN_ID.slice(1)}`],
      ["DELETE", `/../../accounts/${ACCOUNT}/tokens/${ENV_TOKEN_ID}`],
      ["PUT", `/accounts/${ACCOUNT}/TOKENS/${ENV_TOKEN_ID}/value`],
    ] as const) {
      expect(refusalOf(method, path, undefined, ids, NOW), JSON.stringify(path.replace(ACCOUNT, "<a>"))).toMatch(/protected/);
      await expect(pass.api(method, path)).rejects.toBeInstanceOf(LivePassRefusal);
    }
    expect(fake.sent.length).toBe(before);
    // A create reached by another spelling is still a create, so its name and expiry are checked.
    for (const path of [`/accounts/${ACCOUNT}/tokens/x/..`, `/accounts/${ACCOUNT}/tokens/.`, `/user/x/../tokens`, `/accounts/${ACCOUNT}/%74okens`]) {
      expect(refusalOf("POST", path, { name: "prototype-framework", expires_on: expiry(60_000) }, ids, NOW), path.replace(ACCOUNT, "<a>")).toMatch(/name must be/);
    }
  });

  it("refuses an extra protected ID, through apiFor's API with another token too", async () => {
    const fake = fakeCloudflare();
    const other = "12121212121212121212121212121212";
    const { pass } = await start(fake, { protectedTokenIds: [other] });
    expect(pass.protectedTokenIds).toEqual(expect.arrayContaining([other, ENV_TOKEN_ID]));
    await expect(pass.apiFor("another-fake-token")("DELETE", `/accounts/${ACCOUNT}/tokens/${other}`)).rejects.toBeInstanceOf(LivePassRefusal);
    await expect(pass.apiFor("another-fake-token")("DELETE", `/accounts/${ACCOUNT}/tokens/${ENV_TOKEN_ID}`)).rejects.toBeInstanceOf(LivePassRefusal);
  });

  it("lets a DELETE and a PUT of another token through", async () => {
    const fake = fakeCloudflare({ tokens: [{ id: ENV_TOKEN_ID, name: "admin" }, { id: "3".repeat(32), name: `${WIZARD_TOKEN_PREFIX}everyday` }] });
    const { pass } = await start(fake);
    expect((await pass.api("PUT", `/accounts/${ACCOUNT}/tokens/${"3".repeat(32)}`, { name: `${WIZARD_TOKEN_PREFIX}everyday` })).status).toBe(200);
    expect((await pass.api("DELETE", `/accounts/${ACCOUNT}/tokens/${"3".repeat(32)}`)).status).toBe(200);
  });

  it("does not guard GETs or other paths", () => {
    const ids = new Set([ENV_TOKEN_ID]);
    expect(refusalOf("GET", `/accounts/${ACCOUNT}/tokens/${ENV_TOKEN_ID}`, undefined, ids, NOW)).toBeUndefined();
    expect(refusalOf("PUT", `/accounts/${ACCOUNT}/workers/scripts/x`, {}, ids, NOW)).toBeUndefined();
  });
});

describe("token create guard", () => {
  const create = (body: unknown) => refusalOf("POST", `/accounts/${ACCOUNT}/tokens`, body, new Set(), NOW);

  it("allows a wizard-named token expiring within 2 hours", () => {
    expect(create({ name: `${WIZARD_TOKEN_PREFIX}everyday`, expires_on: expiry(MAX_TOKEN_LIFETIME_MS) })).toBeUndefined();
    expect(refusalOf("POST", "/user/tokens", { name: `${WIZARD_TOKEN_PREFIX}u1`, expires_on: expiry(60_000) }, new Set(), NOW)).toBeUndefined();
  });

  it("refuses another name", () => {
    for (const name of ["prototype-framework", "prototype-r2-signing", "prototype-compliance-wizard-", "x-prototype-compliance-wizard-a", `${WIZARD_TOKEN_PREFIX}UPPER`, undefined]) {
      expect(create({ name, expires_on: expiry(60_000) })).toMatch(/name must be/);
    }
  });

  it("refuses no expiry, a past one and one beyond 2 hours", () => {
    const name = `${WIZARD_TOKEN_PREFIX}everyday`;
    expect(create({ name })).toMatch(/no expires_on/);
    expect(create({ name, expires_on: "soon" })).toMatch(/no expires_on/);
    expect(create({ name, expires_on: expiry(-1_000) })).toMatch(/within 2 hours/);
    expect(create({ name, expires_on: expiry(MAX_TOKEN_LIFETIME_MS + 1_000) })).toMatch(/within 2 hours/);
  });

  it("sends nothing for a refused create", async () => {
    const fake = fakeCloudflare();
    const { pass } = await start(fake);
    const before = fake.sent.length;
    await expect(pass.api("POST", `/accounts/${ACCOUNT}/tokens`, { name: "prototype-framework", policies: [] })).rejects.toBeInstanceOf(LivePassRefusal);
    await expect(pass.api("POST", `/accounts/${ACCOUNT}/tokens`, { name: `${WIZARD_TOKEN_PREFIX}a`, expires_on: expiry(3 * 60 * 60_000) })).rejects.toBeInstanceOf(LivePassRefusal);
    expect(fake.sent.length).toBe(before);
  });
});

describe("budget", () => {
  it("stops the pass at the per-pass limit", async () => {
    const fake = fakeCloudflare();
    const { pass } = await start(fake, { limits: { perPass: 5 } });
    for (let i = 0; i < 3; i++) await pass.api("GET", "/zones");
    await expect(pass.api("GET", "/zones")).rejects.toBeInstanceOf(LivePassStopped);
    expect(fake.sent).toHaveLength(5);
    expect(pass.stopReason()).toMatch(/budget of 5/);
    await expect(pass.apiFor("another-fake-token")("GET", "/zones")).rejects.toBeInstanceOf(LivePassStopped);
  });

  it("stops at the rolling window limit, counting only the last window", async () => {
    const fake = fakeCloudflare();
    const { pass, advance } = await start(fake, { limits: { perWindow: 4, windowMs: 60_000 } });
    await pass.api("GET", "/zones");
    advance(61_000);
    // The 3 calls of the first window have aged out.
    for (let i = 0; i < 4; i++) await pass.api("GET", "/zones");
    expect(pass.calls()).toEqual({ pass: 7, window: 4 });
    await expect(pass.api("GET", "/zones")).rejects.toBeInstanceOf(LivePassStopped);
    expect(fake.sent).toHaveLength(7);
  });

  it("uses the defaults of 2,000 per pass and 1,000 per 5 minutes", async () => {
    const fake = fakeCloudflare();
    const { pass } = await start(fake);
    for (let i = 0; i < 998; i++) await pass.api("GET", "/zones");
    await expect(pass.api("GET", "/zones")).rejects.toThrow(/1000 calls in 5 minutes/);
    expect(fake.sent).toHaveLength(1_000);
  });

  it("stops the pass on a 429", async () => {
    const fake = fakeCloudflare({ status429After: 3 });
    const { pass } = await start(fake);
    await pass.api("GET", "/zones");
    await expect(pass.api("GET", "/zones")).rejects.toBeInstanceOf(LivePassStopped);
    await expect(pass.api("GET", "/zones")).rejects.toThrow(/stopped earlier/);
    expect(fake.sent).toHaveLength(4);
  });
});

describe("redaction", () => {
  it("removes token values, account ID, zone IDs, token IDs and the subdomain", async () => {
    const fake = fakeCloudflare();
    const { pass, lines } = await start(fake, { secrets: ["fake-bootstrap-value-zzzz"] });
    await pass.api("GET", "/zones");
    const created = await pass.api("POST", `/accounts/${ACCOUNT}/tokens`, { name: `${WIZARD_TOKEN_PREFIX}everyday`, expires_on: expiry(60_000) });
    const createdBody = JSON.stringify(created.body);
    const text = `${ENV_TOKEN} ${ACCOUNT} ${ZONE_ID} ${ENV_TOKEN_ID} https://app-prod.${SUBDOMAIN}.workers.dev ${SUBDOMAIN} fake-bootstrap-value-zzzz ${createdBody}`;
    pass.print(text);
    const out = lines.join("\n");
    for (const secret of [ENV_TOKEN, ACCOUNT, ZONE_ID, ENV_TOKEN_ID, SUBDOMAIN, "fake-bootstrap-value-zzzz", "created-token-value-1", "MARKER"]) expect(out).not.toContain(secret);
    expect(out).toContain(`${WIZARD_TOKEN_PREFIX}everyday`);
    expect(out).toContain("app-prod.<subdomain>.workers.dev");
  });

  it("redacts a value given to apiFor, an unknown 32-hex ID and another workers.dev subdomain", async () => {
    const fake = fakeCloudflare();
    const { pass } = await start(fake);
    pass.apiFor("fake-bootstrap-token-value-yyyy");
    expect(pass.redact("fake-bootstrap-token-value-yyyy 9f8e7d6c5b4a39281706f5e4d3c2b1a0 a-b.other-sub.workers.dev")).toBe("<token-value> <id> a-b.<subdomain>.workers.dev");
  });

  it("redacts a ProvisionIo's output", async () => {
    const fake = fakeCloudflare();
    const { pass } = await start(fake);
    const out: string[] = [];
    const io = pass.redactingIo({ stdout: (t: string) => out.push(t), stderr: (t: string) => out.push(t) });
    io.stdout(`token ${ENV_TOKEN}\n`);
    io.stderr(`account ${ACCOUNT}\n`);
    expect(out.join("")).not.toMatch(new RegExp(`${ENV_TOKEN}|${ACCOUNT}`));
  });

  it("sends each token's own value as its bearer", async () => {
    const fake = fakeCloudflare();
    const { pass } = await start(fake);
    await pass.apiFor("another-fake-token")("GET", "/zones");
    expect(fake.sent.at(-1)?.auth).toBe("Bearer another-fake-token");
    expect(fake.sent[0]?.auth).toBe(`Bearer ${ENV_TOKEN}`);
  });
});

describe("cleanup", () => {
  it("deletes only prototype-compliance-wizard-* tokens, never the protected one, and prints only names", async () => {
    const tokens: FakeToken[] = [
      { id: ENV_TOKEN_ID, name: `${WIZARD_TOKEN_PREFIX}looks-like-mine` },
      { id: "4".repeat(32), name: `${WIZARD_TOKEN_PREFIX}everyday` },
      { id: "5".repeat(32), name: `${WIZARD_TOKEN_PREFIX}bootstrap` },
      { id: "6".repeat(32), name: "prototype-compliance-run1-no-email" },
      { id: "7".repeat(32), name: "prototype-r2-signing" },
      { id: "8".repeat(32), name: "admin" },
    ];
    const fake = fakeCloudflare({ tokens });
    const { pass, lines } = await start(fake);
    const remaining = await pass.cleanup();
    const deletes = fake.sent.filter((s) => s.method === "DELETE").map((s) => s.path.split("/").at(-1));
    expect(deletes).toEqual(["4".repeat(32), "5".repeat(32)]);
    expect(fake.tokens.map((t) => t.name)).toEqual([`${WIZARD_TOKEN_PREFIX}looks-like-mine`, "prototype-compliance-run1-no-email", "prototype-r2-signing", "admin"]);
    expect(remaining).toEqual([`${WIZARD_TOKEN_PREFIX}looks-like-mine`]);
    const out = lines.join("\n");
    expect(out).toContain(`deleted ${WIZARD_TOKEN_PREFIX}everyday: yes`);
    expect(out).toContain(`still listed: ${WIZARD_TOKEN_PREFIX}looks-like-mine`);
    expect(out).not.toMatch(/[0-9a-f]{32}/);
  });

  it("prints none when nothing is left", async () => {
    const fake = fakeCloudflare({ tokens: [{ id: ENV_TOKEN_ID, name: "admin" }, { id: "4".repeat(32), name: `${WIZARD_TOKEN_PREFIX}everyday` }] });
    const { pass, lines } = await start(fake);
    expect(await pass.cleanup()).toEqual([]);
    expect(lines.at(-1)).toBe(`cleanup: ${WIZARD_TOKEN_PREFIX}* tokens still listed: none`);
    expect(fake.tokens.map((t) => t.name)).toEqual(["admin"]);
  });
});
