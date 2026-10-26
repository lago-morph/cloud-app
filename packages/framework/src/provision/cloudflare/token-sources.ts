/**
 * Where the Cloudflare tokens and account settings come from (plan-setup-wizard §4.2; DEC-0570,
 * DEC-0571, DEC-0573). Two sources, in this order:
 * 1. the process environment;
 * 2. the file `.env.cloudflare` in the project root (PAR-340), which the framework CLI reads,
 *    creates and edits itself.
 * A setting set (non-empty) in the environment wins. When both hold a value and the values
 * differ, a notice says the environment is used, naming the setting only. Empty values (and, in
 * the environment, values of only whitespace) count as absent in either source.
 *
 * The file is simple `KEY=VALUE` lines: `#` comments, blank lines, an optional `export ` prefix,
 * optional single or double quotes around the value, and an unquoted value's ` #` comment. An
 * unquoted value's trailing `(…)` hint, as on the template's account line, is dropped, so a line
 * with only the hint reads as empty; an unquoted value with a space left inside is unreadable. Only
 * the four names of `SETTING_NAMES` are read; other names are ignored. Nothing here ever prints,
 * logs or returns in a message a value of the file or the environment (DEC-0573): notices name
 * settings and line numbers only.
 *
 * Every write leaves the file readable and writable by its owner only (mode 600, PAR-341), and
 * replaces it atomically: a temporary file at that mode in the same directory, renamed over it. A
 * `.env.cloudflare` that is a symbolic link is written through to its target (DEC-0587).
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Environment } from "./environment.js";

/** The file's name, in the project root (PAR-340). */
export const ENV_CLOUDFLARE_FILE = ".env.cloudflare";

/** The settings the file may hold, in the template's order. */
export const SETTING_NAMES = ["CLOUDFLARE_BOOTSTRAP_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_EMAIL_DOMAIN", "CLOUDFLARE_ACCOUNT_ID"] as const;
export type SettingName = (typeof SETTING_NAMES)[number];

/** The file's mode after every write: owner read and write only (PAR-341). */
export const ENV_CLOUDFLARE_MODE = 0o600;

/** What replaces the bootstrap token's line once the token has deleted itself (plan §4.2, PAR-342). */
export const BOOTSTRAP_DELETED_LINE = "# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process";

/** The template setup prints and writes (plan §3.2), exactly its four lines. */
export const ENV_CLOUDFLARE_TEMPLATE = [
  "CLOUDFLARE_BOOTSTRAP_TOKEN=",
  "CLOUDFLARE_API_TOKEN=",
  "CLOUDFLARE_EMAIL_DOMAIN=",
  "# CLOUDFLARE_ACCOUNT_ID=        (only if your tokens see more than one account)",
].join("\n") + "\n";

export interface CloudflareSettings {
  /** The value of each setting that is set; empty strings are treated as absent. */
  readonly values: Readonly<Partial<Record<SettingName, string>>>;
  /** Where each value in `values` came from. */
  readonly sources: Readonly<Partial<Record<SettingName, "environment" | "file">>>;
  /** What the user should know about the sources; names and line numbers only, never values. */
  readonly notices: readonly string[];
  /** Whether `.env.cloudflare` exists in the project root. */
  readonly fileExists: boolean;
}

const isSettingName = (name: string): name is SettingName => (SETTING_NAMES as readonly string[]).includes(name);

/** One parsed assignment line of the file. */
interface Assignment {
  readonly index: number;
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
  // The template's hint, "(only if …)", is never part of a value (a hint-only line is empty).
  const value = (comment < 0 ? text : text.slice(0, comment)).trim().replace(/\s*\([^()]*\)$/, "");
  return /\s/.test(value) ? undefined : value;
}

interface ParsedFile {
  readonly lines: string[];
  readonly assignments: readonly Assignment[];
  /** 1-based numbers of lines that are neither blank, a comment nor an assignment. */
  readonly unreadable: readonly number[];
}

