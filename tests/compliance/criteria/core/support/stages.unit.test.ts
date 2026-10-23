/**
 * C-T1's `withFurtherStage` against local fakes: a fake framework CLI and a stubbed D1 `fetch`
 * (root cause ai/implementation/root-causes/2026-10-23-cloud-test-paths.md, red tests R2a, R2b
 * and the Review's lock-release case for `scratchCopy`). No cloud call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { D1_AVAILABLE_ENV, D1_STOP_DETAIL, MAX_D1_DATABASES } from "../../_cloud/d1.js";
import { installCloudFakes, lockHeld, otherStageDatabases, type CloudFakes } from "../../_fakes/cloud-fakes.js";
import { REFERENCE_DIR } from "./repo.js";
import { withFurtherStage } from "./stages.js";

const control = vi.hoisted(() => ({ failCopy: false, lockHeldAtCopy: undefined as boolean | undefined, lockPath: "" }));

vi.mock("./repo.js", async (importOriginal) => {
  const { FAKE_CLI, fakeFrameworkDir } = await import("../../_fakes/cloud-fakes.js");
  return { ...(await importOriginal<typeof import("./repo.js")>()), BIN: FAKE_CLI, FRAMEWORK_DIR: fakeFrameworkDir() };
});

vi.mock("./processes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./processes.js")>();
  const { existsSync } = await import("node:fs");
  return {
    ...actual,
    scratchCopy: (...args: Parameters<typeof actual.scratchCopy>) => {
      if (control.failCopy) {
        control.lockHeldAtCopy = existsSync(control.lockPath);
        return Promise.reject(new Error("scratch copy failed (test)"));
      }
      return actual.scratchCopy(...args);
    },
  };
});

let fakes: CloudFakes;
beforeEach(() => {
  fakes = installCloudFakes();
  control.failCopy = false;
  control.lockHeldAtCopy = undefined;
  control.lockPath = fakes.lockPath;
});
afterEach(() => {
  fakes.dispose();
});

const SECRETS = { apiKey: "k-further-fake" };

describe("withFurtherStage guards", () => {
  it("R2a: with the D1 stop in force it rejects with the DEC-0317 detail before any CLI call", async () => {
    vi.stubEnv(D1_AVAILABLE_ENV, "");
    const body = vi.fn(() => Promise.resolve());
    await expect(withFurtherStage(REFERENCE_DIR, "r2a", SECRETS, body)).rejects.toThrow(D1_STOP_DETAIL);
    expect(fakes.calls()).toEqual([]);
    expect(body).not.toHaveBeenCalled();
  });

  it("R2b: with the cap's worth of test-stage databases present it rejects with the DEC-0419 cap before any CLI call, and releases the lock", async () => {
    fakes.extraDatabases.push(...otherStageDatabases(MAX_D1_DATABASES));
    const body = vi.fn(() => Promise.resolve());
    await expect(withFurtherStage(REFERENCE_DIR, "r2b", SECRETS, body)).rejects.toThrow(/DEC-0419/);
    expect(fakes.calls()).toEqual([]);
    expect(body).not.toHaveBeenCalled();
    expect(lockHeld(fakes)).toBe(false);
  });

  it("releases the lock when the scratch copy throws", async () => {
    control.failCopy = true;
    await expect(withFurtherStage(REFERENCE_DIR, "copyfail", SECRETS, () => Promise.resolve())).rejects.toThrow("scratch copy failed (test)");
    expect(control.lockHeldAtCopy, "the lock was held when the copy failed").toBe(true);
    expect(lockHeld(fakes)).toBe(false);
    expect(fakes.calls()).toEqual([]);
  });

  it("with room, deploys (secret after the first deploy), runs the body and removes the stage", async () => {
    const seen = await withFurtherStage(REFERENCE_DIR, "ok", SECRETS, (stage) => Promise.resolve(stage.baseUrl));
    expect(seen).toMatch(/^https:\/\/reference-test-[a-z0-9]+\.example\.workers\.dev$/);
    expect(fakes.commands()).toEqual(["deploy", "secrets set apiKey", "deploy", "remove"]);
    expect(lockHeld(fakes)).toBe(false);
  });
});
