/**
 * The local secret store's text format: `.dev.vars`, which Wrangler (PAR-101) reads with its
 * bundled dotenv 16.3.1 `parse` and dotenv-expand 12.0.2 `expand` (SEC-REQ-003, local row).
 * Pure text functions; file I/O is in `local.ts`.
 */

import { secretLocation } from "../config/secret-locations.js";
import { DEV_GENERATED_SECRETS } from "./names.js";

/** PAR-253: minimum session signing key length, in bytes; also used for the local ticket key. */
export const DEV_SECRET_BYTES = 32;

/** dotenv 16.3.1's assignment pattern. */
const LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

interface Assignment {
  readonly name: string;
  readonly raw: string;
  readonly start: number;
  readonly end: number;
}

/** Assignments in `text` (line endings normalised to `\n`), as dotenv finds them. */
function assignments(text: string): Assignment[] {
  const found: Assignment[] = [];
  LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINE.exec(text)) !== null) {
    // The pattern's leading `\s*` may span blank lines; the assignment's line starts after them.
    const leading = match[0].slice(0, match[0].length - match[0].trimStart().length).lastIndexOf("\n") + 1;
    found.push({ name: match[1]!, raw: match[2] ?? "", start: match.index + leading, end: match.index + match[0].length });
    if (match[0].length === 0) LINE.lastIndex += 1;
  }
  return found;
}

/** dotenv's value unquoting. */
function unquote(raw: string): string {
  let value = raw.trim();
  const maybeQuote = value[0];
  value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
  if (maybeQuote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  return value;
}

/** dotenv-expand: `$NAME` and `${NAME}` not preceded by a backslash are replaced, then `\$` → `$`. */
function expand(value: string, earlier: Readonly<Record<string, string>>): string {
  const expanded = value.replace(/(?<!\\)\$\{([^{}]+)\}|(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, braced?: string, bare?: string) => earlier[(braced ?? bare)!] ?? "");
  return expanded.replace(/\\\$/g, "$");
}

/** The values Wrangler's Worker sees for `text`. */
export function readDevVars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, raw } of assignments(normalise(text))) out[name] = expand(unquote(raw), out);
  return out;
}

function normalise(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * The assignment line for `value`: `$` escaped for dotenv-expand, then the first quoting
 * (single, double, backtick) that reads back unchanged. Throws when none does, or when the value
 * has a line break (one value is one line).
 */
function assignmentLine(location: string, value: string): string {
  const refuse = (why: string) => new Error(`the value of ${location} cannot be stored in .dev.vars: ${why}`);
  if (/[\r\n]/.test(value)) throw refuse("it contains a line break");
  const escaped = value.replace(/\$/g, "\\$");
  for (const quote of ["'", '"', "`"]) {
    const line = `${location}=${quote}${escaped}${quote}`;
    const read = readDevVars(line);
    if (Object.keys(read).length === 1 && read[location] === value) return line;
  }
  throw refuse("no quoting reads it back unchanged (it contains all three quote characters)");
}

/** A fresh random value: DEV_SECRET_BYTES random bytes, base64url without padding. */
function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(DEV_SECRET_BYTES));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Adds a generated value for each development-only framework secret the Worker would see no value
 * for (absent or empty). Existing values are never changed. Returns the locations added.
 */
export function addMissingDevSecrets(text: string): { text: string; added: string[] } {
  const present = readDevVars(text);
  const added: string[] = [];
  let result = text;
  for (const name of DEV_GENERATED_SECRETS) {
    const location = secretLocation("local", name);
    if ((present[location] ?? "") !== "") continue;
    result = setDevVar(result, location, randomSecret());
    added.push(location);
  }
  return { text: result, added };
}

/**
 * Returns `text` with `location` set to `value`: the first existing assignment is replaced in
 * place, later ones are removed, and other lines are kept (line endings become `\n`). Without an
 * existing assignment the line is appended.
 */
export function setDevVar(text: string, location: string, value: string): string {
  const line = assignmentLine(location, value);
  let source = normalise(text);
  const existing = assignments(source).filter((a) => a.name === location);
  if (existing.length === 0) {
    const separator = source === "" || source.endsWith("\n") ? "" : "\n";
    return `${source}${separator}${line}\n`;
  }
  // Right to left, so earlier offsets stay valid.
  for (const [index, a] of [...existing.entries()].reverse()) {
    const end = source[a.end] === "\n" ? a.end + 1 : a.end;
    source = `${source.slice(0, a.start)}${index === 0 ? `${line}\n` : ""}${source.slice(end)}`;
  }
  return source;
}
