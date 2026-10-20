/**
 * Text scans for the E2E scenarios:
 * - E2E-016's provider/protocol term scan of the app-facing contracts: case-sensitive,
 *   whole-word, over identifiers, string literals and comments; the terms are kept in one file
 *   (`tests/compliance/e2e/terms.txt`);
 * - E2E-005's login-provider exposure scan of API responses and app-facing types;
 * - E2E-013/E2E-014's secret-value scans. Findings never contain the secret value itself, so a
 *   failure message cannot leak it into the committed raw output.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

// ---------------------------------------------------------------------------------------------
// E2E-016: term list and whole-word matching

/** Reads a term list: one term per line; blank lines and lines starting with `#` are ignored. */
export function readTerms(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

export interface TermFinding {
  readonly term: string;
  readonly line: number;
  readonly where: "identifier" | "string" | "comment" | "text";
  readonly text: string;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Identifier spellings of a multi-word term (`ID token` → `IDToken`, `idToken`, `IdToken`, `id_token`, `ID_TOKEN`). */
function identifierForms(term: string): string[] {
  const words = term.split(/\s+/);
  // A lower-case word is capitalised inside camel-case identifiers (`tokenIssuer`).
  if (words.length === 1) return /^[a-z]/.test(term) ? [term, term.charAt(0).toUpperCase() + term.slice(1)] : [term];
  const cap = (w: string): string => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1));
  const lowerFirst = (w: string): string => w.toLowerCase();
  const pascal = words.map(cap).join("");
  const pascalSimple = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  const camel = lowerFirst(words[0] ?? "") + words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
  const snake = words.map((w) => w.toLowerCase()).join("_");
  return [...new Set([pascal, pascalSimple, camel, snake, snake.toUpperCase()])];
}

/**
 * Whether `form` occurs in `identifier` as a whole word: at the identifier's start or after a
 * non-alphanumeric character or a camel-case boundary, and not followed by a lower-case letter
 * (nor by a digit when the form ends in one). Case-sensitive.
 */
export function identifierHasWord(identifier: string, form: string): boolean {
  let from = 0;
  for (;;) {
    const i = identifier.indexOf(form, from);
    if (i < 0) return false;
    from = i + 1;
    const prev = i === 0 ? "" : identifier.charAt(i - 1);
    const next = identifier.charAt(i + form.length);
    const first = form.charAt(0);
    const last = form.charAt(form.length - 1);
    const prevOk = prev === "" || !/[A-Za-z0-9]/.test(prev) || (/[a-z0-9]/.test(prev) && /[A-Z]/.test(first));
    const nextOk = next === "" || (!/[a-z]/.test(next) && !(/[0-9]/.test(next) && /[0-9]/.test(last)));
    if (prevOk && nextOk) return true;
  }
}

/** Case-sensitive whole-word matches of `term` in prose (comments, strings, YAML text). */
function proseHasTerm(text: string, term: string): boolean {
  const words = term.split(/\s+/).map(escapeRegExp);
  const prose = new RegExp(`(?<![A-Za-z0-9_])${words.join("\\s+")}(?![A-Za-z0-9_])`);
  if (prose.test(text)) return true;
  // Identifier spellings inside prose (`idToken` in a comment or a string).
  for (const token of text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []) {
    if (identifierForms(term).some((form) => identifierHasWord(token, form))) return true;
  }
  return false;
}

function identifierHasTerm(identifier: string, term: string): boolean {
  return identifierForms(term).some((form) => identifierHasWord(identifier, form));
}

function lineAt(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Scans TypeScript source: identifiers, string and template literals, and comments. */
export function scanTypeScriptTerms(source: string, terms: readonly string[]): TermFinding[] {
  const findings: TermFinding[] = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const check = (text: string, where: TermFinding["where"], pos: number): void => {
    for (const term of terms) {
      const hit = where === "identifier" ? identifierHasTerm(text, term) : proseHasTerm(text, term);
      if (hit) findings.push({ term, line: lineAt(source, pos), where, text: text.length > 120 ? `${text.slice(0, 120)}…` : text });
    }
  };
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const pos = scanner.getTokenStart();
    if (kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier) {
      check(scanner.getTokenText(), "identifier", pos);
    } else if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral || kind === ts.SyntaxKind.TemplateHead) {
      check(scanner.getTokenValue(), "string", pos);
    } else if (kind === ts.SyntaxKind.CloseBraceToken) {
      // A template continuation is only recognised when re-scanned as one.
      const re = scanner.reScanTemplateToken(false);
      if (re === ts.SyntaxKind.TemplateMiddle || re === ts.SyntaxKind.TemplateTail) check(scanner.getTokenValue(), "string", pos);
    } else if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      check(scanner.getTokenText(), "comment", pos);
    }
  }
  return findings;
}

