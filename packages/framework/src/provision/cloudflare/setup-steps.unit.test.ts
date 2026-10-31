import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import { runSetupAccount } from "../core/setup-account.js";
import { ACCOUNT, FakeCloud, FakeDatabases } from "./fake-cloud.test-support.js";
import { parseSetupRecord, readSetupRecord, SETUP_STEPS, writeSetupRecord, type SetupStepId } from "./setup-record.js";
import { applySetupSteps, checkAccountSetup, inspectSetupSteps, type ApplySetupInput } from "./setup-steps.js";
import { createCloudflareTarget } from "./target.js";

const RECORD = "sst-state/framework/account.json";
const NOW = new Date("2026-10-26T12:00:00.000Z");

/** A new account: no shared resources, no subdomain, no signing credential. */
function freshCloud(): FakeCloud {
  const cloud = new FakeCloud();
  cloud.subdomain = undefined;
  return cloud;
}

const input = (overrides: Partial<ApplySetupInput> = {}): ApplySetupInput => ({
  steps: SETUP_STEPS,
  setupVersion: 1,
  frameworkVersion: "0.1.0",
  now: () => NOW,
  newSubdomain: () => "pf-aaaaaaaaaaaa",
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
  it("are today's setup-account parts, the account steps only (no email steps since v0.2.0)", () => {
    expect(SETUP_STEPS).toEqual(["log-bucket", "state-bucket", "backup-bucket", "backup-lifecycle", "subdomain", "signing-record"]);
  });

  it("each step's inspection on a new account finds it missing, with reads only and the everyday token's permissions", async () => {
    const cloud = freshCloud();
    const states = await inspectSetupSteps(cloud.everydayApi, ACCOUNT);
    expect(states.map((s) => s.step)).toEqual([...SETUP_STEPS]);
    expect(states.filter((s) => s.done)).toEqual([]);
    for (const s of states) expect(s.detail, s.step).toBeTruthy();
    expect(writes(cloud)).toEqual([]);
    expect(cloud.requests.join("\n")).not.toContain("/tokens/");
    // No step reads a zone (v0.2.0: the everyday token has no zone permission).
    expect(cloud.requests.join("\n")).not.toContain("/zones");
  });

  it("apply on a new account applies every step in order, then writes the record last; the everyday token reads it back and finds the setup current", async () => {
    const cloud = freshCloud();
    const notes: string[] = [];
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input({ note: (m) => notes.push(m) }));
    expect(applied).toEqual([...SETUP_STEPS]);
    expect(record).toEqual({ setupVersion: 1, frameworkVersion: "0.1.0", appliedAt: NOW.toISOString(), completedSteps: [...SETUP_STEPS] });
    expect(writes(cloud).at(-1)).toBe(`PUT /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`);
    expect(cloud.objectBodies.get(RECORD)).toEqual(record);
    expect(cloud.subdomain).toBe("pf-aaaaaaaaaaaa");
    expect(notes).toEqual([]);

    // Round trip through R2 with the everyday token; every step is read and found done.
    cloud.requests.length = 0;
    expect(await readSetupRecord(cloud.everydayApi, ACCOUNT)).toEqual(record);
    const status = await checkAccountSetup(cloud.everydayApi, ACCOUNT, 1);
    expect(status).toEqual({ record, current: true, missing: [] });
    expect(writes(cloud)).toEqual([]);
    const states = await inspectSetupSteps(cloud.everydayApi, ACCOUNT);
    expect(states.filter((s) => s.detail !== undefined)).toEqual([]);
  });

  it("the everyday inspection reads the buckets, the lifecycle rule and the signing record itself", async () => {
    const missingAfter = async (change: (cloud: FakeCloud) => void): Promise<readonly SetupStepId[]> => {
      const cloud = await setUpCloud();
      change(cloud);
      const status = await checkAccountSetup(cloud.everydayApi, ACCOUNT, 1);
      expect(status.current).toBe(false);
      return status.missing;
    };
    expect(await missingAfter((c) => c.buckets.delete("prototype-logs"))).toEqual(["log-bucket"]);
    expect(await missingAfter((c) => c.buckets.delete("prototype-backups"))).toEqual(["backup-bucket", "backup-lifecycle"]);
    expect(await missingAfter((c) => c.buckets.get("sst-state")!.delete("framework/r2-signing.json"))).toEqual(["signing-record"]);
    expect(await missingAfter((c) => c.lifecycles.set("prototype-backups", []))).toEqual(["backup-lifecycle"]);
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
    cloud.lifecycles.set("prototype-backups", []);
    const { missing } = await checkAccountSetup(cloud.everydayApi, ACCOUNT, 1);
    expect(missing).toEqual(["log-bucket", "backup-lifecycle"]);
    cloud.requests.length = 0;
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input({ steps: missing, now: () => new Date("2026-10-27T00:00:00.000Z") }));
    expect(applied).toEqual(["log-bucket", "backup-lifecycle"]);
    expect(writes(cloud)).toEqual([
      `POST /accounts/${ACCOUNT}/r2/buckets`,
      `PUT /accounts/${ACCOUNT}/r2/buckets/prototype-backups/lifecycle`,
      `PUT /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`,
    ]);
    expect(record.appliedAt).toBe("2026-10-27T00:00:00.000Z");
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, 1)).current).toBe(true);
  });

  it("a step not requested stays missing and out of the record's completed steps", async () => {
    const cloud = freshCloud();
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input({ steps: ["log-bucket", "state-bucket"] }));
    expect(applied).toEqual(["log-bucket", "state-bucket"]);
    expect(record.completedSteps).toEqual(["log-bucket", "state-bucket"]);
    const status = await checkAccountSetup(cloud.api, ACCOUNT, 1);
    expect(status.current).toBe(false);
    expect(status.missing).not.toContain("log-bucket");
    expect(status.missing).toContain("signing-record");
  });

  it("an old record without the setup fields reads as no setup record: not current, even with everything in place", async () => {
    const cloud = await setUpCloud();
    cloud.objectBodies.set(RECORD, { emailDomain: "example.test" });
    expect(await readSetupRecord(cloud.everydayApi, ACCOUNT)).toBeUndefined();
    expect(await checkAccountSetup(cloud.everydayApi, ACCOUNT, 1)).toEqual({ current: false, missing: [] });
    // A setup run then writes the record, keeping the 0.1.x email domain as it is, and applies nothing.
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input());
    expect(applied).toEqual([]);
    expect(record.completedSteps).toEqual([...SETUP_STEPS]);
    expect(cloud.objectBodies.get(RECORD)).toMatchObject({ emailDomain: "example.test" });
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, 1)).current).toBe(true);
  });

  it("a 0.1.x record (with an email domain and the email steps) counts its account steps only; an older setup version is not current", async () => {
    const cloud = await setUpCloud();
    const stored = cloud.objectBodies.get(RECORD) as Record<string, unknown>;
    cloud.objectBodies.set(RECORD, { ...stored, emailDomain: "example.test", completedSteps: [...SETUP_STEPS, "email-sending", "test-mailbox-route"] });
    expect((await readSetupRecord(cloud.everydayApi, ACCOUNT))?.completedSteps).toEqual([...SETUP_STEPS]);
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, 1)).current).toBe(true);
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, 2)).current).toBe(false);
  });

  it("a version raised by a release makes the bootstrap run rewrite the record at the new version without changing anything else", async () => {
    const cloud = await setUpCloud();
    const { applied, record } = await applySetupSteps(cloud.api, ACCOUNT, input({ setupVersion: 2, frameworkVersion: "0.2.0" }));
    expect(applied).toEqual([]);
    expect(record).toMatchObject({ setupVersion: 2, frameworkVersion: "0.2.0" });
    expect(writes(cloud)).toEqual([`PUT /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`]);
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, 2)).current).toBe(true);
    // An older release keeps the higher version (and so writes nothing).
    cloud.requests.length = 0;
    expect((await applySetupSteps(cloud.api, ACCOUNT, input({ setupVersion: 1 }))).record.setupVersion).toBe(2);
    expect(writes(cloud)).toEqual([]);
  });

  it("a requested step whose resource belongs to another account stops before any change, naming it", async () => {
    const cloud = freshCloud();
    cloud.override.set(`GET /accounts/${ACCOUNT}/r2/buckets/prototype-logs`, { status: 403, body: { success: false, errors: [{ code: 10002, message: "Unauthorized" }] } });
    expect((await inspectSetupSteps(cloud.api, ACCOUNT))[0]).toMatchObject({ step: "log-bucket", done: false, foreign: true });
    await expect(applySetupSteps(cloud.api, ACCOUNT, input())).rejects.toThrow(/R2 bucket prototype-logs already exists but belongs to another account.*nothing was changed/);
    expect(writes(cloud)).toEqual([]);
  });

  it("a token without the permission to create the signing credential (the everyday token among them) is refused before any change, naming it", async () => {
    const cloud = freshCloud();
    await expect(applySetupSteps(cloud.everydayApi, ACCOUNT, input())).rejects.toThrow(/nothing was changed/);
    const lacking = freshCloud();
    lacking.tokenPolicies = [];
    await expect(applySetupSteps(lacking.api, ACCOUNT, input())).rejects.toThrow(/Account API Tokens Write.*nothing was changed/);
    for (const c of [cloud, lacking]) {
      expect(writes(c)).toEqual([]);
      expect(c.buckets.size).toBe(0);
    }
  });

  it("a refused read of a step stops the apply before any change", async () => {
    const cloud = await setUpCloud();
    cloud.buckets.delete("prototype-logs");
    cloud.override.set(`GET /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/${encodeURIComponent("framework/r2-signing.json")}`, { status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } });
    await expect(applySetupSteps(cloud.api, ACCOUNT, input())).rejects.toThrow(/403/);
    expect(writes(cloud)).toEqual([]);
    expect(cloud.buckets.has("prototype-logs")).toBe(false);
  });

  it("an unknown step is refused before any request", async () => {
    const cloud = freshCloud();
    await expect(applySetupSteps(cloud.api, ACCOUNT, input({ steps: ["no-such-step" as SetupStepId] }))).rejects.toThrow(/unknown setup step no-such-step/);
    expect(cloud.requests).toEqual([]);
  });
});

