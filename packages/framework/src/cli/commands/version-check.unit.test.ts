import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureIo } from "../io.test-support.js";
import { changelogHeadline, versionCheckBinding, versionCheckCommand, type VersionCheckDeps } from "./version-check.js";
import { compareVersions, readSkillCopy, setupScript } from "./versions.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "version-check-"));
  dirs.push(d);
  return d;
}

function skill(dir: string, version?: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "# skill\n");
  if (version !== undefined) writeFileSync(join(dir, "VERSION"), `${version}\n`);
}

/** An app with the framework installed at `framework` (undefined: not installed) and a committed skill copy. */
function app(framework: string | undefined, committed?: string): string {
  const dir = temp();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { "@lago-morph/prototype-framework": framework ?? "0.1.0" } }));
  if (framework !== undefined) {
    const fw = join(dir, "node_modules", "@lago-morph", "prototype-framework");
    mkdirSync(fw, { recursive: true });
    writeFileSync(join(fw, "package.json"), JSON.stringify({ version: framework }));
  }
  if (committed !== undefined) skill(join(dir, ".claude", "skills", "prototype-framework"), committed);
  return dir;
}

function deps(home: string, latest: string | undefined | Error, over: Partial<VersionCheckDeps> = {}): VersionCheckDeps & { headlines: string[] } {
  const headlines: string[] = [];
  return {
    headlines,
    home: () => home,
    latestRelease: () => (latest instanceof Error ? Promise.reject(latest) : Promise.resolve(latest)),
    headline: (v) => (headlines.push(v), Promise.resolve("Faster deploys.")),
    ...over,
  };
}

async function check(dir: string, d: VersionCheckDeps): Promise<{ code: number; out: string; err: string }> {
  const io = captureIo(dir);
  const code = await versionCheckCommand(d)([], io);
  return { code, out: io.out, err: io.err };
}

