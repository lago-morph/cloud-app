import { describe, expect, it } from "vitest";
import type { ApiReply, CloudflareApi } from "./api.js";
import { ACCOUNT_SETTINGS_KEY, parseAccountSettings, readAccountSettings, writeAccountSettings } from "./account-settings.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const OBJECT = `/accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`;

function stub(reply: ApiReply): CloudflareApi & { requests: { method: string; path: string; body: unknown }[] } {
  const requests: { method: string; path: string; body: unknown }[] = [];
  const api: CloudflareApi = async (method, path, body) => {
    requests.push({ method, path, body });
    return reply;
  };
  return Object.assign(api, { requests });
}

describe("the Cloudflare account settings record (provisioning.md §2, DEC-0514)", () => {
  it("is the object framework/account.json in the state home sst-state", () => {
    expect(ACCOUNT_SETTINGS_KEY).toBe("framework/account.json");
  });

  it("reads the stored object as the record", async () => {
    const api = stub({ status: 200, body: { emailDomain: "example.test" } });
    expect(await readAccountSettings(api, ACCOUNT)).toEqual({ emailDomain: "example.test" });
    expect(api.requests).toEqual([{ method: "GET", path: OBJECT, body: undefined }]);
  });

  it("reads no record (or no state home) as an empty record", async () => {
    const api = stub({ status: 404, body: { success: false, errors: [{ code: 10007, message: "The specified key does not exist." }] } });
    expect(await readAccountSettings(api, ACCOUNT)).toEqual({});
  });

  it("a failing read names the record and the status", async () => {
    const api = stub({ status: 500, body: { success: false, errors: [{ code: 10001, message: "internal" }] } });
    await expect(readAccountSettings(api, ACCOUNT)).rejects.toThrow(/framework\/account\.json in R2 bucket sst-state failed: HTTP 500: internal/);
  });

  it("writes the record as the object's JSON body; a refused write names the record", async () => {
    const requests: { method: string; path: string; body: unknown }[] = [];
    const api: CloudflareApi = async (method, path, body) => {
      requests.push({ method, path, body });
      return method === "GET" ? { status: 404, body: { success: false, errors: [{ code: 10007, message: "no such key" }] } } : { status: 200, body: { success: true, result: {} } };
    };
    await writeAccountSettings(api, ACCOUNT, { emailDomain: "example.test" });
    expect(requests).toEqual([
      { method: "GET", path: OBJECT, body: undefined },
      { method: "PUT", path: OBJECT, body: { emailDomain: "example.test" } },
    ]);
    const refused: CloudflareApi = async (method) =>
      method === "GET" ? { status: 200, body: {} } : { status: 403, body: { success: false, errors: [{ code: 10002, message: "Unauthorized" }] } };
    await expect(writeAccountSettings(refused, ACCOUNT, { emailDomain: "example.test" })).rejects.toThrow(/writing the account settings record .* HTTP 403/);
  });

  it("keeps the object's other fields; a changed domain drops the old domain's setup record fields (DEC-0577, DEC-0587)", async () => {
    const setup = { setupVersion: 1, frameworkVersion: "0.1.0", appliedAt: "2026-10-26T00:00:00.000Z", completedSteps: ["log-bucket"] };
    const stored = { emailDomain: "old.example", later: 1, ...setup };
    const changed = stub({ status: 200, body: stored });
    await writeAccountSettings(changed, ACCOUNT, { emailDomain: "new.example" });
    expect(changed.requests[1]?.body).toEqual({ later: 1, emailDomain: "new.example" });
    const same = stub({ status: 200, body: stored });
    await writeAccountSettings(same, ACCOUNT, { emailDomain: "old.example" });
    expect(same.requests[1]?.body).toEqual(stored);
  });

  it("validates a stored record: a JSON object whose emailDomain, when present, is a domain name", () => {
    expect(parseAccountSettings({})).toEqual({});
    expect(parseAccountSettings({ emailDomain: "example.test", later: 1 })).toEqual({ emailDomain: "example.test" });
    for (const bad of [null, "text", [], { emailDomain: 3 }, { emailDomain: "no-reply@example.test" }]) {
      expect(() => parseAccountSettings(bad), JSON.stringify(bad)).toThrow(/account settings record/);
    }
  });
});
