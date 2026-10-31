/** The versioned permission list (DEC-0563…0565): deep links, policy comparison, the in-place update body, the quick check. */
import { describe, expect, it } from "vitest";
import { ACCOUNT, FakeCloud } from "./fake-cloud.test-support.js";
import {
  ACCOUNT_SETUP_VERSION,
  BOOTSTRAP,
  comparePolicies,
  deepLink,
  EVERYDAY,
  EVERYDAY_V2,
  inPlaceUpdateBody,
  PERMISSIONS_VERSION,
  permissionTableMarkdown,
  probeEveryday,
  TOKEN_NAMES,
  withMissingPermissions,
  type PermissionGroup,
  type TokenPolicy,
} from "./permissions.js";

const A = "acct";
const Z = "zone1";
const accountRes = { [`com.cloudflare.api.account.${A}`]: "*" };
const allZones = { [`com.cloudflare.api.account.${A}`]: { "com.cloudflare.api.account.zone.*": "*" } };
const oneZone = (z: string) => ({ [`com.cloudflare.api.account.${A}`]: { [`com.cloudflare.api.account.zone.${z}`]: "*" } });
const names = (gs: readonly PermissionGroup[]) => gs.map((g) => g.name);
const byScope = (gs: readonly PermissionGroup[], s: "account" | "zone") => gs.filter((g) => g.scope === s);
/** The policies the dashboard link makes: account groups on the account, zone groups on all its zones. */
const dashboardPolicies = (gs: readonly PermissionGroup[], zoneRes: Record<string, unknown> = allZones): TokenPolicy[] => [
  { id: "pa", effect: "allow", resources: accountRes, permission_groups: byScope(gs, "account").map((g) => ({ id: g.id, name: g.name })) },
  { id: "pz", effect: "allow", resources: zoneRes, permission_groups: byScope(gs, "zone").map((g) => ({ id: g.id, name: g.name })) },
];

describe("the permission list", () => {
  it("has plan §4.1's everyday groups, v0.2.0 plan §5.1's bootstrap groups, versions and names", () => {
    expect(PERMISSIONS_VERSION).toBe(2);
    // 2: v0.2.0's account setup in the admin app (DEC-0719, PAR-332).
    expect(ACCOUNT_SETUP_VERSION).toBe(2);
    expect(names(byScope(EVERYDAY, "account"))).toEqual(["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Email Sending Read"]);
    expect(names(byScope(EVERYDAY, "zone"))).toEqual(["Zone Read", "Analytics Read", "Email Routing Rules Read"]);
    expect(names(byScope(BOOTSTRAP, "account"))).toEqual(["Workers Scripts Write", "OAuth Client Write", "Secrets Store Write", "Account API Tokens Write"]);
    expect(byScope(BOOTSTRAP, "zone")).toEqual([]);
    expect(TOKEN_NAMES).toEqual({ everyday: "prototype-framework", bootstrap: "prototype-framework-bootstrap" });
    const all = [...EVERYDAY, ...BOOTSTRAP];
    for (const g of all) expect(g.id).toMatch(/^[0-9a-f]{32}$/);
    // One ID per name and one name per ID.
    expect(new Set(all.map((g) => `${g.id} ${g.name}`)).size).toBe(new Set(all.map((g) => g.id)).size);
    expect(new Set(all.map((g) => g.id)).size).toBe(new Set(all.map((g) => g.name)).size);
    expect(EVERYDAY.some((g) => g.name.startsWith("Account API Tokens") || (g.scope === "zone" && g.name.endsWith("Write")))).toBe(false);
  });

  it("EVERYDAY_V2 is v0.2.0 plan §5.2 page 2's set: exactly four account groups, no zone group, with their IDs (§2.1b for Secrets Store Read)", () => {
    expect(Object.fromEntries(EVERYDAY_V2.map((g) => [g.name, g.id]))).toEqual({
      "Workers Scripts Write": "e086da7e2179491d91ee5f35b3ca210a",
      "Workers R2 Storage Write": "bf7481a1826f439697cb59a20b22293e",
      "D1 Write": "09b2857d1c31407795e75e3fed8617a1",
      "Secrets Store Read": "5e33b7d77788455c9fdf18cbd38ee5a0",
    });
    expect(EVERYDAY_V2.every((g) => g.scope === "account")).toBe(true);
    // Secrets Store Write includes Read, as Zone Write includes Zone Read.
    const read = EVERYDAY_V2.find((g) => g.name === "Secrets Store Read")!;
    const writeOnly = [{ effect: "allow" as const, resources: accountRes, permission_groups: [{ id: "adc8fa2bc6124928a8b3314dc63a1235", name: "Secrets Store Write" }] }];
    expect(comparePolicies(writeOnly, [read], { accountId: A, zoneId: Z }).missing).toEqual([]);
  });

  it("the bootstrap groups carry the IDs read from permission_groups (v0.2.0 plan §2.1b)", () => {
    expect(Object.fromEntries(BOOTSTRAP.map((g) => [g.name, g.id]))).toEqual({
      "Workers Scripts Write": "e086da7e2179491d91ee5f35b3ca210a",
      "OAuth Client Write": "50fc2f43318f40e4855a35d8de5bf643",
      "Secrets Store Write": "adc8fa2bc6124928a8b3314dc63a1235",
      "Account API Tokens Write": "5bc3f8b21c554832afc660159ab75fa4",
    });
  });
});

