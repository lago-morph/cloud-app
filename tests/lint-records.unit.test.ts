// Unit tests for the record linters scripts/lint-records.mjs (plan v0.2.0 §7a.2.5, TS-12): the
// root-cause record lint (§7a.1.8, plan.md §10.5). It runs only in the Claude Code commit hook, never in CI.
// The test-review record lint and the review-round rules were withdrawn with plan v0.2.0 TS-4/TS-10 (#161).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintRecord, lintRootCause, recordKind } from "../scripts/lint-records.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "lint-records.mjs");

const ROOT_CAUSE_BODY = `# Root cause: X-AC-001 fails

## Symptom
The test fails.

## Evidence
Output: \`expected 1, got 2\`.

## Causal chain
1. A, because of log line L.

## Alternatives ruled out
- Timing: the failure reproduces with fake timers.

## Proposed fix
Change B.

## Verification plan
Re-run X-AC-001.
`;

const rootCause = (review: string) => `${ROOT_CAUSE_BODY}\n## Review\n${review}\n`;

describe("recordKind", () => {
  it("classifies root-cause records by path, and nothing else", () => {
    expect(recordKind("ai/implementation/root-causes/2026-10-31-S2-x.md")).toBe("root-cause");
    expect(recordKind("/abs/repo/ai/implementation/root-causes/2026-10-31-S2-x.md")).toBe("root-cause");
    expect(recordKind("ai/implementation/test-reviews/2026-10-31-S2.md")).toBeNull();
    expect(recordKind("ai/implementation/test-reviews/README.md")).toBeNull();
    expect(recordKind("ai/implementation/root-causes/README.md")).toBeNull();
    expect(recordKind("ai/implementation/root-causes/2026-10-20-E2E-004-coverage-and-not-run.scan.mjs")).toBeNull();
    expect(recordKind("ai/implementation/root-causes/sub/2026-10-31-S2-x.md")).toBeNull();
    expect(recordKind("docs/root-causes/2026-10-31-S2-x.md")).toBeNull();
    expect(recordKind("ai/implementation/progress-v0.2.0.md")).toBeNull();
  });
});

