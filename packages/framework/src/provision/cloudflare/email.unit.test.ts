/**
 * The Cloudflare email setup (PROV-REQ-004 amendment, MAIL-REQ-005, DEC-0514, DEC-0515; item
 * I-F) against the in-memory Cloudflare account: every step, idempotency, polling, the
 * permission check and the production preflight. No network.
 */
import { describe, expect, it } from "vitest";
import { MAIL_SINK_SOURCE } from "../../mail/sink-worker.js";
import {
  createCloudflareEmailSetup,
  RULE_SETTLE_MS,
  isWantedLifecycle,
  MAIL_SINK_LIFECYCLE_RULE_ID,
  mailSinkTag,
  sameDnsRecord,
  sinkAddress,
  sinkRouteAddress,
  zoneCandidates,
  type EmailSetupOptions,
} from "./email.js";
import { ACCOUNT, FakeCloud, FULL_POLICIES } from "./fake-cloud.test-support.js";

const DOMAIN = "example.test";

function setup(cloud = FakeCloud.withSharedResources(), overrides: Partial<EmailSetupOptions> = {}) {
  let clock = 0;
  const email = createCloudflareEmailSetup({
    api: cloud.api,
    accountId: ACCOUNT,
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
    pollTimeoutMs: 60_000,
    pollIntervalMs: 5_000,
    ...overrides,
  });
  return { cloud, email };
}

const zoneOf = (cloud: FakeCloud) => cloud.zones.get(DOMAIN)!;
const writes = (cloud: FakeCloud) => cloud.requests.filter((r) => !r.startsWith("GET "));

