/**
 * Shared support for the E-T1 skill checks (SKILL-AC-001…-004, docs/components/skill.md §4).
 * Written from the criteria and the skill design (skill.md §2 "Layout", "Implementation"), not
 * from the skill's text. Assumptions: DEC-0384…DEC-0389 (docs/decisions/decision-log.md, Item: E-T1).
 *
 * Small Markdown readers: relative links, H2 sections, numbered list items, table rows and
 * fenced code blocks with the line just before each.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** tests/skill → repository root. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const SKILL_DIR = join(REPO_ROOT, "skill");
export const ROUTER = join(SKILL_DIR, "SKILL.md");
export const REFERENCE_DIR = join(SKILL_DIR, "reference");
export const EXAMPLES_DIR = join(SKILL_DIR, "examples");

/** Size budgets in UTF-8 bytes (docs/parameters/parameters.md). */
export const PAR_070_ROUTER_BYTES = 8_000;
export const PAR_071_REFERENCE_BYTES = 12_000;
export const PAR_072_EXAMPLE_BYTES = 20_000;

/** The Markdown files directly in `dir`, as absolute paths, sorted. */
export function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => join(dir, name));
}

export function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Repository-relative path with `/` separators. */
export function repoPath(path: string): string {
  return relative(REPO_ROOT, path).split(sep).join("/");
}

/** `text` with fenced code blocks and inline code spans blanked, so code is not read as links. */
export function withoutCode(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: { char: string; len: number } | null = null;
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null) {
      if (m?.[1] !== undefined) {
        fence = { char: m[1][0] ?? "`", len: m[1].length };
        out.push("");
        continue;
      }
      out.push(line.replace(/`+[^`]*`+/g, (s) => " ".repeat(s.length)));
    } else {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close?.[1] !== undefined && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      out.push("");
    }
  }
  return out.join("\n");
}

export interface Link {
  readonly text: string;
  /** The link target as written. */
  readonly target: string;
  /** Absolute file path of a relative target (anchor dropped); absent for URLs and pure anchors. */
  readonly resolved?: string;
}

/** Every inline Markdown link `[text](target)` outside code in the document at `path`. */
export function linksIn(path: string, text = read(path)): Link[] {
  const out: Link[] = [];
  for (const m of withoutCode(text).matchAll(/!?\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const target = m[2] ?? "";
    const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
    const file = target.split("#")[0] ?? "";
    if (isExternal || file === "") out.push({ text: m[1] ?? "", target });
    else out.push({ text: m[1] ?? "", target, resolved: resolve(dirname(path), decodeURI(file)) });
  }
  return out;
}

/** The resolved relative link targets of `text` (read as the document at `path`). */
export function linkedFiles(path: string, text = read(path)): Set<string> {
  return new Set(linksIn(path, text).flatMap((l) => (l.resolved === undefined ? [] : [l.resolved])));
}

export interface Section {
  readonly heading: string;
  /** Heading level (1 for `#`, 2 for `##`, …). */
  readonly level: number;
  readonly body: string;
}

/** Sections split at ATX headings outside code. Text before the first heading has level 0. */
export function sections(text: string): Section[] {
  const plain = withoutCode(text).split("\n");
  const raw = text.split("\n");
  const out: { heading: string; level: number; lines: string[] }[] = [{ heading: "", level: 0, lines: [] }];
  plain.forEach((line, i) => {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m?.[1] !== undefined) out.push({ heading: m[2] ?? "", level: m[1].length, lines: [] });
    else out[out.length - 1]?.lines.push(raw[i] ?? "");
  });
  return out.map((s) => ({ heading: s.heading, level: s.level, body: s.lines.join("\n") }));
}

/** `text` without a leading YAML front-matter block. */
export function withoutFrontMatter(text: string): string {
  const m = /^---\n[\s\S]*?\n---\n/.exec(text);
  return m === null ? text : text.slice(m[0].length);
}

/** Top-level numbered list items (`1. …` plus their continuation lines), whitespace-collapsed. */
export function numberedItems(body: string): string[] {
  const items: string[] = [];
  let current: string[] | null = null;
  for (const line of body.split("\n")) {
    if (/^\d+[.)]\s+/.test(line)) {
      if (current !== null) items.push(current.join(" "));
      current = [line.replace(/^\d+[.)]\s+/, "")];
    } else if (current !== null && (line.trim() === "" || /^\s/.test(line))) {
      current.push(line.trim());
    } else if (current !== null) {
      items.push(current.join(" "));
      current = null;
    }
  }
  if (current !== null) items.push(current.join(" "));
  return items.map(collapse);
}

/** Whitespace collapsed to single spaces, Markdown emphasis and code ticks removed. */
export function collapse(text: string): string {
  return text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
}

/** Table body rows (not the header or separator) as cell lists, from every table in `text`. */
export function tableRows(text: string): string[][] {
  const out: string[][] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    const next = lines[i + 1]?.trim() ?? "";
    if (/^\|?\s*:?-{3,}/.test(next)) continue; // header row
    out.push(cells);
  }
  return out;
}

export interface FencedBlock {
  /** 1-based line of the opening fence. */
  readonly line: number;
  /** The nearest non-blank line before the opening fence. */
  readonly before: string;
  /** Whether that nearest non-blank line is the line directly above the fence. */
  readonly adjacent: boolean;
  /** The block's content, exactly as between the fence lines (no trailing newline). */
  readonly body: string;
}

/** Every fenced code block in `text`. An unclosed block runs to the end. */
export function fencedBlocks(text: string): FencedBlock[] {
  const lines = text.split("\n");
  const out: FencedBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i] ?? "");
    if (open?.[1] === undefined) continue;
    const char = open[1][0];
    const len = open[1].length;
    let j = i - 1;
    while (j >= 0 && (lines[j] ?? "").trim() === "") j--;
    const before = j >= 0 ? (lines[j] ?? "") : "";
    let k = i + 1;
    for (; k < lines.length; k++) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(lines[k] ?? "");
      if (close?.[1] !== undefined && close[1][0] === char && close[1].length >= len) break;
    }
    out.push({ line: i + 1, before, adjacent: j === i - 1, body: lines.slice(i + 1, k).join("\n") });
    i = k;
  }
  return out;
}

/** Every file under `dir` (recursive), skipping `node_modules`, as absolute paths. */
export function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}
