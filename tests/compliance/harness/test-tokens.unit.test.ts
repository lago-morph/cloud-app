// Self-created restricted test tokens (DEC-0531; PAR-286), against the fake API. No network.
import { describe, expect, it } from "vitest";
import { addForeignToken, FAKE_ACCOUNT, fakeCfApi } from "./fake-cf-api.test-support.js";
import {
  cloudflareAccountOps,
  createRestrictedToken,
  deleteToken,
  EVERYDAY_TOKEN,
  expiresOn,
  HOOK_TOKEN_LIFETIME_MS,
  hookTokenName,
  hookTokenRunId,
  hookTokensToDelete,
  listTestTokens,
  NO_API_TOKENS_WRITE_ENV,
  NO_EMAIL_PERMISSION_ENV,
  NO_EMAIL_SENDING_READ_ENV,
  NO_R2_STORAGE_WRITE_ENV,
  NO_R2_TOKEN_PERMISSION_ENV,
  RESTRICTED_TOKENS,
  SETUP_TOKEN,
  TEST_TOKEN_LIFETIME_MS,
} from "./test-tokens.js";
import { EMAIL_PERMISSIONS } from "../../../packages/framework/src/provision/cloudflare/email-permissions.js";

const NOW = new Date("2026-10-25T10:00:00.123Z");
const spec = (suffix: string) => {
  const s = RESTRICTED_TOKENS.find((t) => t.suffix === suffix);
  if (s === undefined) throw new Error(suffix);
  return s;
};
type Policy = { effect: string; permission_groups: { id: string }[]; resources: Record<string, unknown> };

