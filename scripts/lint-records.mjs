#!/usr/bin/env node
// Record linters (plan v0.2.0 §7a.2.5, TS-12). They run only in the Claude Code commit hook
// (scripts/claude-commit-hook.mjs, .claude/settings.json), never in CI.
//
// Usage: node scripts/lint-records.mjs --staged       lint the staged records, as they are in the index
//        node scripts/lint-records.mjs <file>...      lint these files (anything that is not a record is skipped)
// Exit 0: no problems. Exit 1: problems, on stderr. Exit 2: usage error.
// Records already committed are never linted unless they are staged again.
//
// Root-cause records, ai/implementation/root-causes/<yyyy-mm-dd>-<item-id>-<slug>.md (§7a.1.8, plan.md §10.5):
// - level-2 sections Symptom, Evidence, Causal chain, Alternatives ruled out, Proposed fix, Verification
//   plan and Review, each with content. A heading matches by prefix, case-insensitively, so
//   "## Proposed fix (not applied)" counts.
// - every "## Review…" section holds exactly one `Verdict: accepted | rejected` (older records may say
//   accepted-with-changes), or `Status: awaiting review`, not both.
// - a later attempt is a "## Attempt n" section (n = 2 or 3) holding the same sections at level 3.
// The test-review record lint was withdrawn with plan v0.2.0 TS-10 (#161).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_CAUSE_SECTIONS = ["Symptom", "Evidence", "Causal chain", "Alternatives ruled out", "Proposed fix", "Verification plan", "Review"];
const VERDICTS = ["accepted", "accepted-with-changes", "rejected"];

const RECORD_PATH = /(?:^|\/)ai\/implementation\/(root-causes)\/([^/]+\.md)$/;
const DATE = "\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])";
const ID = "[A-Za-z0-9_.]+";
const ROOT_CAUSE_NAME = new RegExp(`^${DATE}-${ID}(?:-${ID})+\\.md$`);

/** "root-cause", or null for any other path (README.md included). */
export function recordKind(path) {
  const m = RECORD_PATH.exec(path.replaceAll("\\", "/"));
  if (!m || m[2] === "README.md") return null;
  return "root-cause";
}

/** Headings outside fenced code, each with the text up to the next heading of the same or a higher level. */
function sections(text) {
  const lines = text.split("\n");
  const heads = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) heads.push({ level: h[1].length, title: h[2], line: i });
  });
  return heads.map((h, k) => {
    const next = heads.slice(k + 1).find((n) => n.level <= h.level);
    const body = lines.slice(h.line + 1, next ? next.line : lines.length);
    const content = body.filter((l, j) => l.trim() !== "" && !heads.some((x) => x.line === h.line + 1 + j));
    return { ...h, body: body.join("\n"), empty: content.length === 0 };
  });
}

/** Whether a heading title is `name`, optionally followed by a qualifier (not by more letters). */
const titled = (title, name) => title.toLowerCase().startsWith(name.toLowerCase()) && !/^[\p{L}\p{N}]/u.test(title.slice(name.length));

const VERDICT_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?Verdict(?:\*\*)?\s*:\s*(?:\*\*)?\s*`?([^`*.;,(\n]*?)`?\s*(?:[.;,*(]|$)/gim;
const AWAITING = /^\s*(?:[-*]\s+)?(?:\*\*)?Status(?:\*\*)?\s*:\s*(?:\*\*)?\s*`?awaiting review`?/im;
function verdicts(body) {
  return [...body.matchAll(VERDICT_LINE)].map((m) => m[1].trim());
}

const ATTEMPT = /^Attempt ([1-9]\d*)\b/i;
const MAX_ATTEMPTS = 3;

/**
 * The record's attempts (§7a.1.8 step 7): the first is the level-2 sections outside any `## Attempt n`;
 * each `## Attempt n` (n ≥ 2) holds its own sections at level 3.
 */