function parseFile(text: string): ParsedFile {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const assignments: Assignment[] = [];
  const unreadable: number[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const match = ASSIGNMENT.exec(line);
    const value = match === null ? undefined : parseValue(match[2] ?? "");
    if (match === null || value === undefined) {
      unreadable.push(index + 1);
      return;
    }
    assignments.push({ index, name: match[1] ?? "", value });
  });
  return { lines, assignments, unreadable };
}

const filePath = (projectDir: string): string => join(projectDir, ENV_CLOUDFLARE_FILE);

function readParsed(projectDir: string): ParsedFile | undefined {
  const path = filePath(projectDir);
  if (!existsSync(path)) return undefined;
  return parseFile(readFileSync(path, "utf8"));
}

/** The file's value of each setting; a later line wins over an earlier one, as in a shell. */
function fileValues(parsed: ParsedFile): Partial<Record<SettingName, string>> {
  const values: Partial<Record<SettingName, string>> = {};
  for (const a of parsed.assignments) if (isSettingName(a.name)) values[a.name] = a.value;
  return values;
}

/**
 * The merged settings of the environment and `.env.cloudflare` (environment first). Never throws
 * for a missing file; a file that cannot be read is reported as a notice and treated as empty.
 */
export function readCloudflareSettings(projectDir: string, env: Environment): CloudflareSettings {
  const notices: string[] = [];
  let parsed: ParsedFile | undefined;
  let fileExists = false;
  try {
    fileExists = existsSync(filePath(projectDir));
    parsed = readParsed(projectDir);
  } catch (error) {
    notices.push(`${ENV_CLOUDFLARE_FILE} could not be read (${error instanceof Error && "code" in error ? String(error.code) : "unreadable"}): using the environment only`);
  }
  for (const line of parsed?.unreadable ?? []) {
    notices.push(`line ${String(line)} of ${ENV_CLOUDFLARE_FILE} is not a NAME=value line and was ignored`);
  }
  const file = parsed === undefined ? {} : fileValues(parsed);
  const values: Partial<Record<SettingName, string>> = {};
  const sources: Partial<Record<SettingName, "environment" | "file">> = {};
  for (const name of SETTING_NAMES) {
    const fromEnv = (env[name] ?? "").trim() === "" ? "" : (env[name] ?? "");
    const fromFile = file[name] ?? "";
    if (fromEnv !== "") {
      values[name] = fromEnv;
      sources[name] = "environment";
      if (fromFile !== "" && fromFile !== fromEnv) {
        notices.push(`${name} is set in both the environment and ${ENV_CLOUDFLARE_FILE} and they differ: using the environment`);
      }
    } else if (fromFile !== "") {
      values[name] = fromFile;
      sources[name] = "file";
    }
  }
  return { values, sources, notices, fileExists };
}

/**
 * The settings merged into an environment (environment values win). A setting the environment holds
 * only whitespace is left out, as absent, also when the file has no value for it.
 */
export function mergeCloudflareSettings(env: Environment, settings: CloudflareSettings): Environment {
  const kept = Object.fromEntries(Object.entries(env).filter(([name, value]) => !(isSettingName(name) && (value ?? "").trim() === "")));
  return { ...kept, ...settings.values };
}

/** The process environment with `.env.cloudflare`'s values added (the environment wins). Every Cloudflare command uses this. */
export function cloudflareEnvironment(projectDir: string, env: Environment): Environment {
  return mergeCloudflareSettings(env, readCloudflareSettings(projectDir, env));
}

/**
 * Replaces the file atomically at mode 600: the content goes to a new temporary file at that mode
 * in the same directory, which is renamed over the file, so a reader sees the old or the new file
 * whole, and a file that had a wider mode never holds the new content.
 */
