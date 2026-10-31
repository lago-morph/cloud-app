// listing.ts runs the runners as child processes (root cause 2026-10-31-selection-e2e004-under-load,
// binding fixes 1 and 2). These tests run `npx <stub>` in a throwaway project whose node_modules/.bin
// holds a stub runner, so the child goes through the same npx layer as `npx vitest` in the repository,
// and no real runner is started.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runnerSelection, type RunnerSelection } from "../harness/selection.js";
import { driverListingLimitMs, FrameworkBuildMissingError, LISTING_CHILD_TIMEOUT_MS, LISTING_OVERHEAD_MS, ListingTimeoutError, listSelection } from "./listing.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A project with a stub runner `bin` (Node source) and, when `built`, the framework build's entry point. */
function project(bin: string, source: string, built: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "listing-unit-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "listing-unit-stub", private: true }));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".bin", bin), `#!/usr/bin/env node\n${source}\n`);
  chmodSync(join(root, "node_modules", ".bin", bin), 0o755);
  if (built) {
    mkdirSync(join(root, "packages", "framework", "dist", "testing"), { recursive: true });
    writeFileSync(join(root, "packages", "framework", "dist", "testing", "index.js"), "export {};\n");
  }
  return root;
}

/** Whether `pid` is a live process (a zombie awaiting its reaper counts as gone). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
}

/** The pids among `pids` still alive after up to `ms` (a killed process may take a moment to exit). */
function survivors(pids: readonly number[], ms = 2_000): number[] {
  const until = Date.now() + ms;
  let left = pids.filter(alive);
  while (left.length > 0 && Date.now() < until) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    left = left.filter(alive);
  }
  return left;
}

// The stub starts a grandchild, as Vitest starts its pool workers, records its own pid, its parent's
// (npm exec's) and the grandchild's, and then never exits.
const HANG = `const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(require("node:path").join(process.cwd(), "pids.json"), JSON.stringify([process.pid, process.ppid, worker.pid]));
setInterval(() => {}, 1000);`;

describe("listing child processes are bounded", () => {
  it("a child that never exits is killed with its process group at the timeout, and the listing throws ListingTimeoutError", () => {
    const root = project("hang-runner", HANG, true);
    const selection: RunnerSelection = { runner: "playwright", label: "stub", args: ["hang-runner"] };
    const started = Date.now();
    let thrown: unknown;
    try {
      // 10 s leaves npx's start-up (about 0.3 s idle) room under heavy load before the stub records its pids.
      listSelection(selection, { root, timeoutMs: 10_000 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ListingTimeoutError);
    expect((thrown as Error).name).toBe("ListingTimeoutError");
    expect((thrown as Error).message).toMatch(/^stub: `npx hang-runner --list --reporter=json` timed out after 10 s; listing incomplete/);
    expect(Date.now() - started).toBeLessThan(25_000);
    // The stub ran (it recorded its pids) and nothing it started is left.
    const pids = JSON.parse(readFileSync(join(root, "pids.json"), "utf8")) as number[];
    expect(pids).toHaveLength(3);
    expect(survivors(pids)).toEqual([]);
  }, 40_000);
});

describe("a listing test's own limit (binding fix 4)", () => {
  it("is every runner's limit plus the overhead, so it never fires before a runner's limit does", () => {
    for (const target of ["local", "cloudflare"] as const) {
      expect(driverListingLimitMs(target), target).toBe(runnerSelection({ target }).length * LISTING_CHILD_TIMEOUT_MS + LISTING_OVERHEAD_MS);
    }
    expect(driverListingLimitMs("cloudflare")).toBe(2 * 300_000 + 30_000);
  });
});

describe("listing needs the framework build", () => {
  it("without packages/framework/dist, the listing fails before starting a runner and names the build command", () => {
    const root = project("ran-runner", `require("node:fs").writeFileSync(require("node:path").join(process.cwd(), "ran"), "");`, false);
    const selection: RunnerSelection = { runner: "vitest", label: "stub", args: ["ran-runner"] };
    expect(() => listSelection(selection, { root })).toThrow(FrameworkBuildMissingError);
    expect(() => listSelection(selection, { root })).toThrow(/npm run build -w packages\/framework/);
    expect(existsSync(join(root, "ran")), "no runner started").toBe(false);
  });

  it("with the build present, the same listing runs its runner", () => {
    const root = project("ran-runner", `require("node:fs").writeFileSync(require("node:path").join(process.cwd(), "ran"), "");`, true);
    const listing = listSelection({ runner: "vitest", label: "stub", args: ["ran-runner"] }, { root });
    expect(existsSync(join(root, "ran"))).toBe(true);
    // The stub writes no report, so the listing is empty and says so.
    expect(listing.tests).toEqual([]);
  });
});
