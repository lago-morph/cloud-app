// D1 budgets by plan and plan detection (DEC-0530; PAR-284, PAR-285), against the fake API. No network.
import { describe, expect, it } from "vitest";
import { D1_BUDGETS, describeBudget, detectD1Plan, planFromSubscriptions, runD1Budget, type CfCall } from "./d1-budget.js";
import { FAKE_ACCOUNT, fakeCfApi, R2_PAID, WORKERS_PAID, ZONE_FREE } from "./fake-cf-api.test-support.js";
import { maxD1Databases, MAX_D1_DATABASES } from "../criteria/_cloud/d1.js";

describe("D1 budgets (DEC-0530)", () => {
  it("Free keeps DEC-0419's caps: half the Free plan's daily 100,000 written / 5,000,000 read, a fifth of that per pass, 8 of 10 databases", () => {
    expect(D1_BUDGETS.free).toEqual({ plan: "free", perPass: { rowsWritten: 10_000, rowsRead: 500_000 }, perDay: { rowsWritten: 50_000, rowsRead: 2_500_000 }, maxDatabases: 8, parameter: "PAR-284" });
    expect(D1_BUDGETS.free.perDay.rowsWritten * 2).toBe(100_000);
    expect(D1_BUDGETS.free.perDay.rowsRead * 2).toBe(5_000_000);
    expect(D1_BUDGETS.free.maxDatabases).toBeLessThan(10);
  });

  it("Workers Paid: 31 days at the daily cap stay inside the monthly 50 million written / 25 billion read included, a fifth of a day per pass, 20 databases", () => {
    const paid = D1_BUDGETS.paid;
    expect(paid).toEqual({ plan: "paid", perPass: { rowsWritten: 100_000, rowsRead: 5_000_000 }, perDay: { rowsWritten: 500_000, rowsRead: 25_000_000 }, maxDatabases: 20, parameter: "PAR-285" });
    expect(paid.perDay.rowsWritten * 31).toBeLessThanOrEqual(0.35 * 50_000_000);
    expect(paid.perDay.rowsRead * 31).toBeLessThanOrEqual(0.05 * 25_000_000_000);
    expect(paid.perPass.rowsWritten * 5).toBe(paid.perDay.rowsWritten);
    expect(paid.perPass.rowsRead * 5).toBe(paid.perDay.rowsRead);
  });

  it("each budget is at least the Free one, and describes itself with its parameter", () => {
    for (const k of ["rowsWritten", "rowsRead"] as const) {
      expect(D1_BUDGETS.paid.perPass[k]).toBeGreaterThanOrEqual(D1_BUDGETS.free.perPass[k]);
      expect(D1_BUDGETS.paid.perDay[k]).toBeGreaterThanOrEqual(D1_BUDGETS.free.perDay[k]);
    }
    expect(describeBudget(D1_BUDGETS.free)).toBe("Free D1 budget (PAR-284): per pass ≤ 10,000 rows written and ≤ 500,000 read; per UTC day ≤ 50,000 written and ≤ 2,500,000 read; ≤ 8 D1 databases at once");
    expect(describeBudget(D1_BUDGETS.paid)).toMatch(/^Workers Paid D1 budget \(PAR-285\): .*≤ 20 D1 databases at once$/);
  });

  it("test processes apply the driver's plan, else the setting, else Free; the database guard follows it", () => {
    expect(runD1Budget({})).toBe(D1_BUDGETS.free);
    expect(runD1Budget({ COMPLIANCE_CLOUDFLARE_PLAN: "paid" })).toBe(D1_BUDGETS.paid);
    expect(runD1Budget({ COMPLIANCE_D1_PLAN: "paid" })).toBe(D1_BUDGETS.paid);
    expect(runD1Budget({ COMPLIANCE_D1_PLAN: "free", COMPLIANCE_CLOUDFLARE_PLAN: "paid" })).toBe(D1_BUDGETS.free);
    expect(() => runD1Budget({ COMPLIANCE_CLOUDFLARE_PLAN: "pro" })).toThrow(/COMPLIANCE_CLOUDFLARE_PLAN=pro is not one of free, paid/);
    expect(MAX_D1_DATABASES).toBe(8);
    expect(maxD1Databases({})).toBe(8);
    expect(maxD1Databases({ COMPLIANCE_D1_PLAN: "paid" })).toBe(20);
  });
});

