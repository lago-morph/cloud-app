import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import { runSetupAccount } from "../core/setup-account.js";
import { readAccountSettings } from "./account-settings.js";
import { ACCOUNT, FakeCloud, FakeDatabases } from "./fake-cloud.test-support.js";
import { parseSetupRecord, readSetupRecord, SETUP_STEPS, writeSetupRecord, type SetupStepId } from "./setup-record.js";
import { applySetupSteps, checkAccountSetup, inspectSetupSteps, type ApplySetupInput } from "./setup-steps.js";
import { createCloudflareTarget } from "./target.js";

const DOMAIN = "example.test";
const RECORD = "sst-state/framework/account.json";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const fast = { email: { sleep: async () => {} } };

/** A new account: no shared resources, no subdomain, no signing credential, no email setup. */
function freshCloud(): FakeCloud {
  const cloud = new FakeCloud();
  cloud.subdomain = undefined;
  return cloud;
}

const input = (overrides: Partial<ApplySetupInput> = {}): ApplySetupInput => ({
  emailDomain: DOMAIN,
  steps: SETUP_STEPS,
  setupVersion: 1,
  frameworkVersion: "0.1.0",
  now: () => NOW,
  newSubdomain: () => "pf-aaaaaaaaaaaa",
  ...fast,
  ...overrides,
});

const writes = (cloud: FakeCloud) => cloud.requests.filter((r) => !r.startsWith("GET "));

/** A fully set-up account (through the steps). */
async function setUpCloud(): Promise<FakeCloud> {
  const cloud = freshCloud();
  await applySetupSteps(cloud.api, ACCOUNT, input());
  cloud.requests.length = 0;
  return cloud;
}

