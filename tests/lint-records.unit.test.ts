// Unit tests for the record linters scripts/lint-records.mjs (plan v0.2.0 §7a.2.5, TS-12): the
// root-cause record lint (§7a.1.8, plan.md §10.5) and the test-review record lint (§7a.1.9,
// ai/implementation/test-reviews/README.md). They run only in the Claude Code commit hook, never in CI.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintRecord, lintRootCause, lintTestReview, recordKind } from "../scripts/lint-records.mjs";

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
  it("classifies root-cause and test-review records by path, and nothing else", () => {
    expect(recordKind("ai/implementation/root-causes/2026-10-31-S2-x.md")).toBe("root-cause");
    expect(recordKind("/abs/repo/ai/implementation/root-causes/2026-10-31-S2-x.md")).toBe("root-cause");
    expect(recordKind("ai/implementation/test-reviews/2026-10-31-S2.md")).toBe("test-review");
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

  it("requires reasons marked **major** or **minor** for rejected and accepted-with-changes", () => {
    expect(lintRootCause(rootCause("Verdict: rejected\n\n- The chain skips a link."))).toEqual([
      "## Review: verdict rejected needs at least one reason marked **major** or **minor**",
    ]);
    expect(lintRootCause(rootCause("Verdict: accepted-with-changes\n\n- change the fix"))).toEqual([
      "## Review: verdict accepted-with-changes needs at least one reason marked **major** or **minor**",
    ]);
    expect(lintRootCause(rootCause("Verdict: rejected\n\n1. **major** Link 2 has no evidence."))).toEqual([]);
    expect(lintRootCause(rootCause("Verdict: accepted-with-changes\n\n- **Minor (R1):** rename the test."))).toEqual([]);
  });

  it("checks every Review round, including one after a Response", () => {
    const text = `${rootCause("Verdict: rejected\n- **major** link 2 unproven")}\n## Response (round 1)\nMore evidence: E7.\n\n## Review (round 2)\nnothing yet\n`;
    expect(lintRootCause(text)).toEqual([
      "## Review (round 2): no verdict (Verdict: accepted, accepted-with-changes or rejected) and no `Status: awaiting review`",
    ]);
    expect(lintRootCause(text.replace("nothing yet", "Verdict: accepted"))).toEqual([]);
  });

  it("requires Response sections to be named `Response (round n)` and not empty", () => {
    const base = rootCause("Verdict: rejected\n- **major** link 2 unproven");
    expect(lintRootCause(`${base}\n## Response\nE7.\n`)).toEqual(['heading "Response" must be "Response (round n)"']);
    expect(lintRootCause(`${base}\n## Response (round 1)\n\n## Review (round 2)\nStatus: awaiting review\n`)).toEqual([
      "section ## Response (round 1) is empty",
    ]);
  });

  it("allows a qualifier after the verdict", () => {
    expect(lintRootCause(rootCause("**Verdict: accepted-with-changes (binding on the fixer).**\n- **minor** rename"))).toEqual([]);
  });

  it("counts a **major** marking only where it opens a reason, not in prose", () => {
    expect(lintRootCause(rootCause("Verdict: accepted. No **major** or **minor** issues."))).toEqual([]);
    expect(lintRootCause(rootCause("Verdict: accepted\n\n**Major (M1):** link 2 has no evidence"))).toEqual([
      "## Review: verdict accepted lists a **major** issue; a major issue needs a Response (round n) and another review round",
    ]);
  });

  it("counts a marking at the end of a reason, in a blockquote and in a table cell", () => {
    const flagged = "## Review: verdict accepted lists a **major** issue; a major issue needs a Response (round n) and another review round";
    for (const reason of ["- Link 2 has no evidence (**major**)", "> - **major** x", "| M1 | **major** | x |", "- M1 — **major**: x"]) {
      expect(lintRootCause(rootCause(`Verdict: accepted\n\n${reason}`)), reason).toEqual([flagged]);
    }
    expect(lintRootCause(rootCause("Verdict: rejected\n\n- rename the test (**minor**)"))).toEqual([]);
  });

  it("counts `R1 (**major**):` and `**R1, major**` markings, but not a bold sentence that only mentions major", () => {
    const flagged = "## Review: verdict accepted lists a **major** issue; a major issue needs a Response (round n) and another review round";
    for (const reason of ["- R1 (**major**): x", "- **R1, major** (file:1): x"]) {
      expect(lintRootCause(rootCause(`Verdict: accepted\n\n${reason}`)), reason).toEqual([flagged]);
    }
    expect(lintRootCause(rootCause("Verdict: rejected\n\n- R2 (**minor**): x"))).toEqual([]);
    expect(lintRootCause(rootCause("Verdict: accepted\n\n**No major issues.**"))).toEqual([]);
  });

  it("rejects an accepted verdict that carries a **major** issue, which needs a Response first (§7a.1.8 step 3)", () => {
    expect(lintRootCause(rootCause("Verdict: accepted\n\n- **major** link 2 has no evidence"))).toEqual([
      "## Review: verdict accepted lists a **major** issue; a major issue needs a Response (round n) and another review round",
    ]);
    expect(lintRootCause(rootCause("Verdict: accepted\n\n- **minor** typo"))).toEqual([]);
  });

  it("allows at most 3 review rounds per attempt", () => {
    let text = rootCause("Verdict: rejected\n- **major** a");
    for (const n of [1, 2, 3]) text += `\n## Response (round ${n})\nr\n\n## Review (round ${n + 1})\n${n === 3 ? "Verdict: accepted" : "Verdict: rejected\n- **major** a"}\n`;
    expect(lintRootCause(text)).toEqual(["more than 3 review rounds in one attempt (§7a.1.8 step 7)"]);
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

const REVIEW_HEAD = `# Test-change review: S2, 2026-10-31

Item: S2
Change set: v0.2.0/10-record-linters
Author: S2 implementer
Reviewer: independent test-change reviewer subagent
`;

const GROUP_RC = `## Group: code-removed — the email setup module
Cites: plan v0.2.0 §6, DEC-0601
Tests:
- \`packages/framework/src/x.unit.test.ts\` — whole file removed
Verdict: accepted
Reasons:
- The module is removed by the cited decision; no remaining code is uncovered.
`;

describe("lintTestReview", () => {
  it("accepts a reviewed record", () => {
    expect(lintTestReview(`${REVIEW_HEAD}\n${GROUP_RC}`)).toEqual([]);
  });

  it("accepts a record awaiting review with no verdicts", () => {
    const text = `${REVIEW_HEAD.replace("Reviewer: independent test-change reviewer subagent\n", "")}Status: awaiting review\n\n${GROUP_RC.replace(/Verdict:[\s\S]*$/, "")}`;
    expect(lintTestReview(text)).toEqual([]);
  });

  it("requires the Item and Change set fields", () => {
    const text = `${REVIEW_HEAD.replace("Item: S2\n", "").replace("Change set: v0.2.0/10-record-linters\n", "Change set:\n")}\n${GROUP_RC}`;
    expect(lintTestReview(text)).toEqual(["missing field: Item:", "missing field: Change set:"]);
  });

  it("requires at least one group", () => {
    expect(lintTestReview(REVIEW_HEAD)).toEqual(["no ## Group: <reason-code> section"]);
  });

  it("rejects a reason code that is not one of the six", () => {
    const text = `${REVIEW_HEAD}\n${GROUP_RC.replace("code-removed", "flaky")}`;
    expect(lintTestReview(text)).toEqual([
      '## Group: flaky: reason code "flaky" is not one of code-removed, component-removed, behaviour-changed, test-was-wrong, strengthened, refactor-only',
    ]);
  });

  it("requires a citation for code-removed, component-removed, behaviour-changed and test-was-wrong, not for the others", () => {
    for (const code of ["code-removed", "component-removed", "behaviour-changed"]) {
      const text = `${REVIEW_HEAD}\n${GROUP_RC.replace("code-removed", code).replace("Cites: plan v0.2.0 §6, DEC-0601\n", "")}`;
      expect(lintTestReview(text)).toEqual([`## Group: ${code}: missing Cites: (the requirement, decision or plan section)`]);
    }
    for (const code of ["strengthened", "refactor-only"]) {
      const text = `${REVIEW_HEAD}\n${GROUP_RC.replace("code-removed", code).replace("Cites: plan v0.2.0 §6, DEC-0601\n", "")}`;
      expect(lintTestReview(text)).toEqual([]);
    }
  });

  it("requires test-was-wrong to cite a root-cause record that exists", () => {
    const group = (cites: string) => `${REVIEW_HEAD}\n${GROUP_RC.replace("code-removed", "test-was-wrong").replace("Cites: plan v0.2.0 §6, DEC-0601", `Cites: ${cites}`)}`;
    expect(lintTestReview(group("DEC-0601"))).toEqual(["## Group: test-was-wrong: Cites: must name a record ai/implementation/root-causes/<file>.md"]);
    const path = "ai/implementation/root-causes/2026-10-31-S2-wrong-expectation.md";
    expect(lintTestReview(group(`\`${path}\``), { exists: (p: string) => p === path })).toEqual([]);
    expect(lintTestReview(group(path), { exists: () => false })).toEqual([`## Group: test-was-wrong: cited record ${path} does not exist`]);
  });

  it("requires the cited root-cause record of test-was-wrong to be accepted", () => {
    const path = "ai/implementation/root-causes/2026-10-31-S2-wrong-expectation.md";
    const text = `${REVIEW_HEAD}\n${GROUP_RC.replace("code-removed", "test-was-wrong").replace("Cites: plan v0.2.0 §6, DEC-0601", `Cites: ${path}`)}`;
    const opts = (record: string) => ({ exists: () => true, read: (p: string) => (p === path ? record : null) });
    expect(lintTestReview(text, opts(rootCause("Verdict: accepted")))).toEqual([]);
    expect(lintTestReview(text, opts(rootCause("Verdict: accepted-with-changes\n- **minor** x")))).toEqual([]);
    expect(lintTestReview(text, opts(rootCause("Status: awaiting review")))).toEqual([
      `## Group: test-was-wrong: cited record ${path} has no accepted Review verdict`,
    ]);
    expect(lintTestReview(text, opts(`${rootCause("Verdict: rejected\n- **major** x")}\n## Response (round 1)\nr\n\n## Review (round 2)\nVerdict: accepted\n`))).toEqual([]);
    expect(lintTestReview(text, opts(`${rootCause("Verdict: accepted")}\n## Response (round 1)\nr\n\n## Review (round 2)\nVerdict: rejected\n- **major** y\n`))).toEqual([
      `## Group: test-was-wrong: cited record ${path} has no accepted Review verdict`,
    ]);
  });

  it("requires each group to list its tests", () => {
    const text = `${REVIEW_HEAD}\n${GROUP_RC.replace(/Tests:\n- [^\n]*\n/, "Tests:\n")}`;
    expect(lintTestReview(text)).toEqual(["## Group: code-removed: missing Tests: (the changed tests)"]);
  });

  it("requires a verdict, its reasons and the reviewer once the record is not awaiting review", () => {
    expect(lintTestReview(`${REVIEW_HEAD}\n${GROUP_RC.replace("Verdict: accepted\n", "")}`)).toEqual([
      "## Group: code-removed: missing Verdict: (accepted, accepted-with-changes or rejected), or `Status: awaiting review` for the record",
    ]);
    expect(lintTestReview(`${REVIEW_HEAD}\n${GROUP_RC.replace(/Reasons:[\s\S]*$/, "Reasons:\n")}`)).toEqual(["## Group: code-removed: missing Reasons:"]);
    expect(lintTestReview(`${REVIEW_HEAD.replace(/Reviewer:.*\n/, "")}\n${GROUP_RC}`)).toEqual(["missing field: Reviewer:"]);
  });

  it("rejects a verdict that is not one of the three", () => {
    expect(lintTestReview(`${REVIEW_HEAD}\n${GROUP_RC.replace("Verdict: accepted", "Verdict: ok")}`)).toEqual([
      '## Group: code-removed: verdict "ok" is not one of accepted, accepted-with-changes, rejected',
    ]);
  });

  it("rejects a record awaiting review that already has a verdict", () => {
    expect(lintTestReview(`${REVIEW_HEAD}Status: awaiting review\n\n${GROUP_RC}`)).toEqual([
      "## Group: code-removed: has a verdict while the record says `Status: awaiting review`",
    ]);
  });

  it("checks every group", () => {
    const second = GROUP_RC.replace("code-removed — the email setup module", "refactor-only — moved helpers").replace("Verdict: accepted\n", "");
    expect(lintTestReview(`${REVIEW_HEAD}\n${GROUP_RC}\n${second}`)).toEqual([
      "## Group: refactor-only: missing Verdict: (accepted, accepted-with-changes or rejected), or `Status: awaiting review` for the record",
    ]);
  });
});

describe("lintRecord", () => {
  it("checks the file name of each kind", () => {
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
    expect(lintRecord("ai/implementation/test-reviews/2026-10-31-S2.md", `${REVIEW_HEAD}\n${GROUP_RC}`)).toEqual([]);
    expect(lintRecord("ai/implementation/test-reviews/S2.md", `${REVIEW_HEAD}\n${GROUP_RC}`)).toEqual(["file name must be <yyyy-mm-dd>-<item-id>.md"]);
  });

  it("allows underscores and dots in an item id or slug", () => {
    expect(lintRecord("ai/implementation/root-causes/2026-10-31-S2-fix_flaky.v2.md", rootCause("Verdict: accepted"))).toEqual([]);
    expect(lintRecord("ai/implementation/test-reviews/2026-10-31-T_7.md", `${REVIEW_HEAD}\n${GROUP_RC}`)).toEqual([]);
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