describe("the account setup record (plan-setup-wizard §4.4, DEC-0577)", () => {
  it("keeps the object's other fields when it is written", async () => {
    const cloud = await setUpCloud();
    cloud.objectBodies.set(RECORD, { ...(cloud.objectBodies.get(RECORD) as object), futureField: "kept" });
    await writeSetupRecord(cloud.api, ACCOUNT, { completedSteps: SETUP_STEPS, setupVersion: 3, frameworkVersion: "0.3.0", now: () => NOW }, false);
    expect(cloud.objectBodies.get(RECORD)).toMatchObject({ futureField: "kept", setupVersion: 3 });
  });

  it("an invalid or incomplete record reads as none; step names this release does not know are left out", () => {
    const good = { setupVersion: 1, frameworkVersion: "0.1.0", appliedAt: NOW.toISOString(), completedSteps: ["state-bucket", "a-future-step", "log-bucket"] };
    expect(parseSetupRecord(good)?.completedSteps).toEqual(["log-bucket", "state-bucket"]);
    expect(parseSetupRecord(undefined)).toBeUndefined();
    expect(parseSetupRecord({})).toBeUndefined();
    // An email domain is not a setup field since v0.2.0: a record without one is valid.
    expect(parseSetupRecord({ ...good, emailDomain: "example.test" })).toEqual(parseSetupRecord(good));
    for (const field of ["setupVersion", "frameworkVersion", "appliedAt", "completedSteps"]) {
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
    expect((await checkAccountSetup(cloud.everydayApi, ACCOUNT, 1)).current).toBe(false);
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
    expect((await runSetupAccount(target, captureIo())).status).toBe(0);
    expect(writes(cloud).at(-1)).toBe(`PUT /accounts/${ACCOUNT}/r2/buckets/sst-state/objects/framework%2Faccount.json`);
    expect(await checkAccountSetup(cloud.everydayApi, ACCOUNT, 1)).toEqual({
      record: { setupVersion: 1, frameworkVersion: "0.1.0", appliedAt: NOW.toISOString(), completedSteps: [...SETUP_STEPS] },
      current: true,
      missing: [],
    });
    cloud.requests.length = 0;
    expect(await runSetupAccount(target, captureIo())).toEqual({ status: 0, created: [] });
    expect(writes(cloud)).toEqual([]);
    // The steps' own apply agrees: nothing to do.
    expect((await applySetupSteps(cloud.api, ACCOUNT, input())).applied).toEqual([]);
  });

  it("says whether it wrote the setup record: yes for an old record without the setup fields, no on a second run", async () => {
    const cloud = await setUpCloud();
    cloud.objectBodies.set(RECORD, { emailDomain: "example.test" });
    expect(await applySetupSteps(cloud.api, ACCOUNT, input())).toMatchObject({ applied: [], written: true });
    expect(await applySetupSteps(cloud.api, ACCOUNT, input())).toMatchObject({ applied: [], written: false });
  });
});
