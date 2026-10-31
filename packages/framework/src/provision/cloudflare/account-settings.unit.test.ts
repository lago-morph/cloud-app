import { describe, expect, it } from "vitest";
import type { ApiReply, CloudflareApi } from "./api.js";
import { ACCOUNT_SETTINGS_KEY, parseAccountSettings, readAccountSettings } from "./account-settings.js";

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

  it("validates a stored record: a JSON object whose emailDomain, when present, is a domain name", () => {
    expect(parseAccountSettings({})).toEqual({});
    expect(parseAccountSettings({ emailDomain: "example.test", later: 1 })).toEqual({ emailDomain: "example.test" });
    for (const bad of [null, "text", [], { emailDomain: 3 }, { emailDomain: "no-reply@example.test" }]) {
      expect(() => parseAccountSettings(bad), JSON.stringify(bad)).toThrow(/account settings record/);
    }
  });
});