describe("the account setup steps (plan-setup-wizard §4.4, DEC-0578)", () => {
  it("are today's setup-account parts, account steps first, the test mailbox's routing rule last", () => {
    expect(SETUP_STEPS).toEqual([
      "log-bucket",
      "state-bucket",
      "backup-bucket",
      "backup-lifecycle",
      "subdomain",
      "signing-record",
      "email-sending",
      "mailsink-bucket",
      "mailsink-lifecycle",
      "mailsink-worker",
      "test-mailbox-dns",
      "subaddressing",
      "test-mailbox-route",
    ]);
  });

  it("each step's inspection on a new account finds it missing, with reads only and the everyday token's permissions", async () => {
    const cloud = freshCloud();
    const states = await inspectSetupSteps(cloud.everydayApi, ACCOUNT, DOMAIN, fast);
    expect(states.map((s) => s.step)).toEqual([...SETUP_STEPS]);
    expect(states.filter((s) => s.done)).toEqual([]);
    for (const s of states) expect(s.detail, s.step).toBeTruthy();
    expect(states.find((s) => s.step === "test-mailbox-dns")?.detail).toMatch(/HTTP 403.*the setup record does not list it as completed/);
    expect(writes(cloud)).toEqual([]);
    expect(cloud.requests.join("\n")).not.toContain("/tokens/");
  });

  it("apply on a new account applies every step in order, then writes the record last; the everyday token reads it back and finds the setup current", async () => {
    const cloud = freshCloud();
    const notes: string[] = [];
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input({ note: (m) => notes.push(m) }));
    expect(applied).toEqual([...SETUP_STEPS]);
    expect(record).toEqual({ setupVersion: 1, frameworkVersion: "0.1.0", appliedAt: NOW.toISOString(), emailDomain: DOMAIN, completedSteps: [...SETUP_STEPS] });
    expect(writes(cloud).at(-1)).toBe(`PUT /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`);
    expect(cloud.objectBodies.get(RECORD)).toEqual(record);
    expect(cloud.subdomain).toBe("pf-aaaaaaaaaaaa");
    expect(notes).toEqual([]);

    // Round trip through R2 with the everyday token; the old reader still finds the domain.
    cloud.requests.length = 0;
    expect(await readSetupRecord(cloud.everydayApi, ACCOUNT)).toEqual(record);
    expect(await readAccountSettings(cloud.everydayApi, ACCOUNT)).toEqual({ emailDomain: DOMAIN });
    const status = await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 1, fast);
    expect(status).toEqual({ record, current: true, missing: [] });
    expect(writes(cloud)).toEqual([]);
    // The two reads the everyday token is refused are vouched for by the record; the rest are read.
    const states = await inspectSetupSteps(cloud.everydayApi, ACCOUNT, DOMAIN, fast);
    expect(states.filter((s) => s.detail !== undefined).map((s) => s.step)).toEqual(["test-mailbox-dns", "subaddressing"]);
    expect(states.find((s) => s.step === "subaddressing")?.detail).toMatch(/HTTP 403.*the setup record lists it as completed/);
  });

  it("the everyday inspection reads the buckets, the signing record, email sending and the test mailbox's routing rule itself", async () => {
    const missingAfter = async (change: (cloud: FakeCloud) => void): Promise<readonly SetupStepId[]> => {
      const cloud = await setUpCloud();
      change(cloud);
      const status = await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 1, fast);
      expect(status.current).toBe(false);
      return status.missing;
    };
    expect(await missingAfter((c) => c.buckets.delete("prototype-logs"))).toEqual(["log-bucket"]);
    expect(await missingAfter((c) => c.buckets.delete("prototype-backups"))).toEqual(["backup-bucket", "backup-lifecycle"]);
    expect(await missingAfter((c) => c.buckets.get("sst-state")!.delete("framework/r2-signing.json"))).toEqual(["signing-record"]);
    expect(await missingAfter((c) => (c.zones.get(DOMAIN)!.sending[0]!.enabled = false))).toEqual(["email-sending"]);
    expect(await missingAfter((c) => (c.zones.get(DOMAIN)!.rules = c.zones.get(DOMAIN)!.rules.slice(0, 1)))).toEqual(["test-mailbox-route"]);
    expect(await missingAfter((c) => c.workers.delete("prototype-mailsink"))).toEqual(["mailsink-worker"]);
    expect(await missingAfter((c) => c.lifecycles.set("prototype-mailsink", []))).toEqual(["mailsink-lifecycle"]);
  });

  it("a second apply changes nothing and writes no record", async () => {
    const cloud = await setUpCloud();
    const before = cloud.objectBodies.get(RECORD);
    const again = await applySetupSteps(cloud.api, ACCOUNT, input({ now: () => new Date("2026-10-27T00:00:00.000Z"), frameworkVersion: "0.2.0" }));
    expect(again.applied).toEqual([]);
    expect(again.record).toEqual(before);
    expect(writes(cloud)).toEqual([]);
    // Nothing to apply, so the bootstrap token's permissions are not even checked.
    expect(cloud.requests.some((r) => r.includes("/tokens/"))).toBe(false);
  });

  it("on a partial setup only the missing steps are applied", async () => {
    const cloud = await setUpCloud();
    cloud.buckets.delete("prototype-logs");
    cloud.workers.delete("prototype-mailsink");
    const { missing } = await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 1, fast);
    expect(missing).toEqual(["log-bucket", "mailsink-worker"]);
    cloud.requests.length = 0;
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input({ steps: missing, now: () => new Date("2026-10-27T00:00:00.000Z") }));
    expect(applied).toEqual(["log-bucket", "mailsink-worker"]);
    expect(writes(cloud)).toEqual([
      `POST /accounts/${ACCOUNT}/r2/buckets`,
      `PUT /accounts/${ACCOUNT}/workers/scripts/prototype-mailsink`,
      `PUT /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`,
    ]);
    expect(record.appliedAt).toBe("2026-10-27T00:00:00.000Z");
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 1, fast)).current).toBe(true);
  });

  it("a step not requested stays missing and out of the record's completed steps", async () => {
    const cloud = freshCloud();
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input({ steps: ["log-bucket", "state-bucket"] }));
    expect(applied).toEqual(["log-bucket", "state-bucket"]);
    expect(record.completedSteps).toEqual(["log-bucket", "state-bucket"]);
    const status = await checkAccountSetup(cloud.api, ACCOUNT, DOMAIN, 1, fast);
    expect(status.current).toBe(false);
    expect(status.missing).not.toContain("log-bucket");
    expect(status.missing).toContain("signing-record");
  });

  it("an old record without the setup fields reads as no setup record: not current, even with everything in place", async () => {
    const cloud = await setUpCloud();
    cloud.objectBodies.set(RECORD, { emailDomain: DOMAIN });
    expect(await readSetupRecord(cloud.everydayApi, ACCOUNT)).toBeUndefined();
    expect(await checkAccountSetup(cloud.api, ACCOUNT, DOMAIN, 1, fast)).toEqual({ current: false, missing: [] });
    // With the everyday token the refused reads cannot be vouched for without a record.
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 1, fast)).missing).toEqual(["test-mailbox-dns", "subaddressing"]);
    // The bootstrap run then writes the record, keeping the domain, and applies nothing.
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input());
    expect(applied).toEqual([]);
    expect(record.completedSteps).toEqual([...SETUP_STEPS]);
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 1, fast)).current).toBe(true);
  });

  it("an older setup version, or another email domain, is not current", async () => {
    const cloud = await setUpCloud();
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 2, fast)).current).toBe(false);
    const other = await checkAccountSetup(cloud.everydayApi, ACCOUNT, "one.example", 1, fast);
    expect(other.current).toBe(false);
    expect(other.missing).toEqual(["email-sending", "test-mailbox-dns", "subaddressing", "test-mailbox-route"]);
    // Setting up the other domain applies only its email steps and records it.
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input({ emailDomain: "one.example", steps: other.missing }));
    expect(applied).toEqual(other.missing);
    expect(record.emailDomain).toBe("one.example");
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, "one.example", 1, fast)).current).toBe(true);
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 1, fast)).current).toBe(false);
  });

  it("a version raised by a release makes the bootstrap run rewrite the record at the new version without changing anything else", async () => {
    const cloud = await setUpCloud();
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input({ setupVersion: 2, frameworkVersion: "0.2.0" }));
    expect(applied).toEqual([]);
    expect(record).toMatchObject({ setupVersion: 2, frameworkVersion: "0.2.0" });
    expect(writes(cloud)).toEqual([`PUT /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`]);
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 2, fast)).current).toBe(true);
    // An older release keeps the higher version (and so writes nothing).
    cloud.requests.length = 0;
    expect((await applySetupSteps(cloud.api, ACCOUNT, input({ setupVersion: 1 }))).record.setupVersion).toBe(2);
    expect(writes(cloud)).toEqual([]);
  });

  it("a requested step whose resource belongs to another account stops before any change, naming it", async () => {
    const cloud = freshCloud();
    cloud.override.set(`GET /accounts/${ACCOUNT}/r2/buckets/prototype-logs`, { status: 403, body: { success: false, errors: [{ code: 10002, message: "Unauthorized" }] } });
    expect((await inspectSetupSteps(cloud.api, ACCOUNT, DOMAIN, fast))[0]).toMatchObject({ step: "log-bucket", done: false, foreign: true });
    await expect(applySetupSteps(cloud.api, ACCOUNT, input())).rejects.toThrow(/R2 bucket prototype-logs already exists but belongs to another account.*nothing was changed/);
    expect(writes(cloud)).toEqual([]);
  });

  it("a token without the setup permissions (the everyday token) is refused before any change, naming what is missing", async () => {
    const cloud = freshCloud();
    await expect(applySetupSteps(cloud.everydayApi, ACCOUNT, input())).rejects.toThrow(/nothing was changed/);
    const lacking = freshCloud();
    lacking.tokenPolicies = [];
    await expect(applySetupSteps(lacking.api, ACCOUNT, input())).rejects.toThrow(/lacks the permission "Email Sending Write".*nothing was changed/);
    for (const c of [cloud, lacking]) {
      expect(writes(c)).toEqual([]);
      expect(c.buckets.size).toBe(0);
    }
  });

  it("the apply reads every step directly: a refused read stops it before any change, even when the record lists the step", async () => {
    const cloud = await setUpCloud();
    const zoneId = cloud.zones.get(DOMAIN)!.id;
    cloud.override.set(`GET /zones/${zoneId}/email/routing`, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } });
    await expect(applySetupSteps(cloud.api, ACCOUNT, input())).rejects.toThrow(/could not read .*subaddress.*nothing was changed/);
    expect(writes(cloud)).toEqual([]);
  });

  it("an invalid domain or an unknown step is refused before any request", async () => {
    const cloud = freshCloud();
    await expect(applySetupSteps(cloud.api, ACCOUNT, input({ emailDomain: "Not A Domain" }))).rejects.toThrow(/is not a domain name.*nothing was changed/);
    await expect(applySetupSteps(cloud.api, ACCOUNT, input({ steps: ["no-such-step" as SetupStepId] }))).rejects.toThrow(/unknown setup step no-such-step/);
    expect(cloud.requests).toEqual([]);
  });
});

