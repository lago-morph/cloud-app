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
// - every "## Review…" section (one per review round, at most 3) holds exactly one
//   `Verdict: accepted | accepted-with-changes | rejected`, or `Status: awaiting review`, not both. A rejected or
//   accepted-with-changes verdict has at least one reason marked **major** or **minor**; an accepted verdict
//   has no **major** one.
// - a "Response" heading is "Response (round n)" and has content.
// - a later attempt is a "## Attempt n" section (n = 2 or 3) holding the same sections at level 3.
// Test-review records, ai/implementation/test-reviews/<yyyy-mm-dd>-<item-id>.md (§7a.1.9): the format
// and its rules are in ai/implementation/test-reviews/README.md.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_CAUSE_SECTIONS = ["Symptom", "Evidence", "Causal chain", "Alternatives ruled out", "Proposed fix", "Verification plan", "Review"];
const VERDICTS = ["accepted", "accepted-with-changes", "rejected"];
const REASON_CODES = ["code-removed", "component-removed", "behaviour-changed", "test-was-wrong", "strengthened", "refactor-only"];
const NEEDS_CITATION = new Set(["code-removed", "component-removed", "behaviour-changed", "test-was-wrong"]);

const RECORD_PATH = /(?:^|\/)ai\/implementation\/(root-causes|test-reviews)\/([^/]+\.md)$/;
const DATE = "\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])";
const ID = "[A-Za-z0-9_.]+";
const ROOT_CAUSE_NAME = new RegExp(`^${DATE}-${ID}(?:-${ID})+\\.md$`);
const TEST_REVIEW_NAME = new RegExp(`^${DATE}-${ID}(?:-${ID})*\\.md$`);

/** "root-cause", "test-review", or null for any other path (README.md included). */
export function recordKind(path) {
  const m = RECORD_PATH.exec(path.replaceAll("\\", "/"));
  if (!m || m[2] === "README.md") return null;
  return m[1] === "root-causes" ? "root-cause" : "test-review";
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
/**
 * A reason marked `kind`: the bold marking opens a line or bullet (also in a blockquote; `**R1, major**`), ends it in
 * parentheses or precedes a colon there (`R1 (**major**): …`), fills a table cell, or follows a label and dash ("M1 — **major**: …"). Prose such as
 * "no **major** issues" does not count.
 */
const marking = (kind) =>
  new RegExp(
    [
      `^\\s*(?:>\\s*)*(?:[-*+]\\s+|\\d+[.)]\\s+)?\\*\\*(?:[^*\\n]*,\\s*)?${kind}\\b[^*\\n]*\\*\\*`,
      `\\(\\*\\*${kind}\\*\\*\\)\\s*(?:[.;:]|$)`,
      `\\|\\s*\\*\\*${kind}\\*\\*\\s*\\|`,
      `\\s[—–-]\\s+\\*\\*${kind}\\*\\*\\s*:`,
    ].join("|"),
    "im",
  );
const MARKED_REASON = marking("(?:major|minor)");

function verdicts(body) {
  return [...body.matchAll(VERDICT_LINE)].map((m) => m[1].trim());
}

const MAJOR_REASON = marking("major");
const ATTEMPT = /^Attempt ([1-9]\d*)\b/i;
const MAX_ATTEMPTS = 3;
const MAX_ROUNDS = 3;

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
  if (reviews.length > MAX_ROUNDS) problems.push(`${where}more than ${MAX_ROUNDS} review rounds in one attempt (§7a.1.8 step 7)`);
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
      else if (value === "accepted" && MAJOR_REASON.test(s.body)) {
        problems.push(`${at}: verdict accepted lists a **major** issue; a major issue needs a Response (round n) and another review round`);
      } else if (value !== "accepted" && !MARKED_REASON.test(s.body)) {
        problems.push(`${at}: verdict ${value} needs at least one reason marked **major** or **minor**`);
      }
    }
  }
}

/** The verdict of the record's last Review section (lower case), or null when it has none. */
export function finalVerdict(text) {
  const reviews = attempts(text)
    .sort((a, b) => a.n - b.n)
    .flatMap((a) => a.list.filter((s) => titled(s.title, "Review")));
  const last = reviews.at(-1);
  if (!last || AWAITING.test(last.body)) return null;
  return verdicts(last.body).at(-1)?.toLowerCase() ?? null;
}

/** Problems in a root-cause record's text; [] when it passes. */
export function lintRootCause(text) {
  const problems = [];
  const all = sections(text);
  for (const a of attempts(text)) {
    if (a.n > MAX_ATTEMPTS) problems.push(`${a.where}more than ${MAX_ATTEMPTS} attempts (§7a.1.8 step 7)`);
    else checkAttempt(a, problems);
  }
  for (const s of all.filter((x) => titled(x.title, "Response"))) {
    if (!/^Response \(round [1-9]\d*\)/i.test(s.title)) problems.push(`heading "${s.title}" must be "Response (round n)"`);
    else if (s.empty) problems.push(`section ${"#".repeat(s.level)} ${s.title} is empty`);
  }
  return problems;
}

const FIELD = /^\s*(?:\*\*)?([A-Z][A-Za-z ]*?)(?::\*\*|\*\*:|:)[ \t]*(.*)$/;