describe("restricted test tokens (DEC-0531)", () => {
  it("the specs model DEC-0551's two tokens: PROV-AC-002's is the everyday token; each other lacks one permission of its set", () => {
    expect(EVERYDAY_TOKEN).toEqual({ account: ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Email Sending Read"], zone: ["Zone Read", "Analytics Read"] });
    expect(SETUP_TOKEN).toEqual({
      account: ["Workers Scripts Write", "Workers R2 Storage Write", "Account API Tokens Write", "Email Sending Write", "Email Routing Addresses Write"],
      zone: ["Email Routing Rules Write", "DNS Write", "Zone Settings Write", "Zone Read"],
    });
    const everyday = spec("no-r2-token");
    expect(everyday).toMatchObject({ env: NO_R2_TOKEN_PERMISSION_ENV, criterion: "PROV-AC-002", account: [...EVERYDAY_TOKEN.account], zone: [...EVERYDAY_TOKEN.zone] });
    expect([...everyday.account, ...everyday.zone].some((g) => g.startsWith("Account API Tokens"))).toBe(false);

    const email = spec("no-email");
    expect(email).toMatchObject({ env: NO_EMAIL_PERMISSION_ENV, criterion: "PROV-AC-004", omitted: "Email Routing Addresses Write" });
    const granted = new Set([...email.account, ...email.zone]);
    expect(EMAIL_PERMISSIONS.filter((p) => !granted.has(p.name)).map((p) => p.name)).toEqual(["Email Routing Addresses Write"]);
    expect([...SETUP_TOKEN.account, ...SETUP_TOKEN.zone].filter((g) => !granted.has(g))).toEqual(["Email Routing Addresses Write"]);

    const tokensWrite = spec("no-tokens-write");
    expect(tokensWrite).toMatchObject({ env: NO_API_TOKENS_WRITE_ENV, criterion: "PROV-AC-004", omitted: "Account API Tokens Write" });
    expect(tokensWrite.account).not.toContain("Account API Tokens Write");
    expect(tokensWrite.account).toContain("Account API Tokens Read");
    expect(EMAIL_PERMISSIONS.every((p) => [...tokensWrite.account, ...tokensWrite.zone].includes(p.name))).toBe(true);

    const sendingRead = spec("no-sending-read");
    expect(sendingRead).toMatchObject({ env: NO_EMAIL_SENDING_READ_ENV, criterion: "PROV-AC-004", omitted: "Email Sending Read", account: ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write"], zone: ["Zone Read", "Analytics Read"] });

    const r2Write = spec("no-r2-write");
    expect(r2Write).toMatchObject({ env: NO_R2_STORAGE_WRITE_ENV, criterion: "PROV-AC-003", omitted: "Workers R2 Storage Write", account: ["Workers Scripts Write", "Workers R2 Storage Read", "D1 Write", "Email Sending Read"] });
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
    expect(r2Policies).toHaveLength(2);
    expect(names(r2Policies[0])).toEqual(["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Email Sending Read"]);
    expect(names(r2Policies[1])).toEqual(["Zone Read", "Analytics Read"]);
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

  it("lists only the harness's tokens (prototype-compliance-*, compliance-r2read-*, compliance-r2scoped-*), over pages; deleting is idempotent", async () => {
    const api = fakeCfApi({ perPage: 2 });
    addForeignToken(api, "owner-token");
    addForeignToken(api, "compliance-r2read-abc");
    addForeignToken(api, "compliance-r2scoped-run1-0123456789ab");
    addForeignToken(api, "xcompliance-r2read-abc");
    const a = await createRestrictedToken(api.call, FAKE_ACCOUNT, spec("no-r2-token"), "r1", NOW);
    const b = await createRestrictedToken(api.call, FAKE_ACCOUNT, spec("no-email"), "r1", NOW);
    expect((await listTestTokens(api.call, FAKE_ACCOUNT)).map((t) => t.name).sort()).toEqual(["compliance-r2read-abc", "compliance-r2scoped-run1-0123456789ab", "prototype-compliance-r1-no-email", "prototype-compliance-r1-no-r2-token"]);
    await deleteToken(api.call, FAKE_ACCOUNT, a.id);
    await deleteToken(api.call, FAKE_ACCOUNT, a.id);
    expect((await listTestTokens(api.call, FAKE_ACCOUNT)).map((t) => t.id).filter((id) => !id.startsWith("foreign-"))).toEqual([b.id]);
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

describe("the cloud test hooks' R2 tokens (compliance-r2read-*, compliance-r2scoped-*)", () => {
  const T = (name: string, times: { issuedOn?: string; expiresOn?: string } = {}) => ({ id: name, name, ...times });

  it("are named with the run ID, and the run ID is read back; names without one (older ones) have none", () => {
    expect(HOOK_TOKEN_LIFETIME_MS).toBe(30 * 60_000);
    expect(hookTokenName("compliance-r2read-", "abcdefghij12345", "0123456789ab")).toBe("compliance-r2read-abcdefghij12345-0123456789ab");
    expect(hookTokenName("compliance-r2scoped-", undefined, "0123456789ab")).toBe("compliance-r2scoped-0123456789ab");
    expect(hookTokenName("compliance-r2scoped-", "bad id!", "0123456789ab")).toBe("compliance-r2scoped-0123456789ab");
    expect(() => hookTokenName("prototype-compliance-", "r", "00")).toThrow("not a hook token prefix");
    expect(hookTokenRunId("compliance-r2read-abcdefghij12345-0123456789ab")).toBe("abcdefghij12345");
    expect(hookTokenRunId("compliance-r2scoped-abcdefghij12345-0123456789ab")).toBe("abcdefghij12345");
    expect(hookTokenRunId("compliance-r2read-0123456789ab")).toBeUndefined();
    expect(hookTokenRunId("prototype-compliance-abcdefghij12345-no-email")).toBeUndefined();
  });

  it("deletes those expired or over an hour old, and at the end of a run every one of that run; never another live one", () => {
    const now = new Date("2026-10-25T10:00:00Z");
    const tokens = [
      T("compliance-r2read-0123456789ab", { issuedOn: "2026-10-25T08:59:00Z" }),
      T("compliance-r2scoped-0123456789ac", { expiresOn: "2026-10-25T10:00:00Z" }),
      T("compliance-r2read-0123456789ad", { issuedOn: "2026-10-25T09:30:00Z", expiresOn: "2026-10-25T10:00:01Z" }),
      T("compliance-r2read-0123456789ae"),
      T("compliance-r2read-other0000000001-0123456789ab", { issuedOn: "2026-10-25T09:45:00Z", expiresOn: "2026-10-25T10:15:00Z" }),
      T("compliance-r2read-other0000000001-0123456789ac", { expiresOn: "2026-10-25T09:15:00Z" }),
      T("compliance-r2read-abcdefghij12345-0123456789ab", { issuedOn: "2026-10-25T09:59:00Z", expiresOn: "2026-10-25T10:29:00Z" }),
      T("compliance-r2scoped-abcdefghij12345-0123456789ac"),
      T("prototype-compliance-abcdefghij12345-no-email", { expiresOn: "2026-10-25T09:00:00Z" }),
      T("owner-token", { expiresOn: "2026-10-25T09:00:00Z" }),
    ];
    expect(hookTokensToDelete(tokens, now).map((t) => t.name)).toEqual(["compliance-r2read-0123456789ab", "compliance-r2scoped-0123456789ac", "compliance-r2read-other0000000001-0123456789ac"]);
    expect(hookTokensToDelete(tokens, now, "abcdefghij12345").map((t) => t.name)).toEqual([
      "compliance-r2read-0123456789ab",
      "compliance-r2scoped-0123456789ac",
      "compliance-r2read-other0000000001-0123456789ac",
      "compliance-r2read-abcdefghij12345-0123456789ab",
      "compliance-r2scoped-abcdefghij12345-0123456789ac",
    ]);
  });
});