describe("the account setup record (plan-setup-wizard §4.4, DEC-0577)", () => {
  it("keeps the object's other fields when it is written", async () => {
    const cloud = await setUpCloud();
    cloud.objectBodies.set(RECORD, { ...(cloud.objectBodies.get(RECORD) as object), futureField: "kept" });
    await writeSetupRecord(cloud.api, ACCOUNT, { emailDomain: DOMAIN, completedSteps: SETUP_STEPS, setupVersion: 3, frameworkVersion: "0.3.0", now: () => NOW }, false);
    expect(cloud.objectBodies.get(RECORD)).toMatchObject({ futureField: "kept", setupVersion: 3, emailDomain: DOMAIN });
  });

  it("an invalid or incomplete record reads as none; step names this release does not know are left out", () => {
    const good = { emailDomain: DOMAIN, setupVersion: 1, frameworkVersion: "0.1.0", appliedAt: NOW.toISOString(), completedSteps: ["state-bucket", "a-future-step", "log-bucket"] };
    expect(parseSetupRecord(good)?.completedSteps).toEqual(["log-bucket", "state-bucket"]);
    expect(parseSetupRecord(undefined)).toBeUndefined();
    expect(parseSetupRecord({})).toBeUndefined();
    for (const field of ["emailDomain", "setupVersion", "frameworkVersion", "appliedAt", "completedSteps"]) {
      const { [field]: _dropped, ...rest } = good as Record<string, unknown>;
      expect(parseSetupRecord(rest), field).toBeUndefined();
    }
    expect(parseSetupRecord({ ...good, setupVersion: "1" })).toBeUndefined();
    expect(parseSetupRecord({ ...good, setupVersion: 0 })).toBeUndefined();
    expect(parseSetupRecord({ ...good, completedSteps: "log-bucket" })).toBeUndefined();
  });

  it("no record at all (or no state home) reads as none", async () => {
    const cloud = freshCloud();
    expect(await readSetupRecord(cloud.everydayApi, ACCOUNT)).toBeUndefined();
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 1, fast)).current).toBe(false);
  });
});