function attempts(text) {
  const top = sections(text).filter((s) => s.level === 2);
  const out = [{ n: 1, where: "", level: 2, list: top.filter((s) => !ATTEMPT.test(s.title)) }];
  for (const a of top.filter((s) => ATTEMPT.test(s.title))) {
    out.push({ n: Number(ATTEMPT.exec(a.title)[1]), where: `## ${a.title}: `, level: 3, list: sections(a.body).filter((s) => s.level === 3) });
  }
  return out;
}

function checkAttempt({ where, level, list }, problems) {
  const h = "#".repeat(level);
  for (const name of ROOT_CAUSE_SECTIONS) {
    const found = list.filter((s) => titled(s.title, name));
    if (found.length === 0) problems.push(`${where}missing section: ${h} ${name}`);
    else if (name !== "Review" && found.every((s) => s.empty)) problems.push(`${where}section ${h} ${name} is empty`);
  }
  const reviews = list.filter((x) => titled(x.title, "Review"));
  for (const s of reviews) {
    const at = `${where}${h} ${s.title}`;
    const v = verdicts(s.body);
    const awaiting = AWAITING.test(s.body);
    if (v.length === 0 && !awaiting) {
      problems.push(`${at}: no verdict (Verdict: ${VERDICTS.slice(0, 2).join(", ")} or ${VERDICTS[2]}) and no \`Status: awaiting review\``);
      continue;
    }
    if (v.length > 0 && awaiting) {
      problems.push(`${at}: has both a verdict and \`Status: awaiting review\``);
      continue;
    }
    if (v.length > 1) {
      problems.push(`${at}: more than one verdict`);
      continue;
    }
    if (v.length === 1) {
      const value = v[0].toLowerCase();
      if (!VERDICTS.includes(value)) problems.push(`${at}: verdict "${v[0]}" is not one of ${VERDICTS.join(", ")}`);
    }
  }
}

/** Problems in a root-cause record's text; [] when it passes. */
export function lintRootCause(text) {
  const problems = [];
  for (const a of attempts(text)) {
    if (a.n > MAX_ATTEMPTS) problems.push(`${a.where}more than ${MAX_ATTEMPTS} attempts (§7a.1.8 step 7)`);
    else checkAttempt(a, problems);
  }
  return problems;
}

/** Problems in one file, by its kind; [] for a file that is not a record. */
export function lintRecord(path, text) {
  const kind = recordKind(path);
  if (!kind) return [];
  const name = path.replaceAll("\\", "/").split("/").pop();
  return [...(ROOT_CAUSE_NAME.test(name) ? [] : ["file name must be <yyyy-mm-dd>-<item-id>-<slug>.md"]), ...lintRootCause(text)];
}

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

/** The staged records (added, copied, modified or renamed) of the repository at `cwd`, read from the index. */
export function stagedRecords(cwd) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  return git(top, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    .split("\0")
    .filter((p) => p && recordKind(p))
    .map((p) => ({ path: p, text: git(top, ["show", `:${p}`]), top }));
}

/** Lint `records` ({path, text, top?}); returns "<path>: <problem>" lines. */
export function lintAll(records) {
  return records.flatMap(({ path, text }) => lintRecord(path, text).map((p) => `${path}: ${p}`));
}

function main(argv) {
  if (argv.length === 0) {
    process.stderr.write("usage: node scripts/lint-records.mjs --staged | <file>...\n");
    return 2;
  }
  let records;
  if (argv[0] === "--staged") records = stagedRecords(process.cwd());
  else {
    records = argv
      .filter((p) => recordKind(resolve(p)))
      .map((p) => {
        const abs = resolve(p);
        let top;
        try {
          top = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
        } catch {
          top = undefined;
        }
        return { path: p, text: readFileSync(abs, "utf8"), top };
      });
  }
  const problems = lintAll(records);
  if (problems.length) {
    process.stderr.write(`Record lint failed (plan v0.2.0 §7a.1.8):\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
