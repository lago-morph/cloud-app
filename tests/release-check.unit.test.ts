// Unit tests for the release gate scripts/release-check.mjs (used by .github/workflows/release.yml).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { changelogSection, check, versions } from "../scripts/release-check.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["packages/framework/package.json", "packages/create-prototype-app/package.json", "packages/prototype-framework-skill/package.json", "apps/template/package.json", "skill/.claude-plugin/plugin.json"];

/** A copy of the version-bearing files, with CHANGELOG.md set to `changelog`. */
function fixture(changelog: string): string {
  const dir = mkdtempSync(join(tmpdir(), "release-check-"));
  for (const f of FILES) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(REPO, f), join(dir, f));
  }
  writeFileSync(join(dir, "CHANGELOG.md"), changelog);
  return dir;
}

const fwVersion = (JSON.parse(readFileSync(join(REPO, "packages/framework/package.json"), "utf8")) as { version: string }).version;

describe("release-check", () => {
  it("the repository's versions all agree (framework, create starter, skill package, template pin, plugin)", () => {
    expect(new Set(versions(REPO).map(([, v]) => v))).toEqual(new Set([fwVersion]));
  });

  it("accepts the matching tag with a dated CHANGELOG section and returns its notes", () => {
    const dir = fixture(`# Changelog\n\n## [${fwVersion}] - 2026-11-01\n\n### Added\n\n- x\n\n## [0.0.1] - 2026-01-01\n\n- old\n\n[${fwVersion}]: https://e/x\n`);
    const r = check(dir, `v${fwVersion}`);
    expect(r.problems).toEqual([]);
    expect(r.notes).toBe("### Added\n\n- x");
    expect(r.prerelease).toBe(false);
  });

  it("refuses a tag that does not match, a missing or undated section, and a non-semver tag", () => {
    const dated = fixture(`## [${fwVersion}] - 2026-11-01\n`);
    expect(check(dated, "v9.9.9").problems.join("\n")).toMatch(/the tag says 9\.9\.9/);
    expect(check(dated, "release-1").problems).toEqual(['tag "release-1" is not v<semver>']);
    const undated = fixture(`## [${fwVersion}] - unreleased\n`);
    expect(check(undated, `v${fwVersion}`).problems.join("\n")).toMatch(/must be dated/);
    expect(changelogSection("## [1.0.0] - 2026-01-01\n", "0.1.0").error).toMatch(/no "## \[0\.1\.0\]" section/);
  });

  it("marks a version with a pre-release part as a prerelease", () => {
    const dir = fixture(`## [${fwVersion}-rc.1] - 2026-11-01\n- x\n`);
    // The files say fwVersion, so the versions do not match; the classification still holds.
    expect(check(dir, `v${fwVersion}-rc.1`).prerelease).toBe(true);
  });
});
