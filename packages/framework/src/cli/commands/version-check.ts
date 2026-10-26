/**
 * `version-check` (plan-setup-wizard §4.8a; DEC-0594): the skill's first step. It never changes
 * anything in the app or the environment; it only prints suggestions, one per finding:
 *
 * | Finding | Suggestion |
 * | the skill is newer than the app's installed framework | `npm run upgrade` |
 * | the app's framework is newer than the setup-script skill (`~/.claude/skills/prototype-framework`) | use the app's committed copy this session; the setup script at the new version |
 * | npm has a newer release than both | mentioned once per session (PAR-370), with its CHANGELOG headline |
 *
 * A failed npm lookup (no network, a blocked host, PAR-371's time limit) skips the last row quietly.
 * Exit status 0 whatever it finds; 2 on a usage mistake.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseOptions } from "../args.js";
import { EXIT, type Command } from "../io.js";
import { compareVersions, FRAMEWORK_PACKAGE, installedFrameworkVersion, isExactVersion, readSkillCopy, setupScriptLines, SKILL_DIR, type SkillCopy } from "./versions.js";

/** PAR-370: how long a newer npm release, once mentioned, is not mentioned again (one session). */
export const MENTION_ONCE_MS = 12 * 60 * 60 * 1000;
/** PAR-371: time limit of each network lookup (the npm registry, the CHANGELOG). */
export const LOOKUP_TIMEOUT_MS = 5_000;

export interface VersionCheckDeps {
  /** The home directory, whose `.claude/skills/prototype-framework` is the setup script's copy. */
  home(): string;
  /** The framework's latest version on npm; undefined (or a rejection) when it cannot be read. */
  latestRelease(): Promise<string | undefined>;
  /** The headline of `version`'s CHANGELOG section; undefined when it cannot be read. */
  headline(version: string): Promise<string | undefined>;
  /** True when `key` was mentioned within PAR-370; `remember` records a mention. Outside the app. */
  mentioned(key: string): boolean;
  remember(key: string): void;
}

export interface VersionFindings {
  readonly app?: string;
  /** The app's dependency spec, when the framework is not installed. */
  readonly pinned?: string;
  readonly committed: SkillCopy;
  readonly setupScript: SkillCopy;
}

const label = (copy: SkillCopy): string => (copy.present ? (copy.version ?? "a version without a marker (older)") : "none");

/** The app's framework and skill versions, read from files only. */
export function readFindings(appDir: string, home: string): VersionFindings {
  const app = installedFrameworkVersion(appDir);
  let pinned: string | undefined;
  if (app === undefined) {
    try {
      const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      pinned = pkg.dependencies?.[FRAMEWORK_PACKAGE];
    } catch {
      pinned = undefined;
    }
  }
  return {
    ...(app === undefined ? {} : { app }),
    ...(pinned === undefined ? {} : { pinned }),
    committed: readSkillCopy(join(appDir, SKILL_DIR)),
    setupScript: readSkillCopy(join(home, SKILL_DIR)),
  };
}

