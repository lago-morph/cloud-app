/**
 * Where the one Cloudflare credential comes from (DEC-0795, owner, 2026-11-27). Two sources, in
 * this order, for each of `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the names wrangler
 * reads):
 * 1. the process environment (a Claude Code cloud session's environment variables, a shell's
 *    exports);
 * 2. the secrets file, in `.env` format with the same names: `~/.secrets/cloudflare` in the home
 *    directory (PAR-486), or the path `CLOUDFLARE_SECRETS_FILE` names (PAR-487). It is never
 *    relative to the project, so every project, worktree and session of the machine shares it: a
 *    relative override is read from the home directory, and `~/` is the home directory.
 * A setting set (non-empty) in the environment wins. When both hold a value and the values differ,
 * a notice says the environment is used, naming the setting only. Empty values (and, in the
 * environment, values of only whitespace) count as absent in either source.
 *
 * The framework only reads the file: it never creates, writes or changes it (DEC-0799), and it never
 * writes the credential anywhere. A file readable by its group or by others is warned about, never
 * refused (DEC-0800). The project's old `.env.cloudflare` (PAR-340, retired) and the old
 * `CLOUDFLARE_BOOTSTRAP_TOKEN` are not read; a notice says so when either is there (DEC-0799).
 *
 * The file is simple `KEY=VALUE` lines: `#` comments, blank lines, an optional `export ` prefix,
 * optional single or double quotes around the value, and an unquoted value's ` #` comment; an
 * unquoted value with a space left inside is unreadable. Only `SETTING_NAMES` are read; other names
 * are ignored. Nothing here ever prints, logs or returns in a message a value of the file or the
 * environment (DEC-0573): notices name settings, paths and line numbers only.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { Environment } from "./environment.js";

/** The project's old settings file (PAR-340, retired by DEC-0799): never read; only its presence is noted. */
export const ENV_CLOUDFLARE_FILE = ".env.cloudflare";

/** PAR-487: the environment variable that overrides the secrets file's path. */
export const SECRETS_FILE_ENV = "CLOUDFLARE_SECRETS_FILE";

/** PAR-486: the secrets file's default path, under the home directory. */
export const DEFAULT_SECRETS_FILE = "~/.secrets/cloudflare";

/** The settings the credential consists of, in the template's order. */
export const SETTING_NAMES = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;
export type SettingName = (typeof SETTING_NAMES)[number];

/** The old second token's setting (DEC-0796): no longer read. */
export const RETIRED_BOOTSTRAP_SETTING = "CLOUDFLARE_BOOTSTRAP_TOKEN";

/**
 * The template setup prints when no credential is found (owner decision 2, DEC-0795): exactly two
 * lines with nothing after the `=`, usable both as the secrets file's contents and as a session's
 * environment variables.
 */
export const CREDENTIAL_TEMPLATE = SETTING_NAMES.map((n) => `${n}=`).join("\n") + "\n";

export type SettingSource = "environment" | "file";

export interface CloudflareSettings {
  /** The value of each setting that is set; empty strings are treated as absent. */
  readonly values: Readonly<Partial<Record<SettingName, string>>>;
  /** Where each value in `values` came from. */
  readonly sources: Readonly<Partial<Record<SettingName, SettingSource>>>;
  /** What the user should know about the sources; names, paths and line numbers only, never values. */
  readonly notices: readonly string[];
  /** The secrets file's resolved, absolute path (whether or not it exists). */
  readonly filePath: string;
  /** Whether the secrets file exists. */
  readonly fileExists: boolean;
}

export interface SettingsOptions {
  /** The home directory (default `os.homedir()`). */
  readonly home?: string;
  /** The project directory: when given, an old `.env.cloudflare` there gets a notice. */
  readonly projectDir?: string;
}

const isSettingName = (name: string): name is SettingName => (SETTING_NAMES as readonly string[]).includes(name);

/**
 * The secrets file's absolute path (PAR-486, PAR-487): `CLOUDFLARE_SECRETS_FILE` when set, else
 * `~/.secrets/cloudflare`. `~` and `~/…` are the home directory (`home`, else `HOME` in `env`, else
 * `os.homedir()`); any other relative path is read from the home directory, never from the project
 * or the current directory.
 */
export function secretsFilePath(env: Environment, home?: string): string {
  home ??= (env.HOME ?? "").trim() === "" ? homedir() : (env.HOME ?? "").trim();
  const set = (env[SECRETS_FILE_ENV] ?? "").trim();
  const path = set === "" ? DEFAULT_SECRETS_FILE : set;
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(home, path);
}

/** One parsed assignment line of the file. */
interface Assignment {
  readonly name: string;
  readonly value: string;
}

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** The value part of an assignment: quotes removed, an unquoted value's ` #` comment dropped, trimmed. */
function parseValue(raw: string): string | undefined {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    if (end < 0) return undefined;
    const rest = text.slice(end + 1).trim();
    if (rest !== "" && !rest.startsWith("#")) return undefined;
    return text.slice(1, end);
  }
  const comment = text.search(/\s#/);
  const value = (comment < 0 ? text : text.slice(0, comment)).trim();
  return /\s/.test(value) ? undefined : value;
}

