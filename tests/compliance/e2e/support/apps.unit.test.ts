/**
 * The E2E stage guards (`withE2EStages` for E2E-010 and E2E-012, `setSecretThenDeploy` for
 * E2E-014's cloud part) against local fakes: a fake framework CLI and a stubbed D1 `fetch`
 * (root cause ai/implementation/root-causes/2026-10-23-cloud-test-paths.md, red tests R2c, R2d).
 * No cloud call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { D1_AVAILABLE_ENV, D1_STOP_DETAIL } from "../../criteria/_cloud/d1.js";
import { installCloudFakes, lockHeld, pause, type CloudFakes } from "../../criteria/_fakes/cloud-fakes.js";
import { setSecretThenDeploy, withE2EStages } from "./apps.js";
import { REFERENCE_DIR } from "./process.js";

vi.mock("./process.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./process.js")>();
  const { FAKE_CLI } = await import("../../criteria/_fakes/cloud-fakes.js");
  return {
    ...actual,
    frameworkCli: (appDir: string, args: readonly string[], options: Parameters<typeof actual.frameworkCli>[2]) => actual.run(process.execPath, [FAKE_CLI, ...args], { cwd: appDir, ...options }),
  };
});

let fakes: CloudFakes;
beforeEach(() => {
  fakes = installCloudFakes();
});
afterEach(() => {
  fakes.dispose();
});

describe("withE2EStages (E2E-010, E2E-012)", () => {
  it("R2c: rejects with the DEC-0317 detail while the D1 stop holds, without running the body", async () => {
    vi.stubEnv(D1_AVAILABLE_ENV, "");
    const body = vi.fn(() => Promise.resolve());
    await expect(Promise.resolve().then(() => withE2EStages(2, "E2E-010 (v1 → v2 on its own stage)", body))).rejects.toThrow(D1_STOP_DETAIL);
    expect(body).not.toHaveBeenCalled();
  });

  it("R2c: rejects with the DEC-0318 cap when a test-stage database exists, without running the body, and releases the lock", async () => {
    fakes.extraDatabases.push("reference-test-a-db-1");
    const body = vi.fn(() => Promise.resolve());
    await expect(Promise.resolve().then(() => withE2EStages(2, "E2E-012 (two stages)", body))).rejects.toThrow(/DEC-0318/);
    expect(body).not.toHaveBeenCalled();
    expect(lockHeld(fakes)).toBe(false);
  });

  it("R2c: two concurrent calls run one after the other", async () => {
    const spans: { start: number; end: number }[] = [];
    const body = async (): Promise<void> => {
      const start = Date.now();
      await pause(400);
      spans.push({ start, end: Date.now() });
    };
    await Promise.all([withE2EStages(2, "E2E-010", body), withE2EStages(2, "E2E-012", body)]);
    expect(spans).toHaveLength(2);
    const [first, second] = [...spans].sort((a, b) => a.start - b.start);
    expect(second?.start ?? 0).toBeGreaterThanOrEqual(first?.end ?? Number.POSITIVE_INFINITY);
    expect(lockHeld(fakes)).toBe(false);
  });
});

describe("setSecretThenDeploy (E2E-014 cloud part)", () => {
  it("R2d: rejects with the DEC-0317 detail before `secrets set` while the D1 stop holds", async () => {
    vi.stubEnv(D1_AVAILABLE_ENV, "");
    fakes.existingWorker("test-x");
    await expect(Promise.resolve().then(() => setSecretThenDeploy(REFERENCE_DIR, "cloudflare", "test-x", "apiKey", "v-e2e014"))).rejects.toThrow(D1_STOP_DETAIL);
    expect(fakes.calls()).toEqual([]);
  });

  it("with D1 available it sets the secret (value on stdin) and then deploys", async () => {
    fakes.existingWorker("test-x", []);
    const deployed = await setSecretThenDeploy(REFERENCE_DIR, "cloudflare", "test-x", "apiKey", "v-e2e014");
    expect(deployed.origin).toBe("https://reference-test-x.example.workers.dev");
    expect(fakes.commands()).toEqual(["secrets set apiKey", "deploy"]);
    expect(fakes.calls()[0]?.stdin).toBe("v-e2e014");
  });
});