/** The suggestions for `findings` and npm's latest release (undefined: skipped). */
export async function suggestions(findings: VersionFindings, latest: string | undefined, deps: Pick<VersionCheckDeps, "headline" | "mentioned" | "remember">, appDir: string): Promise<string[]> {
  const out: string[] = [];
  const app = findings.app ?? (findings.pinned !== undefined && isExactVersion(findings.pinned) ? findings.pinned : undefined);
  if (findings.app === undefined) out.push("The framework is not installed in this app: run `npm install` first.");
  const skills = [
    ["The committed skill (.claude/skills/prototype-framework)", findings.committed],
    ["The setup-script skill (~/.claude/skills/prototype-framework)", findings.setupScript],
  ] as const;
  if (app !== undefined) {
    for (const [where, copy] of skills) {
      if (copy.present && copy.version !== undefined && compareVersions(copy.version, app) > 0) {
        out.push(`${where} is ${copy.version}, newer than this app's framework ${app}: run \`npm run upgrade\` to move the app to it.`);
      }
    }
    const script = findings.setupScript;
    if (script.present && (script.version === undefined || compareVersions(app, script.version) > 0)) {
      out.push(
        `This app's framework ${app} is newer than the setup-script skill (${label(script)}): use the app's committed copy (.claude/skills/prototype-framework) for this session. ` +
          `To update the setup-script skill, paste this into the cloud environment's settings:\n${setupScriptLines(app)}`,
      );
    }
  }
  if (latest !== undefined && isExactVersion(latest)) {
    const known = [app, ...skills.map(([, c]) => (c.present ? c.version : undefined))].filter((v): v is string => v !== undefined);
    const newer = known.length > 0 && known.every((v) => compareVersions(latest, v) > 0);
    const key = `${createHash("sha256").update(appDir).digest("hex").slice(0, 16)}-${latest}`;
    if (newer && !deps.mentioned(key)) {
      const headline = await deps.headline(latest).catch(() => undefined);
      out.push(`A newer release, ${latest}, is on npm${headline === undefined ? "" : `: ${headline.replace(/\.$/, "")}`}. To move this app to it: \`npm run upgrade\`.`);
      deps.remember(key);
    }
  }
  return out;
}

export function versionCheckCommand(deps: VersionCheckDeps): Command {
  return async (args, io) => {
    parseOptions(args, []);
    const findings = readFindings(io.cwd, deps.home());
    const latest = await deps.latestRelease().catch(() => undefined);
    const found = await suggestions(findings, latest, deps, io.cwd);
    io.stdout(`version-check: framework ${findings.app ?? "not installed"}; committed skill ${label(findings.committed)}; setup-script skill ${label(findings.setupScript)}\n`);
    io.stdout(found.length === 0 ? "Nothing to do: the versions agree.\n" : found.map((s) => `- ${s}${s.endsWith("\n") ? "" : "\n"}`).join(""));
    return EXIT.ok;
  };
}

/** The first line of `version`'s section in a Keep-a-Changelog text, cut to 200 characters. */
export function changelogHeadline(changelog: string, version: string): string | undefined {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return undefined;
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith("## ")) return undefined;
    const t = l.trim();
    if (t === "" || t.startsWith("#")) continue;
    return t.length > 200 ? `${t.slice(0, 199)}…` : t;
  }
  return undefined;
}

/** The real lookups: the npm registry and the release tag's CHANGELOG, through the environment's proxy. */
export async function versionCheckBinding(env: Readonly<Record<string, string | undefined>> = process.env): Promise<Command> {
  const { fetchOver, oneConnectionDispatcher } = await import("../one-connection.js");
  const get = fetchOver(oneConnectionDispatcher(env));
  const text = async (url: string): Promise<string | undefined> => {
    const r = await get(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    return r.ok ? await r.text() : undefined;
  };
  const registry = (env.npm_config_registry ?? "https://registry.npmjs.org/").replace(/\/?$/, "/");
  const marks = join(tmpdir(), "prototype-framework-version-check");
  return versionCheckCommand({
    home: homedir,
    latestRelease: async () => {
      const body = await text(`${registry}${FRAMEWORK_PACKAGE.replace("/", "%2F")}/latest`);
      const version = body === undefined ? undefined : (JSON.parse(body) as { version?: unknown }).version;
      return typeof version === "string" ? version : undefined;
    },
    headline: async (version) => {
      const body = await text(`https://raw.githubusercontent.com/lago-morph/cloud-app/v${version}/CHANGELOG.md`);
      return body === undefined ? undefined : changelogHeadline(body, version);
    },
    mentioned: (key) => {
      const file = join(marks, key);
      return existsSync(file) && Date.now() - statSync(file).mtimeMs < MENTION_ONCE_MS;
    },
    remember: (key) => {
      try {
        mkdirSync(marks, { recursive: true });
        writeFileSync(join(marks, key), "");
      } catch {
        // Without a mark the release is mentioned again next time; nothing else depends on it.
      }
    },
  });
}
