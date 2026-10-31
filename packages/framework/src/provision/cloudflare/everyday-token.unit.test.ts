/**
 * The everyday token through the admin's grant (v0.2.0 plan §5.2 page 2; §7: "the everyday set:
 * exactly the four groups, and the in-place update of a 0.1.x token removes its email and zone
 * groups"). Fake token store, no network.
 */
import { describe, expect, it } from "vitest";
import { fakeTokens } from "../../admin-app/fake-tokens.test-support.js";
import { deleteOldEverydayTokens, ensureEverydayToken, everydayPolicies } from "./everyday-token.js";
import { EVERYDAY_V2, TOKEN_NAMES, type TokenPolicy } from "./permissions.js";

const A = "0123456789abcdef0123456789abcdef";
const ACCOUNT_RES = `com.cloudflare.api.account.${A}`;
const FOUR = ["e086da7e2179491d91ee5f35b3ca210a", "bf7481a1826f439697cb59a20b22293e", "09b2857d1c31407795e75e3fed8617a1", "5e33b7d77788455c9fdf18cbd38ee5a0"];

/** A v0.1.x everyday token's policies, as the dashboard link made them: 4 account groups, 3 zone groups on all zones. */
const V01_POLICIES: TokenPolicy[] = [
  { id: "p-acct", effect: "allow", resources: { [ACCOUNT_RES]: "*" }, permission_groups: ["e086da7e2179491d91ee5f35b3ca210a", "bf7481a1826f439697cb59a20b22293e", "09b2857d1c31407795e75e3fed8617a1", "2d5b4b1f6c89487bb7184c2c1dcd3bf1"].map((id) => ({ id })) },
  { id: "p-zone", effect: "allow", resources: { [ACCOUNT_RES]: { "com.cloudflare.api.account.zone.*": "*" } }, permission_groups: ["c8fed203ed3043cba015a93ad1616f1f", "9c88f9c5bce24ce7af9a958ba9c504db", "1b600d9d8062443e986a973f097e728a"].map((id) => ({ id })) },
];
const groupIds = (policies: readonly TokenPolicy[]) => policies.flatMap((p) => p.permission_groups.map((g) => g.id));

describe("everydayPolicies", () => {
  it("is one allow policy on this account holding exactly the four everyday groups, no zone resource", () => {
    const p = everydayPolicies(A);
    expect(p).toEqual([{ effect: "allow", resources: { [ACCOUNT_RES]: "*" }, permission_groups: FOUR.map((id) => ({ id })) }]);
    expect(JSON.stringify(p)).not.toContain("zone");
    expect(groupIds(p)).toEqual(EVERYDAY_V2.map((g) => g.id));
  });
});