describe("CloudflareEmailSetup.setUp (MAIL-REQ-005, PROV-REQ-004)", () => {
  it("[MAIL-AC-007] [PROV-AC-004] unit part: creates each part once, and a second run sends only reads and changes nothing", async () => {
    const { cloud, email } = setup();
    const zone = zoneOf(cloud);
    expect(await email.setUp(DOMAIN)).toEqual([
      "Email Sending entry example.test",
      "R2 bucket prototype-mailsink",
      "lifecycle rule of R2 bucket prototype-mailsink (PAR-241)",
      "Worker prototype-mailsink",
      "Email Routing on t.example.test",
      "Email Routing subaddressing",
      "routing rule sink@t.example.test → Worker prototype-mailsink",
    ]);
    expect(writes(cloud)).toEqual([
      `POST /zones/${zone.id}/email/sending/subdomains`,
      `POST /accounts/${ACCOUNT}/r2/buckets`,
      `PUT /accounts/${ACCOUNT}/r2/buckets/prototype-mailsink/lifecycle`,
      `PUT /accounts/${ACCOUNT}/workers/scripts/prototype-mailsink`,
      `POST /zones/${zone.id}/email/routing/dns`,
      `PATCH /zones/${zone.id}/email/routing`,
      `POST /zones/${zone.id}/email/routing/rules`,
    ]);

    cloud.requests.length = 0;
    const again = createCloudflareEmailSetup({ api: cloud.api, accountId: ACCOUNT });
    expect(await again.setUp(DOMAIN)).toEqual([]);
    expect(writes(cloud)).toEqual([]);
    expect(cloud.requests.length).toBeLessThanOrEqual(10);
  });

  it("onboards the domain itself for Email Sending, and only when no entry of that name exists", async () => {
    const { cloud, email } = setup();
    const zone = zoneOf(cloud);
    await email.setUp(DOMAIN);
    expect(zone.sending.map((e) => ({ name: e.name, enabled: e.enabled }))).toEqual([{ name: DOMAIN, enabled: true }]);

    // An account onboarded outside the framework (as shareplay.com was on 2026-10-25) is left as it is.
    const other = setup();
    zoneOf(other.cloud).sending.push({ id: "existing", name: DOMAIN, enabled: true, pollsUntilEnabled: 0 });
    expect(await other.email.setUp(DOMAIN)).not.toContain("Email Sending entry example.test");
    expect(other.cloud.requests).not.toContain(`POST /zones/${zoneOf(other.cloud).id}/email/sending/subdomains`);
  });

  it("polls a new sending entry until it is enabled, and stops with a message when it never is", async () => {
    const { cloud, email } = setup();
    cloud.sendingPolls = 3;
    await email.setUp(DOMAIN);
    const zone = zoneOf(cloud);
    const id = zone.sending[0]!.id;
    expect(cloud.requests.filter((r) => r === `GET /zones/${zone.id}/email/sending/subdomains/${id}`)).toHaveLength(3);

    const stuck = setup();
    stuck.cloud.sendingPolls = 1_000;
    await expect(stuck.email.setUp(DOMAIN)).rejects.toThrow(/Email Sending entry example\.test: still not enabled \(not verified\) after 60 s; run setup-account again later/);
  });

  it("enables Email Routing through t.<domain> only, never through the apex enable or catch-all calls, and waits for its MX and SPF records", async () => {
    const { cloud, email } = setup();
    cloud.routingPolls = 2;
    await email.setUp(DOMAIN);
    const zone = zoneOf(cloud);
    expect([...zone.routedSubdomains]).toEqual(["t.example.test"]);
    expect(cloud.requests.filter((r) => r.includes("/email/routing/enable") || r.includes("catch_all"))).toEqual([]);
    expect(cloud.requests.filter((r) => r === `GET /zones/${zone.id}/email/routing/dns?subdomain=t.example.test`).length).toBeGreaterThanOrEqual(3);
    // The pre-existing disabled catch-all rule (the live zone has one) is untouched.
    expect(zone.rules[0]).toMatchObject({ enabled: false, matchers: [{ type: "all" }], actions: [{ type: "drop" }] });
  });

  it("routes sink@t.<domain> to the sink Worker with subaddressing on, so sink+<tag>@t.<domain> reaches it", async () => {
    const { cloud, email } = setup();
    await email.setUp(DOMAIN);
    const zone = zoneOf(cloud);
    expect(zone.supportSubaddress).toBe(true);
    expect(zone.rules.slice(1)).toEqual([
      {
        id: expect.any(String),
        name: "framework mail sink (prototype-mailsink)",
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: "sink@t.example.test" }],
        actions: [{ type: "worker", value: ["prototype-mailsink"] }],
      },
    ]);
    expect(sinkRouteAddress(DOMAIN)).toBe("sink@t.example.test");
    expect(sinkAddress(DOMAIN, "run-1a2b")).toBe("sink+run-1a2b@t.example.test");
    expect(() => sinkAddress(DOMAIN, "Bad Tag")).toThrow(/tag/);
  });

  it("repairs a sink rule that was disabled or points elsewhere, with one update", async () => {
    const { cloud, email } = setup();
    await email.setUp(DOMAIN);
    const zone = zoneOf(cloud);
    const rule = zone.rules[1]!;
    rule.enabled = false;
    cloud.requests.length = 0;
    expect(await email.setUp(DOMAIN)).toEqual(["routing rule sink@t.example.test → Worker prototype-mailsink"]);
    expect(writes(cloud)).toEqual([`PUT /zones/${zone.id}/email/routing/rules/${rule.id}`]);
    expect(zone.rules[1]!.enabled).toBe(true);
  });

  it("creates the sink bucket with the PAR-241 lifecycle rule, keeping R2's default rule", async () => {
    const { cloud, email } = setup();
    await email.setUp(DOMAIN);
    const rules = cloud.lifecycles.get("prototype-mailsink")!;
    expect(rules).toContainEqual({ id: MAIL_SINK_LIFECYCLE_RULE_ID, enabled: true, conditions: { prefix: "" }, deleteObjectsTransition: { condition: { type: "Age", maxAge: 86_400 } } });
    expect(rules.map((r) => (r as { id: string }).id)).toContain("Default Multipart Abort Rule");
    expect(isWantedLifecycle(rules)).toBe(true);
    expect(isWantedLifecycle([{ id: MAIL_SINK_LIFECYCLE_RULE_ID, enabled: true, conditions: { prefix: "" }, deleteObjectsTransition: { condition: { type: "Age", maxAge: 7 * 86_400 } } }])).toBe(false);
  });

  it("a sink bucket of another account stops the setup before the Worker or routing", async () => {
    const { cloud, email } = setup();
    cloud.override.set(`GET /accounts/${ACCOUNT}/r2/buckets/prototype-mailsink`, { status: 403, body: { success: false, errors: [{ code: 10003, message: "Access denied" }] } });
    await expect(email.setUp(DOMAIN)).rejects.toThrow(/R2 bucket prototype-mailsink already exists but belongs to another account/);
    expect(cloud.workers.has("prototype-mailsink")).toBe(false);
    expect(zoneOf(cloud).routedSubdomains.size).toBe(0);
  });

  it("uploads the sink Worker exactly as tested, bound to its bucket, and again only when the source changed", async () => {
    const { cloud, email } = setup();
    await email.setUp(DOMAIN);
    const worker = cloud.workers.get("prototype-mailsink")!;
    expect(worker.bindings).toEqual([{ type: "r2_bucket", name: "MAILSINK", bucket_name: "prototype-mailsink" }]);
    expect(worker.tags).toEqual([mailSinkTag()]);
    expect(worker.modules!.get("mailsink.js")).toBe(MAIL_SINK_SOURCE);

    worker.tags = ["framework-mailsink-0000000000000000"];
    cloud.requests.length = 0;
    expect(await email.setUp(DOMAIN)).toEqual(["Worker prototype-mailsink"]);
    expect(writes(cloud)).toEqual([`PUT /accounts/${ACCOUNT}/workers/scripts/prototype-mailsink`]);
  });

  describe("Email Routing readiness, replaying the live answers of 2026-10-25 (DEC-0527)", () => {
    const sub = `t.${DOMAIN}`;
    const dnsGet = (cloud: FakeCloud) => `GET /zones/${zoneOf(cloud).id}/email/routing/dns?subdomain=${encodeURIComponent(sub)}`;
    // The exact live body after the records existed, with the domain replaced by the reserved test domain (MAIL-AC-005).
    const LIVE_DNS_BODY = JSON.parse(
      `{"success":true,"errors":[],"result":{"errors":null,"records":[{"name":"${sub}","content":"route1.mx.cloudflare.net.","type":"MX","priority":96,"ttl":1},{"name":"${sub}","content":"route2.mx.cloudflare.net.","type":"MX","priority":97,"ttl":1},{"name":"${sub}","content":"route3.mx.cloudflare.net.","type":"MX","priority":97,"ttl":1},{"name":"${sub}","content":"\\"v=spf1 include:_spf.mx.cloudflare.net ~all\\"","type":"TXT","ttl":1}]}}`,
    ) as unknown;

    /** The account as the failed live run left it: sending, bucket, lifecycle, Worker and the `t.` records exist, routing is on zone-wide, subaddressing is off and there is no sink rule. */
    async function liveState() {
      const { cloud, email } = setup();
      await email.setUp(DOMAIN);
      const zone = zoneOf(cloud);
      zone.supportSubaddress = false;
      zone.rules.splice(1);
      expect(zone.routingEnabled).toBe(true);
      expect(zone.dnsRecords.map((r) => `${r.name} ${r.type}`)).toEqual([`${sub} MX`, `${sub} MX`, `${sub} MX`, `${sub} TXT`, `${DOMAIN} TXT`, `cf2024-1._domainkey.${DOMAIN} TXT`]);
      cloud.override.set(dnsGet(cloud), { status: 200, body: LIVE_DNS_BODY });
      cloud.requests.length = 0;
      return cloud;
    }

    it("the re-run accepts the live object answer, sends no routing POST, and does only subaddressing and the sink rule; a further run is GET-only", async () => {
      const cloud = await liveState();
      const zone = zoneOf(cloud);
      const rerun = setup(cloud).email;
      expect(await rerun.setUp(DOMAIN)).toEqual(["Email Routing subaddressing", "routing rule sink@t.example.test → Worker prototype-mailsink"]);
      expect(writes(cloud)).toEqual([`PATCH /zones/${zone.id}/email/routing`, `POST /zones/${zone.id}/email/routing/rules`]);
      expect(cloud.requests).toContain(`GET /zones/${zone.id}/dns_records?name=${sub}&per_page=100&page=1`);

      cloud.requests.length = 0;
      expect(await setup(cloud).email.setUp(DOMAIN)).toEqual([]);
      expect(writes(cloud)).toEqual([]);
      expect(cloud.requests.every((r) => r.startsWith("GET "))).toBe(true);
    });

    it("records listed by the routing API but absent from the zone's DNS are missing: one POST, then polled until the zone has them", async () => {
      const { cloud, email } = setup();
      cloud.routingPolls = 2;
      cloud.override.set(dnsGet(cloud), { status: 200, body: LIVE_DNS_BODY });
      expect(await email.setUp(DOMAIN)).toContain("Email Routing on t.example.test");
      const zone = zoneOf(cloud);
      expect(cloud.requests.filter((r) => r === `POST /zones/${zone.id}/email/routing/dns`)).toHaveLength(1);
      expect(cloud.requests.filter((r) => r.startsWith(`GET /zones/${zone.id}/dns_records`))).toHaveLength(4);
    });

    it("stops with the missing records named when they never appear", async () => {
      const { cloud, email } = setup();
      cloud.routingPolls = 1_000;
      await expect(email.setUp(DOMAIN)).rejects.toThrow(/Email Routing DNS records of t\.example\.test: still missing: MX route1\.mx\.cloudflare\.net\., .*TXT "v=spf1 include:_spf\.mx\.cloudflare\.net ~all"/);
    });

    it("an error Cloudflare reports keeps the routing not ready even when the records exist", async () => {
      const cloud = await liveState();
      const body = JSON.parse(JSON.stringify(LIVE_DNS_BODY)) as { result: { errors: unknown } };
      body.result.errors = [{ code: "mx.conflict" }];
      cloud.override.set(dnsGet(cloud), { status: 200, body });
      await expect(setup(cloud).email.setUp(DOMAIN)).rejects.toThrow(/still missing: mx\.conflict/);
    });

    it("accepts the documented shape (a list of required records), and rejects any other", async () => {
      const cloud = await liveState();
      cloud.override.set(dnsGet(cloud), { status: 200, body: { success: true, errors: [], result: (LIVE_DNS_BODY as { result: { records: unknown } }).result.records } });
      expect(await setup(cloud).email.setUp(DOMAIN)).not.toContain("Email Routing on t.example.test");
      expect(writes(cloud).filter((w) => w.includes("/routing/dns"))).toEqual([]);

      cloud.override.set(dnsGet(cloud), { status: 200, body: { success: true, errors: [], result: { errors: null } } });
      await expect(setup(cloud).email.setUp(DOMAIN)).rejects.toThrow(/reading the Email Routing DNS records of t\.example\.test: unexpected answer shape/);
    });

    it("compares records ignoring a trailing dot, TXT quotes, case and MX priority", () => {
      expect(sameDnsRecord({ name: sub, type: "MX", content: "route1.mx.cloudflare.net.", priority: 96 }, { name: sub.toUpperCase(), type: "mx", content: "Route1.mx.cloudflare.net", priority: 12 })).toBe(true);
      expect(sameDnsRecord({ name: sub, type: "TXT", content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"' }, { name: sub, type: "TXT", content: "v=spf1 include:_spf.mx.cloudflare.net ~all" })).toBe(true);
      expect(sameDnsRecord({ name: sub, type: "TXT", content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"' }, { name: DOMAIN, type: "TXT", content: '"v=spf1 include:_spf.mx.cloudflare.net ~all"' })).toBe(false);
      expect(sameDnsRecord({ name: sub, type: "MX", content: "route1.mx.cloudflare.net." }, { name: sub, type: "MX", content: "route2.mx.cloudflare.net" })).toBe(false);
    });
  });

  it("finds the zone of a domain below the zone apex", async () => {
    expect(zoneCandidates("mail.example.test")).toEqual(["mail.example.test", "example.test"]);
    const { cloud, email } = setup();
    await email.setUp("mail.example.test");
    expect(zoneOf(cloud).sending.map((e) => e.name)).toEqual(["mail.example.test"]);
    expect([...zoneOf(cloud).routedSubdomains]).toEqual(["t.mail.example.test"]);
  });
});

describe("CloudflareEmailSetup.setupProblems (DEC-0515, PROV-AC-004)", () => {
  it("is empty with the live token's permissions, and sends only reads", async () => {
    const { cloud, email } = setup();
    expect(await email.setupProblems(DOMAIN)).toEqual([]);
    expect(writes(cloud)).toEqual([]);
  });

  it("[PROV-AC-004] unit part: names each missing email permission", async () => {
    const { cloud, email } = setup();
    cloud.tokenPolicies = FULL_POLICIES.map((p) => ({ ...p, permission_groups: p.permission_groups.filter((g) => g.name !== "Email Routing Rules Write" && g.name !== "Email Sending Write") }));
    expect(await email.setupProblems(DOMAIN)).toEqual([
      'the Cloudflare API token lacks the permission "Email Sending Write" (account; DEC-0515)',
      'the Cloudflare API token lacks the permission "Email Routing Rules Write" (zone example.test; DEC-0515)',
    ]);
  });

  it("names the domain's missing or inactive zone, and an unreadable token", async () => {
    const a = setup();
    expect(await a.email.setupProblems("absent.example")).toEqual(["the email domain absent.example is not in a zone of this Cloudflare account; add the domain to Cloudflare DNS first"]);
    const b = setup();
    zoneOf(b.cloud).status = "pending";
    expect((await b.email.setupProblems(DOMAIN))[0]).toMatch(/zone example\.test of the email domain is pending, not active/);
    const c = setup();
    c.cloud.override.set(`GET /accounts/${ACCOUNT}/tokens/selftoken`, { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized" }] } });
    expect((await c.email.setupProblems(DOMAIN))[0]).toMatch(/cannot read its own permissions \(it needs "Account API Tokens Read"\)/);
  });
});

describe("CloudflareEmailSetup.productionPrerequisites (PROV-REQ-002 step 1)", () => {
  it("names a domain that is not onboarded or not verified, and nothing once it is; reads only", async () => {
    const { cloud, email } = setup();
    expect(await email.productionPrerequisites(DOMAIN)).toEqual(["example.test is not onboarded for Email Sending; run setup-account --target cloudflare"]);
    zoneOf(cloud).sending.push({ id: "s", name: DOMAIN, enabled: false, pollsUntilEnabled: 99 });
    expect(await email.productionPrerequisites(DOMAIN)).toEqual(["the Email Sending entry example.test is not verified yet; run setup-account --target cloudflare again"]);
    zoneOf(cloud).sending[0]!.enabled = true;
    expect(await email.productionPrerequisites(DOMAIN)).toEqual([]);
    expect(writes(cloud)).toEqual([]);
  });

  it("needs no write permission of DEC-0515 and does not read the token's policies (DEC-0553); a refused read names the permission deploy reads with", async () => {
    const { cloud, email } = setup();
    zoneOf(cloud).sending.push({ id: "s", name: DOMAIN, enabled: true, pollsUntilEnabled: 0 });
    cloud.tokenPolicies = [];
    expect(await email.productionPrerequisites(DOMAIN)).toEqual([]);
    expect(cloud.requests.some((r) => r.includes("/tokens"))).toBe(false);
    cloud.override.set(`GET /zones/${zoneOf(cloud).id}/email/sending/subdomains`, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } });
    const problems = await email.productionPrerequisites(DOMAIN);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/listing the Email Sending domains of zone example\.test failed: HTTP 403.*"Email Sending Read"/);
  });
});

describe("the sink rule's read-back and settle wait (live finding 2026-10-25, i-g.md)", () => {
  it("after creating the rule, setUp reads it back, then waits RULE_SETTLE_MS before reporting; a second run does not wait", async () => {
    const cloud = FakeCloud.withSharedResources();
    const events: string[] = [];
    const api: typeof cloud.api = async (method, path, body) => (events.push(`${method} ${path}`), cloud.api(method, path, body));
    let clock = 0;
    const email = createCloudflareEmailSetup({
      api,
      accountId: ACCOUNT,
      now: () => clock,
      sleep: async (ms) => void (events.push(`sleep ${String(ms)}`), (clock += ms)),
      pollTimeoutMs: 60_000,
      pollIntervalMs: 5_000,
    });
    expect(RULE_SETTLE_MS).toBe(60_000);
    await email.setUp(DOMAIN);
    const zone = zoneOf(cloud);
    const post = events.indexOf(`POST /zones/${zone.id}/email/routing/rules`);
    expect(post).toBeGreaterThan(-1);
    expect(events.slice(post + 1)).toEqual([`GET /zones/${zone.id}/email/routing/rules?per_page=50&page=1`, `sleep ${String(RULE_SETTLE_MS)}`]);
    events.length = 0;
    await email.setUp(DOMAIN);
    expect(events.filter((e) => e.startsWith("sleep"))).toEqual([]);
  });

  it("a rule that does not read back as wanted is polled, and setUp fails naming it, without reporting success", async () => {
    const cloud = FakeCloud.withSharedResources();
    const { email } = setup(cloud, { ruleSettleMs: 1 });
    const zone = zoneOf(cloud);
    // The POST answers, but the rule never shows up in the listing.
    cloud.override.set(`POST /zones/${zone.id}/email/routing/rules`, { status: 200, body: { success: true, errors: [], messages: [], result: { id: "ghost" } } });
    await expect(email.setUp(DOMAIN)).rejects.toThrow(/reading back the routing rule sink@t\.example\.test → Worker prototype-mailsink: still not listed as an enabled rule to the Worker after 60 s/);
  });
});
