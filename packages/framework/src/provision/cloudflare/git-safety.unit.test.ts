import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commandGitSafetyWarnings, ensureEnvCloudflareIgnored, gitSafetyWarnings, inspectGitSafety, KEEP_TRACKED_MARKER, type GitSafety } from "./git-safety.js";

const MARKER = "zzLEAKMARKERzz";

let dir: string;
const git = (...args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: "ignore" });
const writeEnvFile = (): void => writeFileSync(join(dir, ".env.cloudflare"), `CLOUDFLARE_API_TOKEN=fake-${MARKER}\n`);
const gitignore = (): string => readFileSync(join(dir, ".gitignore"), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pf-git-safety-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const safety = (over: Partial<GitSafety>): GitSafety => ({ isRepo: true, fileExists: true, ignored: true, tracked: false, keepTrackedMarker: false, ...over });

describe("git-ignore safety of .env.cloudflare (plan-setup-wizard §4.3 step 1, §4.5; DEC-0572)", () => {
  it("not a git repository: setup's warning; other commands print none; nothing throws", () => {
    writeEnvFile();
    const state = inspectGitSafety(dir);
    expect(state).toEqual({ isRepo: false, fileExists: true, ignored: false, tracked: false, keepTrackedMarker: false });
    const warnings = gitSafetyWarnings(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^This project is not a git repository/);
    expect(commandGitSafetyWarnings(state)).toEqual([]);
    expect(ensureEnvCloudflareIgnored(dir)).toBe("not-a-repo");
    expect(inspectGitSafety(join(dir, "does-not-exist")).isRepo).toBe(false);
  });

  it("a file git does not ignore: one warning naming the .gitignore line; ensure adds it once", () => {
    git("init", "-q");
    writeEnvFile();
    const state = inspectGitSafety(dir);
    expect(state).toEqual({ isRepo: true, fileExists: true, ignored: false, tracked: false, keepTrackedMarker: false });
    const warnings = gitSafetyWarnings(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("git does not ignore it");
    expect(warnings[0]).toContain('Add the line ".env.cloudflare" to .gitignore');
    expect(commandGitSafetyWarnings(state)).toEqual(warnings);

    writeFileSync(join(dir, ".gitignore"), "node_modules/");
    expect(ensureEnvCloudflareIgnored(dir)).toBe("added");
    expect(gitignore()).toBe("node_modules/\n# Cloudflare tokens (never commit)\n.env.cloudflare\n");
    expect(ensureEnvCloudflareIgnored(dir)).toBe("already");
    expect(inspectGitSafety(dir).ignored).toBe(true);
    expect(gitSafetyWarnings(inspectGitSafety(dir))).toEqual([]);
  });

  it("ignored by a rule elsewhere (a parent .gitignore) counts as already ignored", () => {
    git("init", "-q");
    writeFileSync(join(dir, ".gitignore"), ".env.*\n");
    mkdirSync(join(dir, "app"));
    const app = join(dir, "app");
    writeFileSync(join(app, ".env.cloudflare"), "x=1\n");
    expect(ensureEnvCloudflareIgnored(app)).toBe("already");
    expect(inspectGitSafety(app)).toMatchObject({ isRepo: true, fileExists: true, ignored: true, tracked: false });
  });

  it("no file and not tracked: no warning", () => {
    git("init", "-q");
    expect(gitSafetyWarnings(inspectGitSafety(dir))).toEqual([]);
  });

  it("the keep-tracked marker: ensure leaves .gitignore alone, and the warning still prints and names the marker", () => {
    git("init", "-q");
    writeEnvFile();
    writeFileSync(join(dir, ".gitignore"), `${KEEP_TRACKED_MARKER}\n`);
    expect(ensureEnvCloudflareIgnored(dir)).toBe("kept-tracked-marker");
    expect(gitignore()).toBe(`${KEEP_TRACKED_MARKER}\n`);
    const state = inspectGitSafety(dir);
    expect(state.keepTrackedMarker).toBe(true);
    const warnings = gitSafetyWarnings(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`"${KEEP_TRACKED_MARKER}"`);
  });

  it("a tracked file: the tokens are in the history, and how to replace them; even when .gitignore lists it", () => {
    git("init", "-q");
    writeEnvFile();
    git("add", ".env.cloudflare");
    writeFileSync(join(dir, ".gitignore"), ".env.cloudflare\n");
    const state = inspectGitSafety(dir);
    expect(state).toEqual({ isRepo: true, fileExists: true, ignored: false, tracked: true, keepTrackedMarker: false });
    expect(ensureEnvCloudflareIgnored(dir)).toBe("already");
    const warnings = gitSafetyWarnings(state);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("tracked by git, so the Cloudflare tokens in it are in the repository's history");
    expect(warnings[0]).toContain("delete them in the Cloudflare dashboard");
    expect(warnings[0]).toContain("git rm --cached .env.cloudflare");
    expect(warnings[0]).toContain("npm run cloudflare-setup");
    // Deleted from the work tree but still in the index: still tracked, still warned.
    rmSync(join(dir, ".env.cloudflare"));
    expect(gitSafetyWarnings(inspectGitSafety(dir))[0]).toContain("tracked by git");
  });

  it("warnings are text only and never hold a file value", () => {
    git("init", "-q");
    writeEnvFile();
    for (const s of [inspectGitSafety(dir), safety({ tracked: true, ignored: false }), safety({ ignored: false }), safety({ isRepo: false })]) {
      for (const w of gitSafetyWarnings(s)) expect(w).not.toContain(MARKER);
    }
  });
});
