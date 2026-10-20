import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import { runDeploy } from "../core/deploy.js";
import { FakeTarget } from "../core/fake-target.js";
import type { SharedResource } from "../core/operations.js";
import { runSetupAccount } from "../core/setup-account.js";
import { createSharedResources, inspectSharedResources, LOG_BUCKET, LOG_BUCKET_RESOURCE, type CloudflareApi } from "./account.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";

type Reply = { status: number; body: unknown };
const ok = (result: unknown): Reply => ({ status: 200, body: { success: true, errors: [], messages: [], result } });
const err = (status: number, code: number, message: string): Reply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

/** A stubbed Cloudflare API: answers by `<METHOD> <path>`, records every request. */
function stubApi(replies: Record<string, Reply>): CloudflareApi & { requests: string[] } {
  const requests: string[] = [];
  const api = async (method: string, path: string, body?: unknown) => {
    requests.push(`${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`);
    const reply = replies[`${method} ${path}`];
    if (!reply) throw new Error(`unexpected request ${method} ${path}`);
    return reply;
  };
  return Object.assign(api, { requests });
}

const BUCKET_PATH = `/accounts/${ACCOUNT}/r2/buckets/${LOG_BUCKET}`;

describe("Cloudflare shared log bucket ownership (PROV-REQ-004)", () => {
  it("the bucket is named prototype-logs (LOG §2)", () => {
    expect(LOG_BUCKET).toBe("prototype-logs");
    expect(LOG_BUCKET_RESOURCE).toBe("R2 bucket prototype-logs");
  });

  it("reads the bucket from this account: present → owned, not found → absent", async () => {
    expect(await inspectSharedResources(stubApi({ [`GET ${BUCKET_PATH}`]: ok({ name: LOG_BUCKET }) }), ACCOUNT)).toEqual([
      { name: LOG_BUCKET_RESOURCE, state: "owned" },
    ]);
    expect(await inspectSharedResources(stubApi({ [`GET ${BUCKET_PATH}`]: err(404, 10006, "The specified bucket does not exist.") }), ACCOUNT)).toEqual([
      { name: LOG_BUCKET_RESOURCE, state: "absent" },
    ]);
  });

  it("an existing bucket this account does not own is foreign", async () => {
    expect(await inspectSharedResources(stubApi({ [`GET ${BUCKET_PATH}`]: err(403, 10002, "Unauthorized to access requested resource") }), ACCOUNT)).toEqual([
      { name: LOG_BUCKET_RESOURCE, state: "foreign" },
    ]);
  });

  it("any other answer is an error naming the bucket and the status, never a guess", async () => {
    await expect(inspectSharedResources(stubApi({ [`GET ${BUCKET_PATH}`]: err(500, 10001, "internal") }), ACCOUNT)).rejects.toThrow(
      /R2 bucket prototype-logs.*HTTP 500.*internal/,
    );
  });

  it("creates an absent bucket in this account; a creation conflict means another account holds the name", async () => {
    const api = stubApi({ [`POST /accounts/${ACCOUNT}/r2/buckets`]: ok({ name: LOG_BUCKET }) });
    await createSharedResources(api, ACCOUNT, [{ name: LOG_BUCKET_RESOURCE, state: "absent" }]);
    expect(api.requests).toEqual([`POST /accounts/${ACCOUNT}/r2/buckets {"name":"prototype-logs"}`]);

    const conflict = stubApi({ [`POST /accounts/${ACCOUNT}/r2/buckets`]: err(409, 10004, "The bucket you tried to create already exists.") });
    await expect(createSharedResources(conflict, ACCOUNT, [{ name: LOG_BUCKET_RESOURCE, state: "absent" }])).rejects.toThrow(
      /R2 bucket prototype-logs.*another account/,
    );
  });

  /** A target whose account inspection is the Cloudflare check over the stubbed API. */
  function targetOver(api: CloudflareApi): FakeTarget {
    const t = new FakeTarget();
    t.inspectAccount = async (): Promise<readonly SharedResource[]> => inspectSharedResources(api, ACCOUNT);
    t.createSharedResources = (absent) => createSharedResources(api, ACCOUNT, absent);
    return t;
  }

  it("[PROV-AC-007] with the stubbed response showing the shared log bucket belongs to another account, setup-account and deploy stop with a message naming the bucket and change nothing", async () => {
    const api = stubApi({ [`GET ${BUCKET_PATH}`]: err(403, 10002, "Unauthorized to access requested resource") });
    const t = targetOver(api);

    const setupIo = captureIo();
    expect((await runSetupAccount(t, setupIo)).status).toBe(1);
    expect(setupIo.err).toContain("R2 bucket prototype-logs");

    const deployIo = captureIo();
    const deploy = await runDeploy(t, { stage: { app: "notes", stage: "test-abc" }, migrations: { framework: [], app: [] }, requiredSecrets: [] }, deployIo);
    expect(deploy.status).toBe(1);
    expect(deploy.failure?.step).toBe("preflight");
    expect(deployIo.err).toContain("R2 bucket prototype-logs");
    expect(deployIo.err).toMatch(/another account/);

    expect(api.requests.every((r) => r.startsWith("GET "))).toBe(true);
    expect(t.calls.filter((c) => !/^(preflight|listSetSecrets)\b/.test(c))).toEqual([]);
  });

  it("setup-account creates the bucket once; a second run sends no change", async () => {
    let exists = false;
    const requests: string[] = [];
    const api: CloudflareApi = async (method, path) => {
      requests.push(`${method} ${path}`);
      if (method === "GET") return exists ? ok({ name: LOG_BUCKET }) : err(404, 10006, "The specified bucket does not exist.");
      exists = true;
      return ok({ name: LOG_BUCKET });
    };
    const t = targetOver(api);
    expect(await runSetupAccount(t, captureIo())).toEqual({ status: 0, created: [LOG_BUCKET_RESOURCE] });
    requests.length = 0;
    expect(await runSetupAccount(t, captureIo())).toEqual({ status: 0, created: [] });
    expect(requests).toEqual([`GET ${BUCKET_PATH}`]);
  });
});
