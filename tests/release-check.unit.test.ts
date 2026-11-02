// Unit tests for the release gate scripts/release-check.mjs (used by .github/workflows/release.yml).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { changelogSection, check, versions } from "../scripts/release-check.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["packages/framework/package.json", "packages/create-prototype-app/package.json", "packages/prototype-framework-skill/package.json", "apps/template/package.json", "skill/.claude-plugin/plugin.json"];

/** `dir` with its CHANGELOG.md replaced by `changelog`. */
function fixtureWith(dir: string, changelog: string): string {
  writeFileSync(join(dir, "CHANGELOG.md"), changelog);
  return dir;
}

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

/** Sets every version-bearing file of a fixture to `version`, as docs/RELEASING.md step 1 does. */
function setVersions(dir: string, version: string): void {
  for (const f of FILES) {
    const json = JSON.parse(readFileSync(join(dir, f), "utf8")) as { version?: string; dependencies?: Record<string, string> };
    if (f === "apps/template/package.json") json.dependencies = { ...json.dependencies, "@lago-morph/prototype-framework": version };
    else json.version = version;
    writeFileSync(join(dir, f), JSON.stringify(json, null, 2));
  }
}

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
    expect(check(dated, "release-1").problems).toEqual(['tag "release-1" is not vX.Y.Z or vX.Y.Z-rcNN (NN = 01 to 99, two digits)']);
    const undated = fixture(`## [${fwVersion}] - unreleased\n`);
    expect(check(undated, `v${fwVersion}`).problems.join("\n")).toMatch(/must be dated/);
    expect(changelogSection("## [1.0.0] - 2026-01-01\n", "0.1.0").error).toMatch(/no "## \[0\.1\.0\]" section/);
  });

  it("accepts a release candidate vX.Y.Z-rcNN whose versions and CHANGELOG section say X.Y.Z-rcNN, and publishes it to the dist-tag next (DEC-0792)", () => {
    const dir = fixture("## [0.2.0-rc01] - 2026-11-02\n\n- first candidate\n\n## [0.1.1] - 2026-10-27\n\n- old\n");
    setVersions(dir, "0.2.0-rc01");
    const r = check(dir, "v0.2.0-rc01");
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ version: "0.2.0-rc01", prerelease: true, npmTag: "next", notes: "- first candidate" });
    for (const v of ["0.2.0-rc12", "0.2.0-rc99"]) {
      setVersions(dir, v);
      expect(check(fixtureWith(dir, `## [${v}] - 2026-11-03\n- x\n`), `v${v}`).problems, v).toEqual([]);
    }
  });

  it("checks a release candidate's tag against the package versions", () => {
    const dir = fixture("## [0.2.0-rc02] - 2026-11-02\n- x\n");
    setVersions(dir, "0.2.0-rc01");
    const problems = check(dir, "v0.2.0-rc02").problems.join("\n");
    expect(problems).toMatch(/packages\/framework\/package\.json version is "0\.2\.0-rc01", the tag says 0\.2\.0-rc02/);
    expect(problems).toMatch(/@lago-morph\/prototype-framework pin is "0\.2\.0-rc01"/);
  });

  it("publishes a final version to the dist-tag latest", () => {
    const dir = fixture(`## [${fwVersion}] - 2026-11-01\n- x\n`);
    expect(check(dir, `v${fwVersion}`)).toMatchObject({ prerelease: false, npmTag: "latest" });
  });

  it("refuses a release-candidate tag that is not -rc with exactly two digits 01 to 99, and any other pre-release part", () => {
    const dir = fixture("## [0.2.0-rc01] - 2026-11-02\n- x\n");
    setVersions(dir, "0.2.0-rc01");
    for (const tag of ["v0.2.0-rc.1", "v0.2.0-rc1", "v0.2.0-rc00", "v0.2.0-rc100", "v0.2.0-rc.01", "v0.2.0-rc", "v0.2.0-rc0", "v0.2.0-RC01", "v0.2.0-rc01.1", "v0.2.0-beta01", "v0.2.0-rcxx", "v0.02.0", "v0.2.0rc01"]) {
      expect(check(dir, tag).problems, tag).toEqual([`tag ${JSON.stringify(tag)} is not vX.Y.Z or vX.Y.Z-rcNN (NN = 01 to 99, two digits)`]);
    }
  });

  it("marks a version with a pre-release part as a prerelease", () => {
    const dir = fixture(`## [${fwVersion}-rc01] - 2026-11-01\n- x\n`);
    // The files say fwVersion, so the versions do not match; the classification still holds.
    expect(check(dir, `v${fwVersion}-rc01`).prerelease).toBe(true);
  });
});