/** Scans a YAML (or other text) document: every word-like token as an identifier, and every line as prose. */
export function scanTextTerms(source: string, terms: readonly string[]): TermFinding[] {
  const findings: TermFinding[] = [];
  source.split("\n").forEach((lineText, index) => {
    for (const term of terms) {
      const asIdentifier = (lineText.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []).some((token) => identifierHasTerm(token, term));
      if (asIdentifier || proseHasTerm(lineText, term)) findings.push({ term, line: index + 1, where: "text", text: lineText.trim().slice(0, 120) });
    }
  });
  return findings;
}

/** Files under `dir` (recursive), skipping directories named in `skipDirs`. */
export function listFiles(dir: string, skipDirs: ReadonlySet<string> = new Set()): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) out.push(...listFiles(path, skipDirs));
    } else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------------------------
// E2E-005: login-provider exposure

/** Words that would expose login-provider details (case-insensitive word sequences). */
const PROVIDER_WORD_SEQUENCES: readonly (readonly string[])[] = [["google"], ["oidc"], ["oauth"], ["o", "auth"], ["issuer"], ["iss"], ["email"], ["id", "token"], ["access", "token"], ["refresh", "token"], ["jwt"], ["openid"]];
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const JWT = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\./;

/** Lower-case words of a text: split on non-alphanumerics and camel-case boundaries. */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/[^A-Za-z0-9]+/)) {
    for (const w of chunk.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) ?? []) out.push(w.toLowerCase());
  }
  return out;
}

function hasSequence(list: readonly string[], seq: readonly string[]): boolean {
  for (let i = 0; i + seq.length <= list.length; i++) if (seq.every((w, j) => list[i + j] === w)) return true;
  return false;
}

/** Login-provider names, provider tokens, issuers or email addresses found in `text`, as short labels. */
export function providerExposures(text: string): string[] {
  const found: string[] = [];
  const list = words(text);
  for (const seq of PROVIDER_WORD_SEQUENCES) if (hasSequence(list, seq)) found.push(`word "${seq.join(" ")}"`);
  if (EMAIL_ADDRESS.test(text)) found.push("an email address");
  if (JWT.test(text)) found.push("a JWT-shaped token");
  return found;
}

/** Identifiers and string literals of a TypeScript declaration file (comments excluded). */
export function typeTokens(source: string): string[] {
  const out: string[] = [];
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.Identifier) out.push(scanner.getTokenText());
    else if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) out.push(scanner.getTokenValue());
  }
  return out;
}

/** Relative module specifiers a declaration file imports or re-exports. */
export function relativeImports(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) if (m[1] !== undefined) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// E2E-013 / E2E-014: secret values

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Whether any substring of `text` has the SHA-256 `digestHex` (lower-case hex of the UTF-8
 * value): finds a secret value the test does not know, from `/api/ref/secret`'s digest. Meant
 * for short texts such as error responses (quadratic in the length).
 */
export function containsValueWithDigest(text: string, digestHex: string, maxLength = 4096): boolean {
  const chars = [...text];
  for (let start = 0; start < chars.length; start++) {
    let piece = "";
    for (let end = start; end < chars.length && end - start < maxLength; end++) {
      piece += chars[end];
      if (sha256Hex(piece) === digestHex) return true;
    }
  }
  return false;
}

/** Texts to check for a value: the raw body, and every string inside it when it is JSON. */
export function bodyTexts(raw: string): string[] {
  const out = [raw];
  try {
    const walk = (v: unknown): void => {
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(JSON.parse(raw));
  } catch {
    // not JSON
  }
  return out;
}

export interface SecretFinding {
  /** Where the value was found (a path relative to `root`, a URL, or a log key); never the value. */
  readonly where: string;
}

/** Files under `dir` whose bytes contain `value` (UTF-8). Reports paths only. */
export function filesContaining(dir: string, value: string, options: { readonly root?: string; readonly skipDirs?: ReadonlySet<string> } = {}): SecretFinding[] {
  const needle = Buffer.from(value, "utf8");
  const out: SecretFinding[] = [];
  for (const file of listFiles(dir, options.skipDirs)) {
    if (statSync(file).size > 64 * 1024 * 1024) continue;
    if (readFileSync(file).includes(needle)) out.push({ where: relative(options.root ?? dir, file) });
  }
  return out;
}