function writeFile(projectDir: string, lines: readonly string[]): void {
  // A symbolic link (a file shared between projects) is written through to its target, which keeps
  // being the file; the temporary file is made next to the target, so the rename stays atomic.
  const link = filePath(projectDir);
  const path = existsSync(link) && lstatSync(link).isSymbolicLink() ? realpathSync(link) : link;
  const temporary = join(dirname(path), `${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, lines.length === 0 ? "" : `${lines.join("\n")}\n`, { encoding: "utf8", mode: ENV_CLOUDFLARE_MODE, flag: "wx" });
    chmodSync(temporary, ENV_CLOUDFLARE_MODE);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Writes the template when the file does not exist; true when it wrote it. */
export function writeTemplateIfAbsent(projectDir: string): boolean {
  if (existsSync(filePath(projectDir))) return false;
  writeFile(projectDir, ENV_CLOUDFLARE_TEMPLATE.trimEnd().split("\n"));
  return true;
}

const BOOTSTRAP_LINE = /^\s*(?:export\s+)?CLOUDFLARE_BOOTSTRAP_TOKEN\s*=/;

/**
 * Replaces every active `CLOUDFLARE_BOOTSTRAP_TOKEN=` line with `BOOTSTRAP_DELETED_LINE` (the
 * token has deleted itself), also a line the parser cannot read (an unclosed quote), so no value
 * stays in the file. True when a line changed; a missing file or no such line is false.
 */
export function commentOutBootstrap(projectDir: string): boolean {
  const parsed = readParsed(projectDir);
  if (parsed === undefined) return false;
  let changed = false;
  const lines = parsed.lines.map((line) => {
    if (!BOOTSTRAP_LINE.test(line)) return line;
    changed = true;
    return BOOTSTRAP_DELETED_LINE;
  });
  if (changed) writeFile(projectDir, lines);
  return changed;
}

type FillName = "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_EMAIL_DOMAIN";

/** A commented-out assignment with no value, as the template's `# CLOUDFLARE_ACCOUNT_ID=  (…)` line. */
const commentedEmpty = (name: string): RegExp => new RegExp(`^\\s*#\\s*${name}\\s*=\\s*(\\(.*\\))?\\s*$`);

/**
 * Fills in `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_DOMAIN` where the file has them empty or
 * absent, so copying the file starts the next project (plan §4.2). A value already in the file is
 * never changed. An empty line is filled in place; else the template's commented line is
 * uncommented and filled; else a line is added. An absent file is never created (settings that
 * live in the environment only stay there; plan §3.4, SETUP-AC-002). Returns the names
 * filled in. `replace` names settings whose value in the file is changed when it differs: only the
 * account switch replaces `CLOUDFLARE_ACCOUNT_ID` (plan §3.4; DEC-0585).
 */
export function fillInSettings(projectDir: string, values: Partial<Record<FillName, string>>, options: { readonly replace?: readonly FillName[] } = {}): string[] {
  const parsed = readParsed(projectDir);
  if (parsed === undefined) return [];
  const current = fileValues(parsed);
  const lines = [...parsed.lines];
  const filled: string[] = [];
  for (const name of ["CLOUDFLARE_EMAIL_DOMAIN", "CLOUDFLARE_ACCOUNT_ID"] as const) {
    const value = values[name]?.trim() ?? "";
    const have = current[name] ?? "";
    if (value === "" || have === value || (have !== "" && !(options.replace ?? []).includes(name))) continue;
    if (/[\s#"'\\]/.test(value)) throw new Error(`${name} cannot be written to ${ENV_CLOUDFLARE_FILE}: the value holds a space, quote, backslash or #`);
    const line = `${name}=${value}`;
    const active = parsed.assignments.filter((a) => a.name === name);
    const last = active[active.length - 1];
    const commented = lines.findIndex((l) => commentedEmpty(name).test(l));
    if (last !== undefined) lines[last.index] = line;
    else if (commented >= 0) lines[commented] = line;
    else lines.push(line);
    filled.push(name);
  }
  if (filled.length > 0) writeFile(projectDir, lines);
  return filled;
}
