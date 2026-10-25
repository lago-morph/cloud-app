// Self-created restricted test tokens (DEC-0531; PAR-286), against the fake API. No network.
import { describe, expect, it } from "vitest";
import { addForeignToken, FAKE_ACCOUNT, fakeCfApi } from "./fake-cf-api.test-support.js";
import { cloudflareAccountOps, createRestrictedToken, deleteToken, expiresOn, listTestTokens, NO_EMAIL_PERMISSION_ENV, NO_R2_TOKEN_PERMISSION_ENV, RESTRICTED_TOKENS, TEST_TOKEN_LIFETIME_MS } from "./test-tokens.js";
import { EMAIL_PERMISSIONS } from "../../../packages/framework/src/provision/cloudflare/email-permissions.js";

const NOW = new Date("2026-10-25T10:00:00.123Z");
const spec = (suffix: string) => {
  const s = RESTRICTED_TOKENS.find((t) => t.suffix === suffix);
  if (s === undefined) throw new Error(suffix);
  return s;
};
type Policy = { effect: string; permission_groups: { id: string }[]; resources: Record<string, unknown> };

describe("restricted test tokens (DEC-0531)", () => {
  it("the specs: PROV-AC-002's lacks Account API Tokens; PROV-AC-004's lacks exactly one DEC-0515 email permission", () => {
    expect(spec("no-r2-token")).toMatchObject({ env: NO_R2_TOKEN_PERMISSION_ENV, criterion: "PROV-AC-002" });
    expect(spec("no-r2-token").account.some((g) => g.startsWith("Account API Tokens"))).toBe(false);
    const email = spec("no-email");
    expect(email).toMatchObject({ env: NO_EMAIL_PERMISSION_ENV, criterion: "PROV-AC-004", omitted: "Email Routing Addresses Write" });
    const granted = new Set([...email.account, ...email.zone]);
    expect(EMAIL_PERMISSIONS.filter((p) => !granted.has(p.name)).map((p) => p.name)).toEqual(["Email Routing Addresses Write"]);
    expect(granted.has("Account API Tokens Write")).toBe(false);
    expect(granted.has("Account API Tokens Read")).toBe(true);
  });

  it("creates a named, expiring token with only the spec's groups, account-scoped and zone groups on the account's zones", async () => {
    const api = fakeCfApi();
    const token = await createRestrictedToken(api.call, FAKE_ACCOUNT, spec("no-email"), "run12345", NOW);
    expect(token.name).toBe("prototype-compliance-run12345-no-email");
    const stored = api.tokens.get(token.id);
    expect(stored?.value).toBe(token.value);
    expect(stored?.expires_on).toBe("2026-10-25T16:00:00Z");
    const policies = stored?.policies as Policy[];
    expect(policies).toHaveLength(2);
    expect(policies[0]?.resources).toEqual({ [`com.cloudflare.api.account.${FAKE_ACCOUNT}`]: "*" });
    expect(policies[1]?.resources).toEqual({ [`com.cloudflare.api.account.${FAKE_ACCOUNT}`]: { "com.cloudflare.api.account.zone.*": "*" } });
    const groups = (await api.call("GET", `/accounts/${FAKE_ACCOUNT}/tokens/permission_groups`)).body as { result: { id: string; name: string }[] };
    const byId = new Map(groups.result.map((g) => [g.id, g.name]));
    const names = (p: Policy | undefined) => (p?.permission_groups ?? []).map((g) => byId.get(g.id));
    expect(names(policies[0])).toEqual([...spec("no-email").account]);
    expect(names(policies[1])).toEqual([...spec("no-email").zone]);
    expect(policies.every((p) => p.effect === "allow")).toBe(true);

    const r2 = await createRestrictedToken(api.call, FAKE_ACCOUNT, spec("no-r2-token"), "run12345", NOW);
    const r2Policies = api.tokens.get(r2.id)?.policies as Policy[];
    expect(r2Policies).toHaveLength(1);
    expect(names(r2Policies[0])).toEqual(["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write"]);
  });

  it("the expiry is PAR-286 (6 hours) in Cloudflare's form", () => {
    expect(TEST_TOKEN_LIFETIME_MS).toBe(6 * 3_600_000);
    expect(expiresOn(NOW)).toBe("2026-10-25T16:00:00Z");
  });

  it("names a missing permission group or a refused creation without any value", async () => {
    const api = fakeCfApi();
    await expect(createRestrictedToken(api.call, FAKE_ACCOUNT, { ...spec("no-r2-token"), account: ["No Such Group"] }, "r", NOW)).rejects.toThrow('the API token permission group "No Such Group" was not found on this account');
    api.failing.add(`POST /accounts/${FAKE_ACCOUNT}/tokens`);
    await expect(createRestrictedToken(api.call, FAKE_ACCOUNT, spec("no-r2-token"), "r", NOW)).rejects.toThrow("creating the test token prototype-compliance-r-no-r2-token failed: HTTP 500 (10000 internal error)");
    expect(api.tokens.size).toBe(0);
  });

  it("lists only prototype-compliance-* tokens, over pages; deleting is idempotent", async () => {
    const api = fakeCfApi({ perPage: 2 });
    addForeignToken(api, "owner-token");
    addForeignToken(api, "compliance-r2read-abc");
    const a = await createRestrictedToken(api.call, FAKE_ACCOUNT, spec("no-r2-token"), "r1", NOW);
    const b = await createRestrictedToken(api.call, FAKE_ACCOUNT, spec("no-email"), "r1", NOW);
    expect((await listTestTokens(api.call, FAKE_ACCOUNT)).map((t) => t.name).sort()).toEqual(["prototype-compliance-r1-no-email", "prototype-compliance-r1-no-r2-token"]);
    await deleteToken(api.call, FAKE_ACCOUNT, a.id);
    await deleteToken(api.call, FAKE_ACCOUNT, a.id);
    expect((await listTestTokens(api.call, FAKE_ACCOUNT)).map((t) => t.id)).toEqual([b.id]);
    api.failing.add(`DELETE /accounts/${FAKE_ACCOUNT}/tokens/${b.id}`);
    await expect(deleteToken(api.call, FAKE_ACCOUNT, b.id)).rejects.toThrow(`deleting API token ${b.id} failed: HTTP 500`);
  });

  it("cloudflareAccountOps wires the plan, creation, deletion and listing to one account", async () => {
    const api = fakeCfApi();
    const ops = cloudflareAccountOps({ call: api.call, accountId: FAKE_ACCOUNT, env: {}, now: () => NOW });
    expect((await ops.d1Plan()).plan).toBe("paid");
    const t = await ops.createRestrictedToken(spec("no-r2-token"), "rr");
    expect((await ops.testTokens()).map((x) => x.name)).toEqual(["prototype-compliance-rr-no-r2-token"]);
    await ops.deleteToken(t.id);
    expect(await ops.testTokens()).toEqual([]);
  });
});
