/**
 * The Cloudflare email setup (PROV-REQ-004 amendment, MAIL-REQ-005, DEC-0514, DEC-0515; item
 * I-F) against the in-memory Cloudflare account: every step, idempotency, polling, the
 * permission check and the production preflight. No network.
 */
import { describe, expect, it } from "vitest";
import { MAIL_SINK_SOURCE } from "../../mail/sink-worker.js";
import {
  createCloudflareEmailSetup,
  isWantedLifecycle,
  MAIL_SINK_LIFECYCLE_RULE_ID,
  mailSinkTag,
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
    expect(cloud.requests.length).toBeLessThanOrEqual(9);
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

  it("enables Email Routing on t.<domain> only, never on the apex, and waits for its MX and SPF records", async () => {
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

  it("names a missing DEC-0515 permission, but not the sink's Workers permission", async () => {
    const { cloud, email } = setup();
    zoneOf(cloud).sending.push({ id: "s", name: DOMAIN, enabled: true, pollsUntilEnabled: 0 });
    cloud.tokenPolicies = FULL_POLICIES.map((p) => ({ ...p, permission_groups: p.permission_groups.filter((g) => g.name !== "DNS Write" && g.name !== "Workers Scripts Write") }));
    expect(await email.productionPrerequisites(DOMAIN)).toEqual(['the Cloudflare API token lacks the permission "DNS Write" (zone example.test; DEC-0515)']);
  });
});
