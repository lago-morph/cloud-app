/**
 * Versions shared by `version-check` and `upgrade` (plan-setup-wizard §4.8, §4.8a): the app's
 * installed framework, the skill copies' version markers, and the cloud environment's setup
 * script, pinned to a version (owner, 2026-10-26: it never upgrades by itself; DEC-0593).
 * Node only.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const FRAMEWORK_PACKAGE = "@lago-morph/prototype-framework";
export const SKILL_PACKAGE = "@lago-morph/prototype-framework-skill";
/** The app's committed skill copy, relative to the app directory; also the setup script's copy, relative to the home directory. */
export const SKILL_DIR = join(".claude", "skills", "prototype-framework");
/** The skill copy's version marker (DEC-0592), written by every copy the release makes. */
export const SKILL_VERSION_FILE = "VERSION";

/** A skill copy: absent, present without a version marker (older than the marker), or at a version. */
export type SkillCopy = { readonly present: false } | { readonly present: true; readonly version?: string };

/** The skill copy in `dir`: its `VERSION` marker, or a plugin install's `.claude-plugin/plugin.json`. */
export function readSkillCopy(dir: string): SkillCopy {
  if (!existsSync(join(dir, "SKILL.md"))) return { present: false };
  const marker = join(dir, SKILL_VERSION_FILE);
  if (existsSync(marker)) {
    const version = readFileSync(marker, "utf8").trim();
    return parseVersion(version) === undefined ? { present: true } : { present: true, version };
  }
  const manifest = join(dir, ".claude-plugin", "plugin.json");
  if (existsSync(manifest)) {
    try {
      const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
      if (typeof version === "string" && parseVersion(version) !== undefined) return { present: true, version };
    } catch {
      // An unreadable manifest is a copy without a version.
    }
  }
  return { present: true };
}

/** The directory of the installed framework package, as Node resolves it from `appDir`. */
export function installedFrameworkDir(appDir: string): string | undefined {
  for (let at = resolve(appDir); ; at = dirname(at)) {
    const dir = join(at, "node_modules", ...FRAMEWORK_PACKAGE.split("/"));
    if (existsSync(join(dir, "package.json"))) return dir;
    if (dirname(at) === at) return undefined;
  }
}

/** The installed framework's version, or undefined when it is not installed. */
export function installedFrameworkVersion(appDir: string): string | undefined {
  const dir = installedFrameworkDir(appDir);
  if (dir === undefined) return undefined;
  const { version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: unknown };
  return typeof version === "string" ? version : undefined;
}

type Parsed = { readonly core: readonly [number, number, number]; readonly pre: readonly string[] };

function parseVersion(v: string): Parsed | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (m === null) return undefined;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] === undefined ? [] : m[4].split(".") };
}

/** True when `v` is an exact semantic version (`1.2.3`, `1.2.3-rc.1`). */
export function isExactVersion(v: string): boolean {
  return parseVersion(v) !== undefined && !v.startsWith("v");
}

/** Semantic-version order: negative when a < b, 0 when equal, positive when a > b. Unparsable versions sort first. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === undefined || pb === undefined) return pa === undefined ? (pb === undefined ? 0 : -1) : 1;
  for (let i = 0; i < 3; i++) {
    const d = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre.length === 0 || pb.pre.length === 0) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The cloud environment's setup script (plan §4.8), pinned to `version`: `npm pack` only downloads
 * the skill package's archive, so nothing is installed and no package scripts run.
 */
export function setupScript(version: string): string {
  return [
    "set -euo pipefail",
    'd=$(mktemp -d); cd "$d"',
    `npm pack -q ${SKILL_PACKAGE}@${version}`,
    "tar xzf ./*.tgz",
    "mkdir -p ~/.claude/skills",
    "rm -rf ~/.claude/skills/prototype-framework",
    "cp -r package/skill ~/.claude/skills/prototype-framework",
  ].join("\n");
}

/** The setup-script lines to print: where to paste it, then the script, indented. */
export function setupScriptLines(version: string): string {
  return (
    `Cloud environment setup script for ${version} (environment menu, Edit, Setup script; it never upgrades by itself):\n` +
    setupScript(version)
      .split("\n")
      .map((l) => `    ${l}\n`)
      .join("")
  );
}
