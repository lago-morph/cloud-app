/**
 * The account's Workers plan and the plan-dependent D1 database limit (PAR-219; DEC-0530,
 * DEC-0546), with a stubbed `GET /accounts/<a>/subscriptions` and the fake D1 HTTP API.
 */
import { describe, expect, it } from "vitest";
import { CloudflareRequestsStopped, type CloudflareApi } from "./api.js";
import { openFakeD1Api } from "./d1/fake-d1-api.js";
import { d1DatabaseOperations } from "./d1/operations.js";
import { databaseLimitText, planFromSubscriptions, PLAN_SETTING_ENV, workersPlanReader } from "./plan.js";

const ACCOUNT = "acct";
const ok = (result: unknown) => ({ status: 200, body: { success: true, errors: [], messages: [], result } });
const subscriptionsApi =
  (reply: { status: number; body: unknown } | Error): CloudflareApi & { requests: string[] } => {
    const requests: string[] = [];
    const api = async (method: string, path: string) => {
      requests.push(`${method} ${path}`);
      if (reply instanceof Error) throw reply;
      return reply;
    };
    return Object.assign(api, { requests });
  };

/** The live account's listing on 2026-10-25 (DEC-0530), trimmed. */
const LIVE = [
  { id: "s1", state: "Paid", rate_plan: { id: "workers_paid", scope: "account" } },
  { id: "s2", state: "Paid", rate_plan: { id: "r2_paid", scope: "account" } },
  { id: "s3", state: "Paid", rate_plan: { id: "free", scope: "zone" } },
];

describe("Workers plan (DEC-0546)", () => {
  it("reads Workers Paid from an active account-scoped workers_paid subscription, Free otherwise", () => {
    expect(planFromSubscriptions(LIVE)).toBe("paid");
    expect(planFromSubscriptions([{ state: "Cancelled", rate_plan: { id: "workers_paid", scope: "account" } }])).toBe("free");
    expect(planFromSubscriptions([{ state: "Paid", rate_plan: { id: "workers_paid", scope: "zone" } }])).toBe("free");
    expect(planFromSubscriptions([])).toBe("free");
    expect(planFromSubscriptions(null)).toBeUndefined();
  });

  it("asks Cloudflare once; without an answer the setting decides, and without the setting the plan is unknown", async () => {
    const api = subscriptionsApi(ok(LIVE));
    expect(await workersPlanReader(api, ACCOUNT)()).toEqual({ plan: "paid", source: "api" });
    expect(api.requests).toEqual([`GET /accounts/${ACCOUNT}/subscriptions`]);
    const refused = subscriptionsApi({ status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized" }] } });
    expect(await workersPlanReader(refused, ACCOUNT, { [PLAN_SETTING_ENV]: "paid" })()).toEqual({ plan: "paid", source: "setting" });
    expect(await workersPlanReader(refused, ACCOUNT, {})()).toEqual({ plan: undefined, source: "unknown" });
    expect(await workersPlanReader(subscriptionsApi(new Error("reset")), ACCOUNT, { [PLAN_SETTING_ENV]: "free" })()).toEqual({ plan: "free", source: "setting" });
    // Cloudflare's answer wins over the setting.
    expect(await workersPlanReader(subscriptionsApi(ok([])), ACCOUNT, { [PLAN_SETTING_ENV]: "paid" })()).toEqual({ plan: "free", source: "api" });
  });

  it("a request layer's stop (a budget used up, a 429) is rethrown, never read as no answer (DEC-0619)", async () => {
    const stop = new CloudflareRequestsStopped("live pass stopped: HTTP 429 on GET (rate limited)");
    await expect(workersPlanReader(subscriptionsApi(stop), ACCOUNT, { [PLAN_SETTING_ENV]: "paid" })()).rejects.toBe(stop);
  });

  it("the limit text names the plan's PAR-219 value, or both when the plan is unknown", () => {
    expect(databaseLimitText({ plan: "paid", source: "api" })).toBe("PAR-219: 50,000 on Workers Paid");
    expect(databaseLimitText({ plan: "free", source: "setting" })).toBe("PAR-219: 10 on Workers Free");
    expect(databaseLimitText(undefined)).toMatch(/^PAR-219: 10 on Workers Free, 50,000 on Workers Paid; the account's plan could not be read/);
  });

  it("the D1 database-limit message depends on the plan, read only when Cloudflare refuses a database (code 7406)", { timeout: 60_000 }, async () => {
    const fake = await openFakeD1Api({ accountId: ACCOUNT, maxDatabases: 1 });
    try {
      const stage = { app: "notes", stage: "test-abc" };
      let reads = 0;
      const paid = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT, plan: async () => (reads++, { plan: "paid", source: "api" }) });
      await paid.createDatabase(stage, "notes-test-abc-db-1");
      expect(reads).toBe(0);
      await expect(paid.createDatabase(stage, "notes-test-abc-db-2")).rejects.toThrow(/maximum number of D1 databases \(PAR-219: 50,000 on Workers Paid; code 7406\)/);
      expect(reads).toBe(1);
      const free = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT, plan: async () => ({ plan: "free", source: "api" }) });
      await expect(free.createDatabase(stage, "notes-test-abc-db-2")).rejects.toThrow(/\(PAR-219: 10 on Workers Free; code 7406\)/);
      const unknown = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
      await expect(unknown.createDatabase(stage, "notes-test-abc-db-2")).rejects.toThrow(/PAR-219: 10 on Workers Free, 50,000 on Workers Paid; the account's plan could not be read/);
      const broken = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT, plan: async () => Promise.reject(new Error("boom")) });
      await expect(broken.createDatabase(stage, "notes-test-abc-db-2")).rejects.toThrow(/could not be read/);
    } finally {
      await fake.close();
    }
  });
});
