import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import { runDeploy } from "../core/deploy.js";
import { FakeTarget } from "../core/fake-target.js";
import type { SharedResource } from "../core/operations.js";
import { runSetupAccount } from "../core/setup-account.js";
import { accountSubdomain, createSharedResources, inspectSharedResources, LOG_BUCKET, LOG_BUCKET_RESOURCE, STATE_HOME_RESOURCE, SUBDOMAIN_RESOURCE, type CloudflareApi } from "./account.js";

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
const STATE_PATH = `/accounts/${ACCOUNT}/r2/buckets/sst-state`;
const SUBDOMAIN_PATH = `/accounts/${ACCOUNT}/workers/subdomain`;
/** The state home and the subdomain present: the replies the log-bucket tests do not vary. */
const OTHERS_PRESENT: Record<string, Reply> = { [`GET ${STATE_PATH}`]: ok({ name: "sst-state" }), [`GET ${SUBDOMAIN_PATH}`]: ok({ subdomain: "example" }) };
const OTHERS_OWNED: SharedResource[] = [
  { name: STATE_HOME_RESOURCE, state: "owned" },
  { name: SUBDOMAIN_RESOURCE, state: "owned" },
];

describe("Cloudflare shared log bucket ownership (PROV-REQ-004)", () => {
  it("the bucket is named prototype-logs (LOG §2)", () => {
    expect(LOG_BUCKET).toBe("prototype-logs");
    expect(LOG_BUCKET_RESOURCE).toBe("R2 bucket prototype-logs");
  });

  it("reads the bucket from this account: present → owned, not found → absent", async () => {
    expect(await inspectSharedResources(stubApi({ [`GET ${BUCKET_PATH}`]: ok({ name: LOG_BUCKET }), ...OTHERS_PRESENT }), ACCOUNT)).toEqual([
      { name: LOG_BUCKET_RESOURCE, state: "owned" },
      ...OTHERS_OWNED,
    ]);
    expect(await inspectSharedResources(stubApi({ [`GET ${BUCKET_PATH}`]: err(404, 10006, "The specified bucket does not exist."), ...OTHERS_PRESENT }), ACCOUNT)).toEqual([
      { name: LOG_BUCKET_RESOURCE, state: "absent" },
      ...OTHERS_OWNED,
    ]);
  });

  it("an existing bucket this account does not own is foreign", async () => {
    expect(await inspectSharedResources(stubApi({ [`GET ${BUCKET_PATH}`]: err(403, 10002, "Unauthorized to access requested resource"), ...OTHERS_PRESENT }), ACCOUNT)).toEqual([
      { name: LOG_BUCKET_RESOURCE, state: "foreign" },
      ...OTHERS_OWNED,
    ]);
  });

  it("any other answer is an error naming the bucket and the status, never a guess", async () => {
    await expect(inspectSharedResources(stubApi({ [`GET ${BUCKET_PATH}`]: err(500, 10001, "internal"), ...OTHERS_PRESENT }), ACCOUNT)).rejects.toThrow(
      /R2 bucket prototype-logs.*HTTP 500.*internal/,
    );
  });

  it("creates an absent bucket in this account with one request", async () => {
    const api = stubApi({ [`POST /accounts/${ACCOUNT}/r2/buckets`]: ok({ name: LOG_BUCKET }) });
    await createSharedResources(api, ACCOUNT, [{ name: LOG_BUCKET_RESOURCE, state: "absent" }]);
    expect(api.requests).toEqual([`POST /accounts/${ACCOUNT}/r2/buckets {"name":"prototype-logs"}`]);
  });

  /** Cloudflare's live answer to creating a bucket this account already has (pass 0 check 3). */
  const CONFLICT = err(409, 10004, "The bucket you tried to create already exists, and you own it.");
  const CREATE_PATH = `POST /accounts/${ACCOUNT}/r2/buckets`;

  it("a creation conflict on a bucket this account owns is not an error: the bucket exists in this account", async () => {
    const api = stubApi({ [CREATE_PATH]: CONFLICT, [`GET ${BUCKET_PATH}`]: ok({ name: LOG_BUCKET }) });
    await expect(createSharedResources(api, ACCOUNT, [{ name: LOG_BUCKET_RESOURCE, state: "absent" }])).resolves.toBeUndefined();
    expect(api.requests).toEqual([`POST /accounts/${ACCOUNT}/r2/buckets {"name":"prototype-logs"}`, `GET ${BUCKET_PATH}`]);
  });

  it("a creation conflict that this account cannot read back stops, naming the bucket as foreign", async () => {
    const api = stubApi({ [CREATE_PATH]: CONFLICT, [`GET ${BUCKET_PATH}`]: err(403, 10002, "Unauthorized to access requested resource") });
    await expect(createSharedResources(api, ACCOUNT, [{ name: LOG_BUCKET_RESOURCE, state: "absent" }])).rejects.toThrow(
      /R2 bucket prototype-logs.*another account/,
    );
  });

  it("a creation conflict whose read-back finds no bucket is an error naming the bucket and HTTP 409, not a foreign bucket", async () => {
    const api = stubApi({ [CREATE_PATH]: CONFLICT, [`GET ${BUCKET_PATH}`]: err(404, 10006, "The specified bucket does not exist.") });
    const failure: unknown = await createSharedResources(api, ACCOUNT, [{ name: LOG_BUCKET_RESOURCE, state: "absent" }]).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/R2 bucket prototype-logs.*HTTP 409/);
    expect((failure as Error).message).not.toMatch(/another account/);
  });

  /** A target whose account inspection is the Cloudflare check over the stubbed API. */
  function targetOver(api: CloudflareApi): FakeTarget {
    const t = new FakeTarget();
    t.inspectAccount = async (): Promise<readonly SharedResource[]> => inspectSharedResources(api, ACCOUNT);
    t.createSharedResources = (absent) => createSharedResources(api, ACCOUNT, absent);
    return t;
  }

  it("[PROV-AC-007] with the stubbed response showing the shared log bucket belongs to another account, setup-account and deploy stop with a message naming the bucket and change nothing", async () => {
    const api = stubApi({ [`GET ${BUCKET_PATH}`]: err(403, 10002, "Unauthorized to access requested resource"), ...OTHERS_PRESENT });
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
      if (path === STATE_PATH || path === SUBDOMAIN_PATH) return path === STATE_PATH ? ok({ name: "sst-state" }) : ok({ subdomain: "example" });
      if (method === "GET") return exists ? ok({ name: LOG_BUCKET }) : err(404, 10006, "The specified bucket does not exist.");
      exists = true;
      return ok({ name: LOG_BUCKET });
    };
    const t = targetOver(api);
    expect(await runSetupAccount(t, captureIo())).toEqual({ status: 0, created: [LOG_BUCKET_RESOURCE] });
    requests.length = 0;
    expect(await runSetupAccount(t, captureIo())).toEqual({ status: 0, created: [] });
    expect(requests).toEqual([`GET ${BUCKET_PATH}`, `GET ${STATE_PATH}`, `GET ${SUBDOMAIN_PATH}`]);
  });

  it("the state home sst-state is a shared bucket read the same way: owned, absent, foreign (DEC-0084, DEC-0270)", async () => {
    const replies = (state: Reply) => ({ [`GET ${BUCKET_PATH}`]: ok({ name: LOG_BUCKET }), [`GET ${STATE_PATH}`]: state, [`GET ${SUBDOMAIN_PATH}`]: ok({ subdomain: "example" }) });
    const stateOf = async (r: Reply) => (await inspectSharedResources(stubApi(replies(r)), ACCOUNT)).find((x) => x.name === STATE_HOME_RESOURCE)?.state;
    expect(STATE_HOME_RESOURCE).toBe("R2 bucket sst-state");
    expect(await stateOf(ok({ name: "sst-state" }))).toBe("owned");
    expect(await stateOf(err(404, 10006, "The specified bucket does not exist."))).toBe("absent");
    expect(await stateOf(err(403, 10002, "Unauthorized"))).toBe("foreign");
  });

  it("the workers.dev subdomain is an account setting: set → owned, none → absent; it is never foreign (DEC-0086)", async () => {
    const replies = (sub: Reply) => ({ [`GET ${BUCKET_PATH}`]: ok({ name: LOG_BUCKET }), [`GET ${STATE_PATH}`]: ok({ name: "sst-state" }), [`GET ${SUBDOMAIN_PATH}`]: sub });
    const stateOf = async (r: Reply) => (await inspectSharedResources(stubApi(replies(r)), ACCOUNT)).find((x) => x.name === SUBDOMAIN_RESOURCE)?.state;
    expect(SUBDOMAIN_RESOURCE).toBe("workers.dev subdomain");
    expect(await stateOf(ok({ subdomain: "example" }))).toBe("owned");
    expect(await stateOf(ok({ subdomain: "" }))).toBe("absent");
    expect(await stateOf(err(404, 10007, "This account does not have a workers.dev subdomain"))).toBe("absent");
    await expect(stateOf(err(403, 10000, "Authentication error"))).rejects.toThrow(/workers\.dev subdomain.*HTTP 403/);
  });

  it("setup-account creates the absent state home and registers a subdomain derived from the account ID", async () => {
    const api = stubApi({
      [`POST /accounts/${ACCOUNT}/r2/buckets`]: ok({ name: "sst-state" }),
      [`PUT ${SUBDOMAIN_PATH}`]: ok({ subdomain: "pf-0123456789ab" }),
    });
    await createSharedResources(api, ACCOUNT, [
      { name: STATE_HOME_RESOURCE, state: "absent" },
      { name: SUBDOMAIN_RESOURCE, state: "absent" },
    ]);
    expect(api.requests).toEqual([`POST /accounts/${ACCOUNT}/r2/buckets {"name":"sst-state"}`, `PUT ${SUBDOMAIN_PATH} {"subdomain":"pf-0123456789ab"}`]);
  });

  it("a subdomain registration that is refused names the subdomain and tells the owner how to register one", async () => {
    const api = stubApi({ [`PUT ${SUBDOMAIN_PATH}`]: err(409, 10032, "subdomain unavailable") });
    await expect(createSharedResources(api, ACCOUNT, [{ name: SUBDOMAIN_RESOURCE, state: "absent" }])).rejects.toThrow(
      /registering the workers\.dev subdomain pf-0123456789ab failed: HTTP 409.*register one in the Cloudflare dashboard/,
    );
  });

  it("the account subdomain is read from Cloudflare each time (recorded there, not on the owner's machine)", async () => {
    expect(await accountSubdomain(stubApi({ [`GET ${SUBDOMAIN_PATH}`]: ok({ subdomain: "example" }) }), ACCOUNT)).toBe("example");
    await expect(accountSubdomain(stubApi({ [`GET ${SUBDOMAIN_PATH}`]: ok({ subdomain: "" }) }), ACCOUNT)).rejects.toThrow(/no workers\.dev subdomain.*setup-account/);
  });
});