describe("deepLink", () => {
  for (const kind of ["everyday", "bootstrap"] as const) {
    it(`${kind}: the account-token template URL with every group by ID and the name`, () => {
      const link = deepLink(kind);
      expect(link.startsWith("https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=")).toBe(true);
      const url = new URL(link);
      expect(url.searchParams.get("to")).toBe("/:account/api-tokens");
      expect(url.searchParams.get("name")).toBe(TOKEN_NAMES[kind]);
      const keys = JSON.parse(url.searchParams.get("permissionGroupKeys")!) as { key: string; type: string }[];
      const list = kind === "everyday" ? EVERYDAY : BOOTSTRAP;
      expect(keys.map((k) => k.key)).toEqual(list.map((g) => g.id));
      expect(keys.map((k) => k.type)).toEqual(list.map((g) => (g.name.endsWith(" Read") ? "read" : "edit")));
      // URL-encoded as the docs show it: no raw JSON characters, the name's space as %20.
      const raw = link.slice(link.indexOf("permissionGroupKeys="));
      expect(raw).not.toMatch(/[[\]{}":, ]/);
      expect(raw).toContain("%5B%7B%22key%22%3A%22");
      expect(link).toContain(`&name=${TOKEN_NAMES[kind]}`);
    });
  }
});

describe("comparePolicies", () => {
  const scope = { accountId: A, zoneId: Z };

  it("the dashboard's token: nothing missing, the zone covered by all zones", () => {
    expect(comparePolicies(dashboardPolicies(EVERYDAY), EVERYDAY, scope)).toEqual({ missing: [], denied: [], wrongAccount: false, zoneCovered: true });
  });

  it("a specific zone covers it; another zone does not, and its groups are missing", () => {
    expect(comparePolicies(dashboardPolicies(EVERYDAY, oneZone(Z)), EVERYDAY, scope)).toEqual({ missing: [], denied: [], wrongAccount: false, zoneCovered: true });
    const elsewhere = comparePolicies(dashboardPolicies(EVERYDAY, oneZone("zone2")), EVERYDAY, scope);
    expect(elsewhere.zoneCovered).toBe(false);
    expect(elsewhere.wrongAccount).toBe(false);
    expect(names(elsewhere.missing)).toEqual(["Zone Read", "Analytics Read", "Email Routing Rules Read"]);
  });

  it("names a missing group (the release-1 everyday token lacks Email Routing Rules Read)", () => {
    const old = dashboardPolicies(EVERYDAY.filter((g) => g.name !== "Email Routing Rules Read"));
    expect(names(comparePolicies(old, EVERYDAY, scope).missing)).toEqual(["Email Routing Rules Read"]);
  });

  it("matches by ID without names, or by name, and a stronger group satisfies a read group", () => {
    const idsOnly = dashboardPolicies(EVERYDAY).map((p) => ({ ...p, permission_groups: p.permission_groups.map((g) => ({ id: g.id })) }));
    expect(comparePolicies(idsOnly, EVERYDAY, scope).missing).toEqual([]);
    const namesOnly = dashboardPolicies(EVERYDAY).map((p) => ({ ...p, permission_groups: p.permission_groups.map((g, i) => ({ id: `x${i}`, name: g.name ?? "" })) }));
    expect(comparePolicies(namesOnly, EVERYDAY, scope).missing).toEqual([]);
    const stronger = dashboardPolicies(EVERYDAY).map((p) => ({ ...p, permission_groups: p.permission_groups.map((g) => ({ id: "?", name: (g.name ?? "").replace(/ Read$/, " Write") })) }));
    expect(names(comparePolicies(stronger, EVERYDAY, scope).missing)).toEqual(["Analytics Read"]);
  });

  it("a deny policy takes a group away, and is reported as denied", () => {
    const rules = EVERYDAY.find((g) => g.name === "Email Routing Rules Read")!;
    const policies = [...dashboardPolicies(EVERYDAY), { effect: "deny" as const, resources: allZones, permission_groups: [{ id: rules.id }] }];
    const c = comparePolicies(policies, EVERYDAY, scope);
    expect(names(c.missing)).toEqual(["Email Routing Rules Read"]);
    expect(names(c.denied)).toEqual(["Email Routing Rules Read"]);
  });

  it("a deny of a stronger group leaves the weaker one granted (denying Zone Write keeps Zone Read)", () => {
    const policies = [...dashboardPolicies(EVERYDAY), { effect: "deny" as const, resources: allZones, permission_groups: [{ id: "e6d2666161e84845a636613608cee8d5", name: "Zone Write" }] }];
    expect(comparePolicies(policies, EVERYDAY, scope)).toEqual({ missing: [], denied: [], wrongAccount: false, zoneCovered: true });
  });

  it("the dashboard's single entire-account policy with every group passes", () => {
    for (const list of [EVERYDAY, BOOTSTRAP]) {
      const one = [{ id: "p", effect: "allow" as const, resources: accountRes, permission_groups: list.map((g) => ({ id: g.id, name: g.name })) }];
      expect(comparePolicies(one, list, scope)).toEqual({ missing: [], denied: [], wrongAccount: false, zoneCovered: true });
    }
  });

  it("an account group in a policy that names only zones of the account is not granted on the account", () => {
    const zonesOnly = [{ effect: "allow" as const, resources: oneZone(Z), permission_groups: EVERYDAY.map((g) => ({ id: g.id })) }];
    const c = comparePolicies(zonesOnly, EVERYDAY, scope);
    expect(c.missing).toEqual(byScope(EVERYDAY, "account"));
    expect(c.zoneCovered).toBe(true);
  });

  it("a token of another account: wrong account, everything missing", () => {
    const other = dashboardPolicies(EVERYDAY).map((p) => ({ ...p, resources: JSON.parse(JSON.stringify(p.resources).replaceAll(`account.${A}`, "account.other")) as Record<string, unknown> }));
    const c = comparePolicies(other, EVERYDAY, scope);
    expect(c.wrongAccount).toBe(true);
    expect(c.zoneCovered).toBe(false);
    expect(c.missing).toHaveLength(EVERYDAY.length);
  });

  it("an account given as `*` is not the wrong account; top-level zone keys name no account", () => {
    const star = [{ effect: "allow" as const, resources: { "com.cloudflare.api.account.*": "*" }, permission_groups: EVERYDAY.map((g) => ({ id: g.id })) }];
    expect(comparePolicies(star, EVERYDAY, scope)).toEqual({ missing: [], denied: [], wrongAccount: false, zoneCovered: true });
    const zoneOnly = [{ effect: "allow" as const, resources: { [`com.cloudflare.api.account.zone.${Z}`]: "*" }, permission_groups: byScope(EVERYDAY, "zone").map((g) => ({ id: g.id })) }];
    const c = comparePolicies(zoneOnly, EVERYDAY, scope);
    expect(c.wrongAccount).toBe(false);
    expect(c.zoneCovered).toBe(true);
    expect(c.missing).toEqual(byScope(EVERYDAY, "account"));
  });
});

describe("withMissingPermissions and inPlaceUpdateBody", () => {
  const rules = EVERYDAY.find((g) => g.name === "Email Routing Rules Read")!;
  const sending = EVERYDAY.find((g) => g.name === "Email Sending Read")!;
  const existing = dashboardPolicies(EVERYDAY.filter((g) => g !== rules && g !== sending));

  it("keeps every existing policy (id, effect, resources, groups by ID) and adds the missing groups per scope", () => {
    const body = withMissingPermissions(existing, [sending, rules], { accountId: A, zoneId: Z });
    expect(body.slice(0, 2)).toEqual(existing.map((p) => ({ id: p.id, effect: p.effect, resources: p.resources, permission_groups: p.permission_groups.map((g) => ({ id: g.id })) })));
    expect(body.slice(2)).toEqual([
      { effect: "allow", resources: accountRes, permission_groups: [{ id: sending.id }] },
      { effect: "allow", resources: { [`com.cloudflare.api.account.zone.${Z}`]: "*" }, permission_groups: [{ id: rules.id }] },
    ]);
    expect(comparePolicies(body, EVERYDAY, { accountId: A, zoneId: Z }).missing).toEqual([]);
  });

  it("keeps a group's meta", () => {
    const withMeta: TokenPolicy[] = [{ id: "pm", effect: "allow", resources: accountRes, permission_groups: [{ id: sending.id, name: sending.name, meta: { key: "k", value: "v" } }] }];
    expect(withMissingPermissions(withMeta, [], { accountId: A })[0]?.permission_groups).toEqual([{ id: sending.id, meta: { key: "k", value: "v" } }]);
  });

  it("without a zone, the zone groups go on all the account's zones; nothing missing adds nothing", () => {
    expect(withMissingPermissions(existing, [rules], { accountId: A }).slice(2)).toEqual([{ effect: "allow", resources: allZones, permission_groups: [{ id: rules.id }] }]);
    expect(withMissingPermissions(existing, [], { accountId: A })).toHaveLength(2);
  });

  it("the PUT body keeps the token's name, status, expiry and conditions and asks for no new value", () => {
    const token = { id: "t1", name: "prototype-framework", status: "active", expires_on: "2027-01-01T00:00:00Z", condition: { request_ip: { in: ["192.0.2.0/24"] } }, value: "never-sent", policies: existing };
    const body = inPlaceUpdateBody(token, [rules], { accountId: A, zoneId: Z });
    expect(Object.keys(body)).toEqual(["name", "status", "expires_on", "condition", "policies"]);
    expect(body).toMatchObject({ name: token.name, status: "active", expires_on: token.expires_on, condition: token.condition });
    expect(JSON.stringify(body)).not.toContain("never-sent");
    expect(body.policies).toEqual(withMissingPermissions(existing, [rules], { accountId: A, zoneId: Z }));
  });
});

describe("probeEveryday", () => {
  it("one read per everyday group against the fake; all pass", async () => {
    const cloud = new FakeCloud();
    const zoneId = cloud.zones.get("example.test")!.id;
    const results = await probeEveryday(cloud.api, { accountId: ACCOUNT, zoneId });
    expect(results.map((r) => [r.group.name, r.ok, r.status])).toEqual(EVERYDAY.map((g) => [g.name, true, 200]));
    expect(cloud.requests).toHaveLength(EVERYDAY.length);
    expect(cloud.requests.every((r) => r.startsWith("GET ") || r === "POST /graphql")).toBe(true);
  });

  it("names the refused group with its status; a GraphQL error fails Analytics Read", async () => {
    const cloud = new FakeCloud();
    const zoneId = cloud.zones.get("example.test")!.id;
    const refused = { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null } };
    cloud.override.set(`GET /zones/${zoneId}/email/routing/rules?per_page=1`, refused);
    cloud.graphqlErrors = [{ message: "not authorized for that account: com.cloudflare.api.account.zone.analytics.read" }];
    const failed = (await probeEveryday(cloud.api, { accountId: ACCOUNT, zoneId })).filter((r) => !r.ok);
    expect(failed.map((r) => [r.group.name, r.status])).toEqual([
      ["Analytics Read", 200],
      ["Email Routing Rules Read", 403],
    ]);
  });

  it("without a zone, reads only the account groups", async () => {
    const cloud = new FakeCloud();
    const results = await probeEveryday(cloud.api, { accountId: ACCOUNT });
    expect(results.map((r) => r.group)).toEqual(byScope(EVERYDAY, "account").filter((g) => g.name !== "Email Sending Read"));
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe("permissionTableMarkdown", () => {
  it("one row per group, in list order, with the dashboard name, API name and ID", () => {
    const table = permissionTableMarkdown("everyday");
    const lines = table.trimEnd().split("\n");
    expect(lines.slice(0, 2)).toEqual(["| Scope | On the dashboard | API name | Permission group ID |", "| --- | --- | --- | --- |"]);
    expect(lines.slice(2)).toEqual(EVERYDAY.map((g) => `| ${g.scope === "account" ? "Account" : "Zone"} | ${g.name.replace(/ Write$/, " Edit")} | ${g.name} | \`${g.id}\` |`));
    expect(lines[2]).toBe("| Account | Workers Scripts Edit | Workers Scripts Write | `e086da7e2179491d91ee5f35b3ca210a` |");
    expect(permissionTableMarkdown("bootstrap").trimEnd().split("\n")).toHaveLength(2 + BOOTSTRAP.length);
  });
});