describe("setup-account --target cloudflare on the steps (PROV-REQ-004, DEC-0577)", () => {
  it("writes the setup record last, at the target's setup version, so the everyday token finds the setup current; a second run writes nothing", async () => {
    const cloud = freshCloud();
    const target = createCloudflareTarget({
      api: cloud.api,
      accountId: ACCOUNT,
      env: { CLOUDFLARE_API_TOKEN: "placeholder", CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
      appDir: "/nonexistent",
      databases: new FakeDatabases(),
      files: { bucketCors: () => ({}), storagePreflight: async () => ({ ok: true }) },
      sleep: async () => {},
      now: () => NOW.getTime(),
      setupVersion: 1,
      frameworkVersion: "0.1.0",
    });
    expect((await runSetupAccount(target, captureIo(), { emailDomain: DOMAIN })).status).toBe(0);
    expect(writes(cloud).at(-1)).toBe(`PUT /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`);
    expect(await checkAccountSetup(cloud.everydayApi, ACCOUNT, DOMAIN, 1, fast)).toEqual({
      record: { setupVersion: 1, frameworkVersion: "0.1.0", appliedAt: NOW.toISOString(), emailDomain: DOMAIN, completedSteps: [...SETUP_STEPS] },
      current: true,
      missing: [],
    });
    cloud.requests.length = 0;
    expect(await runSetupAccount(target, captureIo())).toEqual({ status: 0, created: [] });
    expect(writes(cloud)).toEqual([]);
    // The steps' own apply agrees: nothing to do.
    expect((await applySetupSteps(cloud.api, ACCOUNT, input())).applied).toEqual([]);
  });
});