describe("plan detection (DEC-0530)", () => {
  it("reads Workers Paid from an account-scoped, live workers_paid subscription", () => {
    expect(planFromSubscriptions([R2_PAID, WORKERS_PAID, ZONE_FREE])).toBe("paid");
    expect(planFromSubscriptions([R2_PAID, ZONE_FREE])).toBe("free");
    expect(planFromSubscriptions([])).toBe("free");
    expect(planFromSubscriptions([{ ...WORKERS_PAID, state: "Cancelled" }])).toBe("free");
    expect(planFromSubscriptions([{ ...WORKERS_PAID, state: "Expired" }])).toBe("free");
    expect(planFromSubscriptions([{ ...WORKERS_PAID, state: "Trial" }])).toBe("paid");
    expect(planFromSubscriptions([{ ...WORKERS_PAID, rate_plan: { ...WORKERS_PAID.rate_plan, scope: "zone" } }])).toBe("free");
    expect(planFromSubscriptions(null)).toBeUndefined();
    expect(planFromSubscriptions({ id: "x" })).toBeUndefined();
  });

  it("asks GET /accounts/<a>/subscriptions once, and Cloudflare's answer wins over the setting", async () => {
    const api = fakeCfApi({ subscriptions: [WORKERS_PAID] });
    expect(await detectD1Plan(api.call, FAKE_ACCOUNT, {})).toEqual({ plan: "paid", source: "api", detail: "the account's subscriptions include Workers Paid" });
    expect(api.requests).toEqual([{ method: "GET", path: `/accounts/${FAKE_ACCOUNT}/subscriptions` }]);
    expect(await detectD1Plan(api.call, FAKE_ACCOUNT, { COMPLIANCE_CLOUDFLARE_PLAN: "free" })).toMatchObject({ plan: "paid", source: "api", detail: expect.stringContaining("COMPLIANCE_CLOUDFLARE_PLAN=free ignored") as unknown });
    api.subscriptions = [ZONE_FREE];
    expect(await detectD1Plan(api.call, FAKE_ACCOUNT, { COMPLIANCE_CLOUDFLARE_PLAN: "paid" })).toMatchObject({ plan: "free", source: "api" });
  });

  it("without an answer (no Billing Read, an error) it uses the setting, and Free when there is none", async () => {
    const api = fakeCfApi({ subscriptions: 403 });
    expect(await detectD1Plan(api.call, FAKE_ACCOUNT, { COMPLIANCE_CLOUDFLARE_PLAN: "paid" })).toEqual({ plan: "paid", source: "setting", detail: `listing the account's subscriptions answered HTTP 403 (it needs "Billing Read"); COMPLIANCE_CLOUDFLARE_PLAN=paid` });
    expect(await detectD1Plan(api.call, FAKE_ACCOUNT, {})).toMatchObject({ plan: "free", source: "default", detail: expect.stringContaining("so the Free budget applies") as unknown });
    const throwing: CfCall = () => Promise.reject(new Error("fetch failed\nstack"));
    expect(await detectD1Plan(throwing, FAKE_ACCOUNT, {})).toEqual({ plan: "free", source: "default", detail: "listing the account's subscriptions failed: fetch failed; COMPLIANCE_CLOUDFLARE_PLAN not set, so the Free budget applies" });
    const notJson: CfCall = () => Promise.resolve({ status: 200, body: undefined });
    expect(await detectD1Plan(notJson, FAKE_ACCOUNT, { COMPLIANCE_CLOUDFLARE_PLAN: "free" })).toMatchObject({ plan: "free", source: "setting" });
  });

  it("refuses a setting that is neither free nor paid", async () => {
    await expect(detectD1Plan(fakeCfApi().call, FAKE_ACCOUNT, { COMPLIANCE_CLOUDFLARE_PLAN: "Paid" })).rejects.toThrow(/is not one of free, paid/);
  });
});