describe("ensureEverydayToken", () => {
  it("with no everyday token: creates one named prototype-framework with the four groups and returns its value once", async () => {
    const f = fakeTokens(A);
    const out = await ensureEverydayToken(f.api, A);
    expect(out.kind).toBe("created");
    const [t] = [...f.tokens.values()];
    expect(t!.name).toBe(TOKEN_NAMES.everyday);
    expect(groupIds(t!.policies)).toEqual(FOUR);
    expect(out).toEqual({ kind: "created", tokenId: t!.id, value: t!.value });
  });

  it("a 0.1.x token is updated in place to exactly the four groups: email and zone groups removed, Secrets Store Read added, value, name, expiry and condition kept", async () => {
    const f = fakeTokens(A);
    const old = f.add({ id: "a".repeat(32), name: TOKEN_NAMES.everyday, value: "old-value-kept", expires_on: "2027-01-01T00:00:00Z", condition: { request_ip: { in: ["192.0.2.0/24"] } }, policies: V01_POLICIES });
    const out = await ensureEverydayToken(f.api, A);
    expect(out).toEqual({ kind: "updated", tokenIds: [old.id], added: ["Secrets Store Read"], removed: ["Email Sending Read", "Zone Read", "Analytics Read", "Email Routing Rules Read"] });
    const t = f.tokens.get(old.id)!;
    expect(groupIds(t.policies).sort()).toEqual([...FOUR].sort());
    expect(JSON.stringify(t.policies)).not.toContain("zone");
    expect(t.value).toBe("old-value-kept");
    expect(t.expires_on).toBe("2027-01-01T00:00:00Z");
    expect(t.condition).toEqual({ request_ip: { in: ["192.0.2.0/24"] } });
    expect(f.writes).toEqual([`PUT /accounts/${A}/tokens/${old.id}`]);
    expect(JSON.stringify(out)).not.toContain("old-value-kept");
  });

  it("a token already holding exactly the set is left alone", async () => {
    const f = fakeTokens(A);
    const t = f.add({ id: "b".repeat(32), name: TOKEN_NAMES.everyday, value: "v", policies: everydayPolicies(A) });
    expect(await ensureEverydayToken(f.api, A)).toEqual({ kind: "current", tokenIds: [t.id] });
    expect(f.writes).toEqual([]);
  });

  it("finds the token on a later page of the list, and ignores tokens of other names", async () => {
    const f = fakeTokens(A, { perPage: 2 });
    for (let i = 0; i < 4; i++) f.add({ id: `${String(i)}`.padStart(32, "c"), name: `other-${String(i)}`, value: "x", policies: [] });
    const mine = f.add({ id: "d".repeat(32), name: TOKEN_NAMES.everyday, value: "v", policies: V01_POLICIES });
    const out = await ensureEverydayToken(f.api, A);
    expect(out.kind).toBe("updated");
    expect(f.writes).toEqual([`PUT /accounts/${A}/tokens/${mine.id}`]);
  });

  it("when the grant may not update the old token: creates a new one, returns its value and the old IDs, and deletes nothing", async () => {
    const f = fakeTokens(A);
    const old = f.add({ id: "e".repeat(32), name: TOKEN_NAMES.everyday, value: "old", policies: V01_POLICIES });
    f.refuseUpdate.add(old.id);
    const out = await ensureEverydayToken(f.api, A);
    expect(out.kind).toBe("replaced");
    const created = [...f.tokens.values()].find((t) => t.id !== old.id)!;
    expect(out).toEqual({ kind: "replaced", tokenId: created.id, value: created.value, oldIds: [old.id] });
    expect(groupIds(created.policies)).toEqual(FOUR);
    expect(f.tokens.has(old.id)).toBe(true);
  });

  it("a refused create names the step and Cloudflare's answer, never a value", async () => {
    const f = fakeTokens(A);
    const refusing = (m: Parameters<typeof f.api>[0], p: string, b?: unknown) => (m === "POST" ? Promise.resolve({ status: 400, body: { success: false, errors: [{ code: 1001, message: "The OAuth session does not include the scopes required" }] } }) : f.api(m, p, b));
    await expect(ensureEverydayToken(refusing, A)).rejects.toThrow("creating the everyday token prototype-framework failed: HTTP 400: The OAuth session does not include the scopes required (code 1001)");
  });
});

describe("deleteOldEverydayTokens", () => {
  it("deletes the named old tokens that are everyday tokens, and refuses any other ID", async () => {
    const f = fakeTokens(A);
    const old = f.add({ id: "f".repeat(32), name: TOKEN_NAMES.everyday, value: "o", policies: V01_POLICIES });
    const other = f.add({ id: "9".repeat(32), name: "someone-elses", value: "s", policies: [] });
    expect(await deleteOldEverydayTokens(f.api, A, [old.id, other.id, "../x"])).toEqual({ deleted: [old.id], skipped: [other.id, "../x"] });
    expect(f.tokens.has(old.id)).toBe(false);
    expect(f.tokens.has(other.id)).toBe(true);
    expect(f.writes).toEqual([`DELETE /accounts/${A}/tokens/${old.id}`]);
  });
});
