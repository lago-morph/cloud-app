// The cloud test hooks' R2 tokens (criteria/_cloud/r2.ts): named with the run ID, always the
// 30-minute expiry, and the hook's own sweep never deletes a live token. Against the fake
// Cloudflare API through a stubbed `fetch`. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addForeignToken, FAKE_ACCOUNT, fakeCfApi, type FakeCfApi } from "../../harness/fake-cf-api.test-support.js";
import { HOOK_TOKEN_LIFETIME_MS, hookTokenRunId } from "../../harness/test-tokens.js";
import { API_BASE } from "./api.js";
import { bucketTokenRequest, withR2Access } from "./r2.js";

const NOW = new Date("2026-10-25T10:00:00.000Z");

function stubFetch(api: FakeCfApi): void {
  vi.stubGlobal("fetch", async (url: string, init: { method?: string; body?: string } = {}) => {
    if (!url.startsWith(API_BASE)) throw new Error(`no network in unit tests: ${url}`);
    const r = await api.call(init.method ?? "GET", url.slice(API_BASE.length), init.body === undefined ? undefined : JSON.parse(init.body));
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
}

describe("the cloud test hooks' R2 tokens", () => {
  it("the creation request always sets the 30-minute expiry, and names the token with the run ID when there is one", () => {
    expect(HOOK_TOKEN_LIFETIME_MS).toBe(30 * 60_000);
    for (const prefix of ["compliance-r2read-", "compliance-r2scoped-"]) {
      for (const runId of ["abcdefghij12345", undefined, "", "not a run id"]) {
        const req = bucketTokenRequest({ account: FAKE_ACCOUNT, prefix, groupId: "g1", buckets: ["prototype-logs"], runId, random: "0123456789ab", now: NOW });
        expect(req.expires_on, `${prefix} ${String(runId)}`).toBe("2026-10-25T10:30:00Z");
        expect(req.name).toBe(runId === "abcdefghij12345" ? `${prefix}abcdefghij12345-0123456789ab` : `${prefix}0123456789ab`);
        expect(hookTokenRunId(req.name)).toBe(runId === "abcdefghij12345" ? runId : undefined);
        expect(req.policies).toEqual([{ effect: "allow", permission_groups: [{ id: "g1" }], resources: { [`com.cloudflare.edge.r2.bucket.${FAKE_ACCOUNT}_default_prototype-logs`]: "*" } }]);
      }
    }
  });

  describe("withR2Access against the fake API", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", FAKE_ACCOUNT);
      vi.stubEnv("CLOUDFLARE_API_TOKEN", "fake-main-token-not-a-credential");
      vi.stubEnv("COMPLIANCE_RUN_ID", "abcdefghij12345");
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it("creates the token with the run ID in its name and the 30-minute expiry, sweeps only dead hook tokens first, and deletes its own after", async () => {
      const api = fakeCfApi();
      addForeignToken(api, "compliance-r2read-0123456789ab", { expires_on: "2026-10-25T09:59:00Z" });
      addForeignToken(api, "compliance-r2scoped-other0000000001-111111111111", { issued_on: "2026-10-25T08:00:00Z" });
      addForeignToken(api, "compliance-r2read-other0000000002-222222222222", { issued_on: "2026-10-25T09:50:00Z", expires_on: "2026-10-25T10:20:00Z" });
      addForeignToken(api, "owner-main-token");
      stubFetch(api);
      let during: { name: string; expires_on?: string }[] = [];
      await withR2Access(["prototype-logs"], "read", () => {
        during = [...api.tokens.values()].filter((t) => t.id.startsWith("tok")).map((t) => ({ name: t.name, ...(t.expires_on === undefined ? {} : { expires_on: t.expires_on }) }));
        return Promise.resolve();
      });
      expect(during).toHaveLength(1);
      expect(during[0]?.name).toMatch(/^compliance-r2scoped-abcdefghij12345-[0-9a-f]{12}$/);
      expect(during[0]?.expires_on).toBe("2026-10-25T10:30:00Z");
      expect([...api.tokens.values()].map((t) => t.name).sort()).toEqual(["compliance-r2read-other0000000002-222222222222", "owner-main-token"]);
    });
  });
});