/** Every file under `dir` with its modification time: version-check must change none. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else out.push(`${p}:${s.mtimeMs}:${s.size}`);
    }
  };
  walk(dir);
  return out.sort();
}

describe("version-check (plan-setup-wizard §4.8a)", () => {
  it("says nothing to do when the app, its committed skill and npm agree", async () => {
    const r = await check(app("0.2.0", "0.2.0"), deps(temp(), "0.2.0"));
    expect(r.code).toBe(0);
    expect(r.out).toContain("version-check: framework 0.2.0; committed skill 0.2.0; setup-script skill none");
    expect(r.out).toContain("Nothing to do");
  });

  it("row 1: a skill newer than the app's framework suggests npm run upgrade", async () => {
    const home = temp();
    skill(join(home, ".claude", "skills", "prototype-framework"), "0.3.0");
    const r = await check(app("0.2.0", "0.2.0"), deps(home, "0.3.0"));
    expect(r.out).toMatch(/The setup-script skill \(~\/\.claude\/skills\/prototype-framework\) is 0\.3\.0, newer than this app's framework 0\.2\.0: run `npm run upgrade`/);
    // npm's release is not newer than both, so it is not mentioned.
    expect(r.out).not.toContain("on npm");
  });

  it("row 2: an app framework newer than the setup-script skill: use the committed copy, and the setup script at the new version", async () => {
    const home = temp();
    skill(join(home, ".claude", "skills", "prototype-framework"), "0.1.0");
    const r = await check(app("0.2.0", "0.2.0"), deps(home, undefined));
    expect(r.out).toContain("This app's framework 0.2.0 is newer than the setup-script skill (0.1.0): use the app's committed copy (.claude/skills/prototype-framework) for this session.");
    expect(r.out).toContain(`    ${setupScript("0.2.0").split("\n").join("\n    ")}\n`);
    expect(r.out).toContain("npm pack -q @lago-morph/prototype-framework-skill@0.2.0");
    expect(r.out).not.toContain("npm run upgrade");
  });

  it("row 2 also covers a setup-script skill without a version marker (older than the marker)", async () => {
    const home = temp();
    skill(join(home, ".claude", "skills", "prototype-framework"));
    const r = await check(app("0.2.0", "0.2.0"), deps(home, undefined));
    expect(r.out).toContain("newer than the setup-script skill (a version without a marker (older))");
  });

  it("row 3: npm newer than both is printed, with the CHANGELOG headline, on every run (stateless; the skill mentions it once per session)", async () => {
    const d = deps(temp(), "0.4.0");
    const dir = app("0.2.0", "0.2.0");
    for (const run of [1, 2]) {
      const r = await check(dir, d);
      expect(r.out, `run ${run}`).toContain("A newer release, 0.4.0, is on npm: Faster deploys. To move this app to it: `npm run upgrade`.");
    }
    expect(d.headlines).toEqual(["0.4.0", "0.4.0"]);
  });

  it("row 3 without a headline, when the CHANGELOG cannot be read", async () => {
    const r = await check(app("0.2.0"), deps(temp(), "0.4.0", { headline: () => Promise.reject(new Error("offline")) }));
    expect(r.out).toContain("A newer release, 0.4.0, is on npm. To move");
  });

  it("a failed npm lookup skips that row quietly", async () => {
    const r = await check(app("0.2.0", "0.2.0"), deps(temp(), new Error("getaddrinfo ENOTFOUND registry.npmjs.org")));
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).not.toMatch(/npm|ENOTFOUND/i);
    expect(r.out).toContain("Nothing to do");
  });

  it("an app without the framework installed is told to run npm install, using its pin for the comparisons", async () => {
    const home = temp();
    skill(join(home, ".claude", "skills", "prototype-framework"), "0.3.0");
    const r = await check(app(undefined, "0.1.0"), deps(home, undefined));
    expect(r.out).toContain("framework not installed");
    expect(r.out).toContain("run `npm install` first");
    expect(r.out).toContain("is 0.3.0, newer than this app's framework 0.1.0");
  });

  it("never changes anything in the app or the home directory", async () => {
    const home = temp();
    skill(join(home, ".claude", "skills", "prototype-framework"), "0.1.0");
    const dir = app("0.2.0", "0.3.0");
    const before = [...snapshot(dir), ...snapshot(home)];
    await check(dir, deps(home, "0.4.0"));
    expect([...snapshot(dir), ...snapshot(home)]).toEqual(before);
  });

  it("the real binding writes no file anywhere: not in the app, the home directory or the temp directory", async () => {
    const home = temp();
    const tmp = temp();
    skill(join(home, ".claude", "skills", "prototype-framework"), "0.1.0");
    const dir = app("0.2.0", "0.2.0");
    const urls: string[] = [];
    const fakeFetch = ((input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      const body = url.endsWith("/latest") ? JSON.stringify({ version: "0.4.0" }) : "## [0.4.0] - 2026-11-01\n\nFaster deploys.\n";
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;
    const saved = { HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    Object.assign(process.env, { HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp });
    try {
      const before = [...snapshot(dir), ...snapshot(home), ...snapshot(tmp)];
      for (const run of [1, 2]) {
        const io = captureIo(dir);
        const command = await versionCheckBinding({ npm_config_registry: "https://registry.example/" }, fakeFetch);
        expect(await command([], io)).toBe(0);
        expect(io.out, `run ${run}`).toContain("A newer release, 0.4.0, is on npm: Faster deploys.");
      }
      expect([...snapshot(dir), ...snapshot(home), ...snapshot(tmp)]).toEqual(before);
      expect(readdirSync(tmp)).toEqual([]);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(urls[0]).toBe("https://registry.example/@lago-morph%2Fprototype-framework/latest");
  });

  it("takes no options", async () => {
    await expect(versionCheckCommand(deps(temp(), undefined))(["--fix"], captureIo(temp()))).rejects.toThrow(/unknown option/);
  });
});

describe("versions", () => {
  it("orders semantic versions, pre-releases before their release", () => {
    expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("reads a skill copy's VERSION marker, or a plugin install's manifest", () => {
    const d = temp();
    expect(readSkillCopy(join(d, "none"))).toEqual({ present: false });
    skill(join(d, "a"), "0.1.0");
    expect(readSkillCopy(join(d, "a"))).toEqual({ present: true, version: "0.1.0" });
    skill(join(d, "b"));
    mkdirSync(join(d, "b", ".claude-plugin"));
    writeFileSync(join(d, "b", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "0.2.0" }));
    expect(readSkillCopy(join(d, "b"))).toEqual({ present: true, version: "0.2.0" });
    skill(join(d, "c"));
    expect(readSkillCopy(join(d, "c"))).toEqual({ present: true });
  });

  it("the setup script is plan §4.8's, pinned to the version", () => {
    expect(setupScript("0.2.0")).toBe(
      [
        "set -euo pipefail",
        'd=$(mktemp -d); cd "$d"',
        "npm pack -q @lago-morph/prototype-framework-skill@0.2.0",
        "tar xzf ./*.tgz",
        "mkdir -p ~/.claude/skills",
        "rm -rf ~/.claude/skills/prototype-framework",
        "cp -r package/skill ~/.claude/skills/prototype-framework",
      ].join("\n"),
    );
  });

  it("the CHANGELOG headline is the first line of the version's section", () => {
    const text = "# Changelog\n\n## [0.2.0] - 2026-11-01\n\nFaster deploys.\n\n### Added\n\n- x\n\n## [0.1.0] - 2026-10-26\n\nFirst.\n";
    expect(changelogHeadline(text, "0.2.0")).toBe("Faster deploys.");
    expect(changelogHeadline(text, "0.1.0")).toBe("First.");
    expect(changelogHeadline(text, "0.3.0")).toBeUndefined();
    expect(changelogHeadline("## [0.2.0] - x\n### Added\n", "0.2.0")).toBeUndefined();
  });
});