/** Field values in `text`: the inline text plus any bullet lines that follow, up to the next field. */
function fields(text) {
  const out = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const f = FIELD.exec(line);
    if (f && !/^\s*[-*]\s/.test(line)) {
      current = f[1];
      if (!out.has(current)) out.set(current, []);
      if (f[2].trim()) out.get(current).push(f[2].trim());
    } else if (current && /^\s*(?:[-*]|\d+\.)\s+\S/.test(line)) {
      out.get(current).push(line.trim());
    } else if (line.trim() !== "") {
      current = null;
    }
  }
  return out;
}
const value = (map, name) => (map.get(name) ?? []).join("\n").trim();

/**
 * Problems in a test-review record's text; [] when it passes. `exists(path)` and `read(path)` (repository-
 * relative; `read` returns the text or null) check a cited root-cause record: that it exists and that its last
 * Review verdict is accepted or accepted-with-changes. Without them, those checks are skipped.
 */
export function lintTestReview(text, { exists, read } = {}) {
  const problems = [];
  const all = sections(text);
  const groups = all.filter((s) => s.level === 2 && /^Group:/i.test(s.title));
  const firstGroup = groups.length ? text.split("\n").slice(0, groups[0].line).join("\n") : text;
  const head = fields(firstGroup);
  const awaiting = AWAITING.test(firstGroup);
  for (const name of ["Item", "Change set"]) if (!value(head, name)) problems.push(`missing field: ${name}:`);
  if (groups.length === 0) {
    problems.push("no ## Group: <reason-code> section");
    return problems;
  }
  let anyVerdict = false;
  for (const g of groups) {
    const code = /^Group:\s*`?([A-Za-z-]*)`?/i.exec(g.title)[1].toLowerCase();
    const where = `## Group: ${code}`;
    if (!REASON_CODES.includes(code)) {
      problems.push(`${where}: reason code "${code}" is not one of ${REASON_CODES.join(", ")}`);
      continue;
    }
    const f = fields(g.body);
    const cites = value(f, "Cites");
    if (NEEDS_CITATION.has(code)) {
      if (!cites) problems.push(`${where}: missing Cites: (${code === "test-was-wrong" ? "the root-cause record" : "the requirement, decision or plan section"})`);
      else if (code === "test-was-wrong") {
        const rec = /ai\/implementation\/root-causes\/[^\s`)'"]+\.md/.exec(cites);
        if (!rec) problems.push(`${where}: Cites: must name a record ai/implementation/root-causes/<file>.md`);
        else if (exists && !exists(rec[0])) problems.push(`${where}: cited record ${rec[0]} does not exist`);
        else if (read) {
          const cited = read(rec[0]);
          const v = cited === null ? null : finalVerdict(cited);
          if (cited !== null && v !== "accepted" && v !== "accepted-with-changes") problems.push(`${where}: cited record ${rec[0]} has no accepted Review verdict`);
        }
      }
    }
    if (!value(f, "Tests")) problems.push(`${where}: missing Tests: (the changed tests)`);
    const verdict = value(f, "Verdict").replace(/[`*.]/g, "").trim();
    if (verdict) anyVerdict = true;
    if (awaiting) {
      if (verdict) problems.push(`${where}: has a verdict while the record says \`Status: awaiting review\``);
      continue;
    }
    if (!verdict) {
      problems.push(`${where}: missing Verdict: (${VERDICTS.slice(0, 2).join(", ")} or ${VERDICTS[2]}), or \`Status: awaiting review\` for the record`);
      continue;
    }
    if (!VERDICTS.includes(verdict.toLowerCase())) problems.push(`${where}: verdict "${verdict}" is not one of ${VERDICTS.join(", ")}`);
    if (!value(f, "Reasons")) problems.push(`${where}: missing Reasons:`);
  }
  if (!awaiting && anyVerdict && !value(head, "Reviewer")) problems.push("missing field: Reviewer:");
  return problems;
}

/** Problems in one file, by its kind; [] for a file that is not a record. */
export function lintRecord(path, text, options = {}) {
  const kind = recordKind(path);
  if (!kind) return [];
  const name = path.replaceAll("\\", "/").split("/").pop();
  if (kind === "root-cause") {
    return [...(ROOT_CAUSE_NAME.test(name) ? [] : ["file name must be <yyyy-mm-dd>-<item-id>-<slug>.md"]), ...lintRootCause(text)];
  }
  return [...(TEST_REVIEW_NAME.test(name) ? [] : ["file name must be <yyyy-mm-dd>-<item-id>.md"]), ...lintTestReview(text, options)];
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

/** A repository-relative path's text in the index of `top`, else in its working tree, else null. */
export function readIn(top) {
  return (p) => {
    try {
      return git(top, ["show", `:${p}`]);
    } catch {
      return existsSync(join(top, p)) ? readFileSync(join(top, p), "utf8") : null;
    }
  };
}

/** Lint `records` ({path, text, top?}); returns "<path>: <problem>" lines. */
export function lintAll(records) {
  return records.flatMap(({ path, text, top }) => {
    const read = top ? readIn(top) : undefined;
    const options = read ? { read, exists: (p) => read(p) !== null } : {};
    return lintRecord(path, text, options).map((p) => `${path}: ${p}`);
  });
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
    process.stderr.write(`Record lint failed (plan v0.2.0 §7a.1.8, §7a.1.9):\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
