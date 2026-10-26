// The live wizard pass's guards (guarded-api.ts), against a fake fetch. No network; fake values only.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureIo } from "../../../../packages/framework/src/cli/io.test-support.js";
import { CloudflareRequestsStopped } from "../../../../packages/framework/src/provision/cloudflare/api.js";
import { runCloudflareSetup } from "../../../../packages/framework/src/provision/cloudflare/cloudflare-setup.js";
import { ACCOUNT_SETUP_VERSION } from "../../../../packages/framework/src/provision/cloudflare/permissions.js";
import { SETUP_STEPS } from "../../../../packages/framework/src/provision/cloudflare/setup-record.js";
import { applySetupSteps } from "../../../../packages/framework/src/provision/cloudflare/setup-steps.js";
import { SetupWorld } from "../../../../packages/framework/src/provision/cloudflare/setup-world.test-support.js";
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

  it("refuses a PUT or DELETE of a token this pass did not create, even a wizard-named one (DEC-0617)", async () => {
    const other = "3".repeat(32);
    const fake = fakeCloudflare({ tokens: [{ id: ENV_TOKEN_ID, name: "admin" }, { id: other, name: `${WIZARD_TOKEN_PREFIX}everyday` }] });
    const { pass } = await start(fake);
    const before = fake.sent.length;
    await expect(pass.api("PUT", `/accounts/${ACCOUNT}/tokens/${other}`, { name: `${WIZARD_TOKEN_PREFIX}everyday`, expires_on: expiry(60_000) })).rejects.toBeInstanceOf(LivePassRefusal);
    await expect(pass.api("DELETE", `/accounts/${ACCOUNT}/tokens/${other}`)).rejects.toBeInstanceOf(LivePassRefusal);
    await expect(pass.apiFor("another-fake-token")("DELETE", `/user/tokens/${other}`)).rejects.toBeInstanceOf(LivePassRefusal);
    expect(fake.sent.length).toBe(before);
  });

  it("lets a PUT and a DELETE of a token this pass created through; the PUT keeps the name and an expiry within 2 hours of creation", async () => {
    const fake = fakeCloudflare();
    const { pass, advance } = await start(fake);
    const created = await pass.api("POST", `/accounts/${ACCOUNT}/tokens`, { name: `${WIZARD_TOKEN_PREFIX}everyday`, expires_on: expiry(MAX_TOKEN_LIFETIME_MS) });
    const id = (created.body as { result: { id: string } }).result.id;
    const path = `/accounts/${ACCOUNT}/tokens/${id}`;
    advance(60 * 60_000);
    const keep = { name: `${WIZARD_TOKEN_PREFIX}everyday`, expires_on: expiry(MAX_TOKEN_LIFETIME_MS) };
    expect((await pass.api("PUT", path, keep)).status).toBe(200);
    expect((await pass.api("PUT", `/accounts/${ACCOUNT}/tokens/${id.toUpperCase()}`, keep)).status).toBe(200);
    await expect(pass.api("PUT", path, { ...keep, name: "prototype-framework" })).rejects.toThrow(/name must stay/);
    await expect(pass.api("PUT", path, { name: keep.name })).rejects.toThrow(/no expires_on/);
    await expect(pass.api("PUT", path, { ...keep, expires_on: expiry(MAX_TOKEN_LIFETIME_MS + 60_000) })).rejects.toThrow(/within 2 hours of the token's creation/);
    await expect(pass.api("PATCH", path, keep)).rejects.toBeInstanceOf(LivePassRefusal);
    await expect(pass.api("PUT", `${path}/value`, {})).rejects.toBeInstanceOf(LivePassRefusal);
    await expect(pass.api("POST", `${path}/value`, {})).rejects.toBeInstanceOf(LivePassRefusal);
    expect((await pass.api("DELETE", path)).status).toBe(200);
  });

  it("refuses every non-GET on a tokens path but a create, a PUT and a DELETE of this pass's token (refusalOf)", () => {
    const owned = new Map([["9".repeat(32), { createdAtMs: NOW }]]);
    for (const [method, path] of [
      ["DELETE", `/accounts/${ACCOUNT}/tokens`],
      ["PUT", `/accounts/${ACCOUNT}/tokens`],
      ["POST", `/accounts/${ACCOUNT}/tokens/${"9".repeat(32)}`],
      ["DELETE", `/accounts/${ACCOUNT}/tokens/${"9".repeat(32)}/value`],
      ["DELETE", `/accounts/${ACCOUNT}/tokens/${"8".repeat(32)}`],
    ] as const) expect(refusalOf(method, path, {}, new Set(), NOW, owned), `${method} ${path.replace(ACCOUNT, "<a>")}`).toBeDefined();
    expect(refusalOf("DELETE", `/user/tokens/${"9".repeat(32)}`, undefined, new Set(), NOW, owned)).toBeUndefined();
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

describe("the network check's requests (reach, DEC-0619)", () => {
  it("counts each HEAD in the budget and refuses it once the budget is used; the stop is a CloudflareRequestsStopped", async () => {
    const fake = fakeCloudflare();
    const { pass } = await start(fake, { limits: { perPass: 4 } });
    await pass.reach("https://api.cloudflare.com/client/v4/");
    expect(fake.sent.at(-1)).toMatchObject({ method: "HEAD", auth: null });
    expect(pass.calls().pass).toBe(3);
    await pass.api("GET", "/zones");
    const stopped = pass.reach(`https://${SUBDOMAIN}.workers.dev/`);
    await expect(stopped).rejects.toBeInstanceOf(LivePassStopped);
    await expect(stopped).rejects.toBeInstanceOf(CloudflareRequestsStopped);
    expect(fake.sent).toHaveLength(4);
  });

  it("sends nothing after a 429 stop, and a 429 answer to a HEAD stops the pass", async () => {
    const fake = fakeCloudflare({ status429After: 3 });
    const { pass } = await start(fake);
    await pass.reach("https://api.cloudflare.com/client/v4/");
    await expect(pass.reach("https://api.cloudflare.com/client/v4/")).rejects.toThrow(/HTTP 429 on HEAD/);
    await expect(pass.reach(`https://${ACCOUNT}.r2.cloudflarestorage.com/`)).rejects.toThrow(/stopped earlier/);
    await expect(pass.api("GET", "/zones")).rejects.toBeInstanceOf(LivePassStopped);
    expect(fake.sent).toHaveLength(4);
  });

  it("rejects, like the framework's reach, when the host gives no answer", async () => {
    const fake = fakeCloudflare();
    const failing = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (String(input).includes(".workers.dev")) throw new TypeError("fetch failed");
      return fake.fetch(input, init);
    }) as typeof fetch;
    const { pass } = await start(fake, { fetch: failing });
    const err = await pass.reach(`https://${SUBDOMAIN}.workers.dev/`).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(pass.stopReason()).toBeUndefined();
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

describe("a whole cloudflare-setup run through the pass, the environment token as the bootstrap token", () => {
  /** `fetch` onto the framework's fake Cloudflare world: each API request answered as its bearer token would; any HEAD answered. */
  function worldFetch(world: SetupWorld) {
    const sent: string[] = [];
    const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? "GET";
      const path = url.pathname.replace(/^\/client\/v4/, "");
      sent.push(`${method} ${url.hostname === "api.cloudflare.com" ? path : "<host>"}`);
      if (method === "HEAD") return new Response(null, { status: 200 });
      const token = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const reply = await world.apiFor(token)(method as Parameters<ReturnType<SetupWorld["apiFor"]>>[0], `${path}${url.search}`, body);
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { fetch: fetchFn, sent };
  }

  it("skips the self-delete of the protected token: no DELETE sent, its line kept, exit 0 with the note", async () => {
    const world = new SetupWorld();
    const cloud = world.cloud(ACCOUNT);
    cloud.subdomain = undefined;
    const email = { sleep: async () => {} };
    await applySetupSteps(cloud.api, ACCOUNT, { emailDomain: "example.test", steps: SETUP_STEPS, setupVersion: ACCOUNT_SETUP_VERSION, frameworkVersion: "0.0.0-test", now: () => new Date(NOW), newSubdomain: () => SUBDOMAIN, email });
    world.addToken("bootstrap", ENV_TOKEN, ENV_TOKEN_ID);
    const everyday = "fake-everyday-token-value-MARKER-00000000";
    world.addToken("everyday", everyday, "1".repeat(32));
    const dir = mkdtempSync(join(tmpdir(), "live-wizard-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
      writeFileSync(join(dir, ".gitignore"), ".env.cloudflare\n");
      writeFileSync(join(dir, ".env.cloudflare"), `CLOUDFLARE_BOOTSTRAP_TOKEN=${ENV_TOKEN}\nCLOUDFLARE_API_TOKEN=${everyday}\nCLOUDFLARE_EMAIL_DOMAIN=example.test\n`);
      const fake = worldFetch(world);
      const { pass } = await start({ ...fakeCloudflare(), fetch: fake.fetch });
      const io = captureIo(dir);
      const status = await runCloudflareSetup(
        {
          projectDir: dir,
          env: {},
          apiFor: pass.apiFor,
          reach: pass.reach,
          protectedTokenIds: pass.protectedTokenIds,
          localSetup: async () => [],
          stepOptions: { newSubdomain: () => SUBDOMAIN, email },
          frameworkVersion: "0.0.0-test",
          now: () => new Date(NOW),
        },
        {},
        pass.redactingIo(io),
      );
      expect(io.err).toBe("");
      expect(status).toBe(0);
      expect(io.out).toContain("note: the bootstrap token is protected, so setup did not delete it");
      expect(io.out).toContain("Next step: deploy a test stage");
      expect(fake.sent.filter((s) => s.startsWith("DELETE "))).toEqual([]);
      expect(world.token(ENV_TOKEN_ID).deleted).toBe(false);
      expect(readFileSync(join(dir, ".env.cloudflare"), "utf8").startsWith(`CLOUDFLARE_BOOTSTRAP_TOKEN=${ENV_TOKEN}\n`)).toBe(true);
      expect(pass.stopReason()).toBeUndefined();
      expect(io.out + io.err).not.toContain("MARKER");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
