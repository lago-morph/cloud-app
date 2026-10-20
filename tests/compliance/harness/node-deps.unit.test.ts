import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deployOrigin, devOrigin, pendingStageStore, readVersions } from "./node-deps.js";

const repo = new URL("../../../", import.meta.url).pathname;
let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("driver process helpers", () => {
  it("finds the origin `dev` prints", () => {
    expect(devOrigin("dev: built reference\n\n  reference is running at http://localhost:5179/  (client and /api; Ctrl-C stops)\n")).toBe("http://localhost:5179");
    expect(devOrigin("dev: built reference\n")).toBeUndefined();
  });

  it("finds the stage's workers.dev origin in deploy output", () => {
    expect(deployOrigin("deploy: done\nPublic origin: https://reference-test-abc.sub.workers.dev\n")).toBe("https://reference-test-abc.sub.workers.dev");
    expect(deployOrigin("deploy: done\n")).toBeUndefined();
  });

  it("keeps pending test stages in a file, per target", () => {
    dir = mkdtempSync(join(tmpdir(), "pending-"));
    const store = pendingStageStore(join(dir, "sub", "pending-stages.json"));
    expect(store.list("cloudflare")).toEqual([]);
    store.add("cloudflare", "test-a");
    store.add("cloudflare", "test-b");
    store.add("cloudflare", "test-a");
    store.remove("cloudflare", "test-b");
    expect(pendingStageStore(join(dir, "sub", "pending-stages.json")).list("cloudflare")).toEqual(["test-a"]);
    expect(store.list("aws")).toEqual([]);
  });

  it("reads exact framework and dependency versions from the installed packages", () => {
    const versions = readVersions(repo);
    expect(versions["@lago-morph/prototype-framework"]).toBe("0.1.0");
    expect(versions.node).toBe(process.version);
    expect(versions.vitest).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions["@playwright/test"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(versions.wrangler).toMatch(/^\d+\.\d+\.\d+/);
  });
});