describe("lintRootCause", () => {
  it("accepts a record with every section and a verdict", () => {
    expect(lintRootCause(rootCause("**Verdict: accepted.** The evidence supports every link."))).toEqual([]);
    expect(lintRootCause(rootCause("Verdict: `accepted`"))).toEqual([]);
    expect(lintRootCause(rootCause("**Verdict: ACCEPTED.**"))).toEqual([]);
  });

  it("accepts a record awaiting review in place of a verdict", () => {
    expect(lintRootCause(rootCause("Status: awaiting review"))).toEqual([]);
    expect(lintRootCause(rootCause("**Status: awaiting review**"))).toEqual([]);
  });

  it("reports a missing Review section", () => {
    expect(lintRootCause(ROOT_CAUSE_BODY)).toEqual(["missing section: ## Review"]);
  });

  it("reports each missing required section by name", () => {
    const text = rootCause("Verdict: accepted").replace("## Causal chain", "## Cause → symptom chain").replace("## Verification plan", "## Verification");
    expect(lintRootCause(text)).toEqual(["missing section: ## Causal chain", "missing section: ## Verification plan"]);
  });

  it("matches section names by prefix, case-insensitively, and allows a qualifier", () => {
    const text = rootCause("Verdict: accepted").replace("## Proposed fix", "## Proposed fix (not applied; owner: B-05)").replace("## Symptom", "## symptom");
    expect(lintRootCause(text)).toEqual([]);
  });

  it("requires the sections at level 2, so a subsection does not stand in for one", () => {
    const text = rootCause("Verdict: accepted").replace("## Evidence", "### Evidence");
    expect(lintRootCause(text)).toContain("missing section: ## Evidence");
  });

  it("does not let a longer word stand in for a section name", () => {
    const text = rootCause("Verdict: accepted").replace("## Evidence", "## Evidenced elsewhere");
    expect(lintRootCause(text)).toContain("missing section: ## Evidence");
  });

  it("reports an empty required section", () => {
    const text = rootCause("Verdict: accepted").replace("## Symptom\nThe test fails.\n", "## Symptom\n\n");
    expect(lintRootCause(text)).toEqual(["section ## Symptom is empty"]);
  });

  it("counts subsection text as the section's content", () => {
    const text = rootCause("Verdict: accepted").replace("## Evidence\nOutput: `expected 1, got 2`.\n", "## Evidence\n### E1. Log\nline\n");
    expect(lintRootCause(text)).toEqual([]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const text = `${ROOT_CAUSE_BODY}\n\`\`\`\n## Review\nVerdict: accepted\n\`\`\`\n`;
    expect(lintRootCause(text)).toContain("missing section: ## Review");
  });

  it("reports a Review section with neither a verdict nor `Status: awaiting review`", () => {
    expect(lintRootCause(rootCause("Looks fine to me."))).toEqual([
      "## Review: no verdict (Verdict: accepted, accepted-with-changes or rejected) and no `Status: awaiting review`",
    ]);
  });

  it("reports a verdict that is not one of the three", () => {
    expect(lintRootCause(rootCause("**Verdict: cause accepted.**"))).toEqual([
      '## Review: verdict "cause accepted" is not one of accepted, accepted-with-changes, rejected',
    ]);
    expect(lintRootCause(rootCause("Verdict: accepted with changes"))).toEqual([
      '## Review: verdict "accepted with changes" is not one of accepted, accepted-with-changes, rejected',
    ]);
  });

  it("reports a Review section with both a verdict and `Status: awaiting review`", () => {
    expect(lintRootCause(rootCause("Status: awaiting review\n\nVerdict: accepted"))).toEqual([
      "## Review: has both a verdict and `Status: awaiting review`",
    ]);
  });

  it("reports more than one verdict in one Review section", () => {
    expect(lintRootCause(rootCause("Verdict: accepted\n\nVerdict: rejected\n- **major** x"))).toEqual(["## Review: more than one verdict"]);
  });

  it("checks every Review round, including one after a Response", () => {
    const text = `${rootCause("Verdict: rejected\n- **major** link 2 unproven")}\n## Response (round 1)\nMore evidence: E7.\n\n## Review (round 2)\nnothing yet\n`;
    expect(lintRootCause(text)).toEqual([
      "## Review (round 2): no verdict (Verdict: accepted, accepted-with-changes or rejected) and no `Status: awaiting review`",
    ]);
    expect(lintRootCause(text.replace("nothing yet", "Verdict: accepted"))).toEqual([]);
  });

  it("allows a qualifier after the verdict", () => {
    expect(lintRootCause(rootCause("**Verdict: accepted-with-changes (binding on the fixer).**\n- **minor** rename"))).toEqual([]);
  });

  const ATTEMPT = (n: number, review: string) =>
    `\n## Attempt ${n}\n${ROOT_CAUSE_BODY.replace(/^# .*\n/, "").replaceAll("## ", "### ")}\n### Review\n${review}\n`;

  it("checks each later attempt's own sections and Review (§7a.1.8 step 7)", () => {
    const first = rootCause("Verdict: accepted");
    expect(lintRootCause(first + ATTEMPT(2, "Verdict: accepted"))).toEqual([]);
    expect(lintRootCause(first + ATTEMPT(2, "nothing"))).toEqual([
      "## Attempt 2: ### Review: no verdict (Verdict: accepted, accepted-with-changes or rejected) and no `Status: awaiting review`",
    ]);
    expect(lintRootCause(`${first}\n## Attempt 2\n### Symptom\nx\n`)).toEqual([
      "## Attempt 2: missing section: ### Evidence",
      "## Attempt 2: missing section: ### Causal chain",
      "## Attempt 2: missing section: ### Alternatives ruled out",
      "## Attempt 2: missing section: ### Proposed fix",
      "## Attempt 2: missing section: ### Verification plan",
      "## Attempt 2: missing section: ### Review",
    ]);
  });

  it("allows at most 3 attempts", () => {
    const text = rootCause("Verdict: accepted") + ATTEMPT(2, "Verdict: accepted") + ATTEMPT(3, "Verdict: accepted") + ATTEMPT(4, "Verdict: accepted");
    expect(lintRootCause(text)).toEqual(["## Attempt 4: more than 3 attempts (§7a.1.8 step 7)"]);
  });
});

describe("lintRecord", () => {
  it("checks the file name of a root-cause record, and ignores test-review files", () => {
    expect(lintRecord("ai/implementation/root-causes/2026-10-31-S2-x.md", rootCause("Verdict: accepted"))).toEqual([]);
    expect(lintRecord("ai/implementation/root-causes/S2-x.md", rootCause("Verdict: accepted"))).toEqual([
      "file name must be <yyyy-mm-dd>-<item-id>-<slug>.md",
    ]);
    expect(lintRecord("ai/implementation/root-causes/2026-13-01-S2-x.md", rootCause("Verdict: accepted"))).toEqual([
      "file name must be <yyyy-mm-dd>-<item-id>-<slug>.md",
    ]);
    expect(lintRecord("ai/implementation/root-causes/2026-10-31-S2.md", rootCause("Verdict: accepted"))).toEqual([
      "file name must be <yyyy-mm-dd>-<item-id>-<slug>.md",
    ]);
    expect(lintRecord("ai/implementation/test-reviews/2026-10-31-S2.md", "anything")).toEqual([]);
  });

  it("allows underscores and dots in an item id or slug", () => {
    expect(lintRecord("ai/implementation/root-causes/2026-10-31-S2-fix_flaky.v2.md", rootCause("Verdict: accepted"))).toEqual([]);
  });

  it("returns nothing for a file that is not a record", () => {
    expect(lintRecord("ai/implementation/progress-v0.2.0.md", "anything")).toEqual([]);
  });
});

describe("CLI", () => {
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "lint-records-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    mkdirSync(join(dir, "ai/implementation/root-causes"), { recursive: true });
    // An existing, committed record in an older format: never linted unless staged.
    writeFileSync(join(dir, "ai/implementation/root-causes/2026-10-19-old-record.md"), "# old\n## Cause → symptom chain\nx\n");
    git("add", ".");
    git("commit", "-q", "-m", "old");
    return dir;
  }
  const run = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });

  it("--staged lints only staged records, from the index", () => {
    const dir = repo();
    expect(run(dir, "--staged").status).toBe(0);
    const rec = "ai/implementation/root-causes/2026-10-31-S2-scratch.md";
    writeFileSync(join(dir, rec), ROOT_CAUSE_BODY);
    expect(run(dir, "--staged").status).toBe(0); // not staged yet
    execFileSync("git", ["add", rec], { cwd: dir });
    const r = run(dir, "--staged");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${rec}: missing section: ## Review`);
    expect(r.stderr).not.toContain("2026-10-19-old-record.md");
    // The index, not the working tree, is what gets committed.
    writeFileSync(join(dir, rec), rootCause("Status: awaiting review"));
    expect(run(dir, "--staged").status).toBe(1);
    execFileSync("git", ["add", rec], { cwd: dir });
    expect(run(dir, "--staged").status).toBe(0);
  });

  it("lints the files named on the command line", () => {
    const dir = repo();
    const rec = join(dir, "ai/implementation/root-causes/2026-10-19-old-record.md");
    const r = run(dir, rec);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("missing section: ## Symptom");
    expect(run(dir, join(dir, "README.md")).status).toBe(0);
  });

  it("refuses to run with no files and no --staged", () => {
    const r = run(repo());
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage/i);
  });
});
