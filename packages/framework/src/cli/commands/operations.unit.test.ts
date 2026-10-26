/**
 * The CLI's Cloudflare operations record the release's account setup version (DEC-0577, DEC-0587):
 * with `ACCOUNT_SETUP_VERSION` raised, `setup-account` through `cloudflareOperations` writes it to
 * the setup record. No Cloudflare call: the API is a stubbed `fetch` over the fake account.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { API_BASE } from "../../provision/cloudflare/api.js";
import { ACCOUNT, FakeCloud } from "../../provision/cloudflare/fake-cloud.test-support.js";
import { readSetupRecord, SETUP_STEPS } from "../../provision/cloudflare/setup-record.js";
import { applySetupSteps } from "../../provision/cloudflare/setup-steps.js";
import { runSetupAccount } from "../../provision/core/setup-account.js";
import { captureIo } from "../io.test-support.js";
import { cloudflareOperations } from "./operations.js";

vi.mock("../../provision/cloudflare/permissions.js", async (original) => ({ ...(await original<typeof import("../../provision/cloudflare/permissions.js")>()), ACCOUNT_SETUP_VERSION: 7 }));

/** `fetch` answered by the fake account's API seam. */
function fetchOver(cloud: FakeCloud): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : init?.body;
    const reply = await cloud.api((init?.method ?? "GET") as "GET", url.slice(API_BASE.length), body);
    return new Response(reply.body === null || reply.body === undefined ? "" : JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
}

describe("cloudflareOperations", () => {
  it("passes the release's ACCOUNT_SETUP_VERSION to the target, so setup-account records it", async () => {
    const cloud = new FakeCloud();
    cloud.subdomain = undefined;
    await applySetupSteps(cloud.api, ACCOUNT, { emailDomain: "example.test", steps: SETUP_STEPS, setupVersion: 1, frameworkVersion: "0.0.0-test", now: () => new Date(), newSubdomain: () => "pf-test", email: { sleep: async () => {} } });
    const env = { CLOUDFLARE_API_TOKEN: "fake-token", CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
    const ops = cloudflareOperations({ env, fetch: fetchOver(cloud), requireCredentials: true })({ appDir: mkdtempSync(join(tmpdir(), "ops-")), target: "cloudflare" });
    const io = captureIo();
    expect((await runSetupAccount(ops, io)).status).toBe(0);
    expect((await readSetupRecord(cloud.api, ACCOUNT))?.setupVersion).toBe(7);
  });
});