/** The file's assignments, and the 1-based numbers of lines that are neither blank, a comment nor an assignment. */
function parseFile(text: string): { assignments: Assignment[]; unreadable: number[] } {
  const assignments: Assignment[] = [];
  const unreadable: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const match = ASSIGNMENT.exec(line);
    const value = match === null ? undefined : parseValue(match[2] ?? "");
    if (match === null || value === undefined) {
      unreadable.push(index + 1);
      return;
    }
    assignments.push({ name: match[1] ?? "", value });
  });
  return { assignments, unreadable };
}

/**
 * The credential from the environment and the secrets file (environment first). Never throws: a
 * missing file is no file, and a file that cannot be read is reported as a notice and treated as
 * empty.
 */
export function readCloudflareSettings(env: Environment, options: SettingsOptions = {}): CloudflareSettings {
  const notices: string[] = [];
  const path = secretsFilePath(env, options.home);
  let fileExists = false;
  const file: Partial<Record<SettingName, string>> = {};
  let bootstrapInFile = false;
  try {
    fileExists = existsSync(path);
    if (fileExists) {
      // DEC-0800: a file others can read is warned about, never refused (no effect on Windows).
      const mode = statSync(path).mode;
      if (process.platform !== "win32" && (mode & 0o077) !== 0) {
        notices.push(`the secrets file ${path} can be read by other users (mode ${(mode & 0o777).toString(8)}); make it private with: chmod 600 ${path}`);
      }
      const parsed = parseFile(readFileSync(path, "utf8"));
      for (const line of parsed.unreadable) notices.push(`line ${String(line)} of ${path} is not a NAME=value line and was ignored`);
      // A later line wins over an earlier one, as in a shell.
      for (const a of parsed.assignments) {
        if (isSettingName(a.name)) file[a.name] = a.value;
        else if (a.name === RETIRED_BOOTSTRAP_SETTING && a.value !== "") bootstrapInFile = true;
      }
    }
  } catch (error) {
    notices.push(`the secrets file ${path} could not be read (${error instanceof Error && "code" in error ? String(error.code) : "unreadable"}): using the environment only`);
  }
  const values: Partial<Record<SettingName, string>> = {};
  const sources: Partial<Record<SettingName, SettingSource>> = {};
  for (const name of SETTING_NAMES) {
    const fromEnv = (env[name] ?? "").trim() === "" ? "" : (env[name] ?? "");
    const fromFile = file[name] ?? "";
    if (fromEnv !== "") {
      values[name] = fromEnv;
      sources[name] = "environment";
      if (fromFile !== "" && fromFile !== fromEnv) notices.push(`${name} is set in both the environment and ${path} and they differ: using the environment`);
    } else if (fromFile !== "") {
      values[name] = fromFile;
      sources[name] = "file";
    }
  }
  if ((env[RETIRED_BOOTSTRAP_SETTING] ?? "").trim() !== "" || bootstrapInFile) {
    notices.push(`${RETIRED_BOOTSTRAP_SETTING} is no longer used and was ignored: the framework needs only ${SETTING_NAMES.join(" and ")}. You can remove it.`);
  }
  if (options.projectDir !== undefined) {
    try {
      if (existsSync(join(options.projectDir, ENV_CLOUDFLARE_FILE))) {
        notices.push(`${ENV_CLOUDFLARE_FILE} in the project folder is no longer read: put ${SETTING_NAMES.join(" and ")} in ${path} (or in the environment), then delete ${ENV_CLOUDFLARE_FILE}`);
      }
    } catch {
      // the old file's notice never fails a command
    }
  }
  return { values, sources, notices, filePath: path, fileExists };
}

/** Where a setting's value came from, for the user: the variable, or the file's path. Never the value. */
export function describeSource(settings: CloudflareSettings, name: SettingName): string {
  const source = settings.sources[name];
  if (source === "environment") return `the environment variable ${name}`;
  if (source === "file") return `the file ${settings.filePath}`;
  return "nowhere (not set)";
}

/**
 * The settings merged into an environment (environment values win). A setting the environment holds
 * only whitespace is left out, as absent, also when the file has no value for it. The retired
 * bootstrap setting is left out (DEC-0796), so it never reaches the tools' processes.
 */
export function mergeCloudflareSettings(env: Environment, settings: CloudflareSettings): Environment {
  const kept = Object.fromEntries(Object.entries(env).filter(([name, value]) => name !== RETIRED_BOOTSTRAP_SETTING && !(isSettingName(name) && (value ?? "").trim() === "")));
  return { ...kept, ...settings.values };
}

/** The process environment with the secrets file's values added (the environment wins). Every Cloudflare command uses this. */
export function cloudflareEnvironment(env: Environment, options: SettingsOptions = {}): Environment {
  return mergeCloudflareSettings(env, readCloudflareSettings(env, options));
}
