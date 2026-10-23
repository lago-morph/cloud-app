/**
 * The Cloudflare path of the MIG stage (support/stage.ts) against local fakes: a fake framework
 * CLI and a stubbed D1 `fetch` (root cause ai/implementation/root-causes/2026-10-23-cloud-test-paths.md,
 * red tests R1a, R1b, R1d, R4a and the Review's lock-release cases). No cloud call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { D1_AVAILABLE_ENV, D1_STOP_DETAIL, MAX_D1_DATABASES } from "../../_cloud/d1.js";
import { FAKE_TABLES, installCloudFakes, lockHeld, otherStageDatabases, pause, type CloudFakes } from "../../_fakes/cloud-fakes.js";
import { acquireLock } from "../../core/support/processes.js";
import { createStage, snapshot } from "./stage.js";

const control = vi.hoisted(() => ({ failNewTestStage: false, lockHeldAtNewTestStage: undefined as boolean | undefined, lockPath: "" }));

vi.mock("../../core/support/repo.js", async (importOriginal) => {
  const { FAKE_CLI, fakeFrameworkDir } = await import("../../_fakes/cloud-fakes.js");
  return { ...(await importOriginal<typeof import("../../core/support/repo.js")>()), BIN: FAKE_CLI, FRAMEWORK_DIR: fakeFrameworkDir() };
});

vi.mock("../../../harness/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../harness/index.js")>();
  const { existsSync } = await import("node:fs");
  return {
    ...actual,
    newTestStage: () => {
      if (control.failNewTestStage) {
        control.lockHeldAtNewTestStage = existsSync(control.lockPath);
        throw new Error("newTestStage failed (test)");
      }
      return actual.newTestStage();
    },
  };
});

const SECRET = "k-fake-secret-value";

let fakes: CloudFakes;
beforeEach(() => {
  fakes = installCloudFakes();
  control.failNewTestStage = false;
  control.lockHeldAtNewTestStage = undefined;
  control.lockPath = fakes.lockPath;
});
afterEach(() => {
  fakes.dispose();
});

describe("MIG cloud stage: secret order (R1a, R1b)", () => {
  it("R1a: the first deploy stops on the unset secret, then secrets set (value on stdin) and deploy again", async () => {
    const stage = await createStage({ secrets: { apiKey: SECRET } });
    try {
      const result = await stage.deploy("v1");
      expect(result.ok, result.output).toBe(true);
      expect(fakes.commands()).toEqual(["deploy", "secrets set apiKey", "deploy"]);
      expect(fakes.calls()[1]?.stdin).toBe(SECRET);
      expect(stage.baseUrl()).toBe(`https://reference-${stage.stage}.example.workers.dev`);
    } finally {
      await stage.remove();
    }
  });

  it("R1b: a later deploy that fails for another reason is not retried and sets no secret", async () => {
    const stage = await createStage({ secrets: { apiKey: SECRET } });
    try {
      expect((await stage.deploy("v1")).ok).toBe(true);
      const before = fakes.commands().length;
      fakes.failNextDeploy();
      const failed = await stage.deploy("unique-fail");
      expect(failed.ok).toBe(false);
      expect(failed.status).toBe(1);
      expect(fakes.commands().slice(before)).toEqual(["deploy"]);
    } finally {
      await stage.remove();
    }
  });

  it("a first deploy that fails for another reason is not retried either", async () => {
    const stage = await createStage({ secrets: { apiKey: SECRET } });
    try {
      fakes.failNextDeploy();
      expect((await stage.deploy("v1")).ok).toBe(false);
      expect(fakes.commands()).toEqual(["deploy"]);
    } finally {
      await stage.remove();
    }
  });
});

describe("MIG cloud stage: guards (R1d) and the lock on every failure path", () => {
  it("R1d: with the D1 stop in force, createStage rejects with the DEC-0317 detail and runs no CLI command", async () => {
    vi.stubEnv(D1_AVAILABLE_ENV, "");
    await expect(Promise.resolve().then(() => createStage({ secrets: { apiKey: SECRET } }))).rejects.toThrow(D1_STOP_DETAIL);
    expect(fakes.calls()).toEqual([]);
    expect(lockHeld(fakes)).toBe(false);
  });

  it("R1d: when its two databases would exceed the cap, createStage rejects with the DEC-0419 cap, runs no CLI command and releases the lock", async () => {
    fakes.extraDatabases.push(...otherStageDatabases(MAX_D1_DATABASES - 1));
    let heldAtList: boolean | undefined;
    fakes.onList = () => (heldAtList = lockHeld(fakes));
    await expect(Promise.resolve().then(() => createStage({ secrets: { apiKey: SECRET } }))).rejects.toThrow(/DEC-0419/);
    expect(fakes.calls()).toEqual([]);
    expect(heldAtList, "the cap is checked under the lock").toBe(true);
    expect(lockHeld(fakes), "the lock is released after the rejection").toBe(false);
  });

  it("R1d: while another holder has the further-stage lock, the stage makes no CLI call", async () => {
    const release = await acquireLock("further-stage", 5_000);
    let done = false;
    const work = Promise.resolve()
      .then(() => createStage({ secrets: { apiKey: SECRET } }))
      .then(async (stage) => {
        try {
          return await stage.deploy("v1");
        } finally {
          await stage.remove();
          done = true;
        }
      });
    try {
      await pause(1_500);
      expect(fakes.calls(), "CLI calls while the lock is held elsewhere").toEqual([]);
      expect(done).toBe(false);
    } finally {
      await release();
    }
    expect((await work).ok).toBe(true);
    expect(fakes.commands()).toEqual(["deploy", "secrets set apiKey", "deploy", "remove"]);
  });

  it("createStage releases the lock when a step after it throws", async () => {
    control.failNewTestStage = true;
    await expect(Promise.resolve().then(() => createStage({ secrets: { apiKey: SECRET } }))).rejects.toThrow("newTestStage failed (test)");
    expect(control.lockHeldAtNewTestStage, "the lock was held when the step failed").toBe(true);
    expect(lockHeld(fakes)).toBe(false);
  });

  it("the stage holds the lock until remove(), which releases it even when remove exits non-zero", async () => {
    const stage = await createStage({ secrets: { apiKey: SECRET } });
    expect((await stage.deploy("v1")).ok).toBe(true);
    expect(lockHeld(fakes), "held while the stage exists").toBe(true);
    fakes.failRemove(true);
    await expect(stage.remove()).rejects.toThrow(/remove --target cloudflare/);
    expect(lockHeld(fakes)).toBe(false);
  });

  it("remove() runs no `remove` when no deploy was attempted", async () => {
    const stage = await createStage({ secrets: { apiKey: SECRET } });
    await stage.remove();
    expect(fakes.calls()).toEqual([]);
    expect(lockHeld(fakes)).toBe(false);
  });
});

describe("MIG cloud stage: D1 requests (R4a)", () => {
  it("R4a: the database list is read once per deploy and per databases(), never per query", async () => {
    const stage = await createStage({ secrets: { apiKey: SECRET } });
    try {
      const listsAfterCreate = fakes.listCount();
      let deploys = 0;
      let databaseCalls = 0;
      expect((await stage.deploy("v1")).ok).toBe(true);
      deploys++;
      await stage.query("SELECT 1");
      await snapshot(stage);
      expect(await stage.databases()).toEqual([`reference-${stage.stage}-db-1`]);
      databaseCalls++;
      // The current database changes (lowest -db-<n>) during a deploy that fails: it is re-read after it.
      fakes.extraDatabases.push(`reference-${stage.stage}-db-0`);
      fakes.failNextDeploy();
      expect((await stage.deploy("unique-fail")).ok).toBe(false);
      deploys++;
      await snapshot(stage);
      await stage.query("SELECT 2");
      expect(fakes.listCount() - listsAfterCreate).toBeLessThanOrEqual(deploys + databaseCalls);
      expect(fakes.fetches.at(-1)?.path, "the query after the failed deploy goes to the database read after it").toContain(`uuid-reference-${stage.stage}-db-0`);
    } finally {
      await stage.remove();
    }
  });

  it("R4a: one snapshot() makes at most two /query calls and reads every table", async () => {
    const stage = await createStage({ secrets: { apiKey: SECRET } });
    try {
      expect((await stage.deploy("v1")).ok).toBe(true);
      const before = fakes.queryCount();
      const snap = await snapshot(stage);
      expect(fakes.queryCount() - before).toBeLessThanOrEqual(2);
      expect(Object.keys(snap)).toEqual(FAKE_TABLES);
      for (const t of FAKE_TABLES) expect(snap[t]).toEqual([{ id: 1, sql: `SELECT * FROM "${t}"` }]);
    } finally {
      await stage.remove();
    }
  });
});
