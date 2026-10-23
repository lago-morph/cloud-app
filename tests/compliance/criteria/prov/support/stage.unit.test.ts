/**
 * The shared stage guards (`takeStageRoom`) and the out-of-band removal of `withCloudStage`
 * against local fakes: a fake framework CLI and a stubbed D1 `fetch` (root cause
 * ai/implementation/root-causes/2026-10-23-cloud-test-paths.md, red tests R3a–R3c and the
 * Review's lock-release cases). No cloud call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { D1_AVAILABLE_ENV, D1_STOP_DETAIL } from "../../_cloud/d1.js";
import { installCloudFakes, lockHeld, type CloudFakes } from "../../_fakes/cloud-fakes.js";
import { REFERENCE_DIR } from "../../core/support/repo.js";
import { holdStages, runCli, takeStageRoom, withCloudStage, type CloudStage } from "./stage.js";

vi.mock("../../core/support/repo.js", async (importOriginal) => {
  const { FAKE_CLI, fakeFrameworkDir } = await import("../../_fakes/cloud-fakes.js");
  return { ...(await importOriginal<typeof import("../../core/support/repo.js")>()), BIN: FAKE_CLI, FRAMEWORK_DIR: fakeFrameworkDir() };
});

let fakes: CloudFakes;
beforeEach(() => {
  fakes = installCloudFakes();
});
afterEach(() => {
  fakes.dispose();
});

const OPTIONS = { appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: "k-prov-fake" }, databases: 1 } as const;

const removeOutOfBand = (stage: CloudStage) => runCli(["remove", "--target", "cloudflare", "--stage", stage.stage], { cwd: stage.copy.dir });
const removes = (): number => fakes.commands().filter((c) => c === "remove").length;

describe("takeStageRoom", () => {
  it("applies the D1 stop before taking the lock", async () => {
    vi.stubEnv(D1_AVAILABLE_ENV, "");
    await expect(Promise.resolve().then(() => takeStageRoom(1, "a test stage"))).rejects.toThrow(D1_STOP_DETAIL);
    expect(lockHeld(fakes)).toBe(false);
  });

  it("checks the cap under the lock and releases the lock when the check rejects", async () => {
    fakes.extraDatabases.push("reference-test-a-db-1", "reference-test-b-db-1");
    let heldAtList: boolean | undefined;
    fakes.onList = () => (heldAtList = lockHeld(fakes));
    await expect(Promise.resolve().then(() => takeStageRoom(1, "a test stage"))).rejects.toThrow(/DEC-0318/);
    expect(heldAtList).toBe(true);
    expect(lockHeld(fakes)).toBe(false);
  });

  it("returns the release of the lock it holds", async () => {
    const release = await takeStageRoom(2, "a test stage");
    expect(lockHeld(fakes)).toBe(true);
    await release();
    expect(lockHeld(fakes)).toBe(false);
  });

  it("holdStages releases the lock when its body throws", async () => {
    await expect(holdStages(2, "two stages", () => Promise.reject(new Error("body failed")))).rejects.toThrow("body failed");
    expect(lockHeld(fakes)).toBe(false);
  });
});

describe("withCloudStage: a removal made by another actor (R3a–R3c)", () => {
  it("R3a: after a successful out-of-band removal with nothing left, the cleanup runs no second remove", async () => {
    await withCloudStage(OPTIONS, async (stage) => {
      await stage.deployReady();
      const r = await removeOutOfBand(stage);
      expect(r.status).toBe(0);
      stage.removedElsewhere(r, []);
    });
    expect(removes()).toBe(1);
    expect(lockHeld(fakes)).toBe(false);
  });

  it("R3b: when the out-of-band removal exits 1, the cleanup still runs one remove", async () => {
    await withCloudStage(OPTIONS, async (stage) => {
      await stage.deployReady();
      fakes.failRemove(true);
      const r = await removeOutOfBand(stage);
      expect(r.status).toBe(1);
      fakes.failRemove(false);
      stage.removedElsewhere(r, []);
    });
    expect(removes()).toBe(2);
  });

  it("R3c: when the out-of-band removal exits 0 but resources are left, the cleanup still runs one remove", async () => {
    await withCloudStage(OPTIONS, async (stage) => {
      await stage.deployReady();
      const r = await removeOutOfBand(stage);
      expect(r.status).toBe(0);
      stage.removedElsewhere(r, [`worker reference-${stage.stage}`]);
    });
    expect(removes()).toBe(2);
  });
});
