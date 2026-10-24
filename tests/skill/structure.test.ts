/**
 * SKILL-AC-002: "Every reference opens with 'read this when' and ends with a stopping condition;
 * the router covers each listed task." (docs/components/skill.md §4, SKILL-REQ-002; Where: Local.)
 *
 * SKILL-REQ-002's task list: adding an endpoint, storing data, handling files, adding an admin
 * page, testing, deploying, and diagnosing a failing request or deploy. skill.md §2
 * "Implementation" fixes the shapes checked: a title, then a paragraph beginning "Read this when";
 * a final section "Stopping condition" beginning "Stop reading when"; the task map as a table.
 * Each task must appear in a task-map row that links the reference that task needs.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tag } from "../support/tags.js";
import { linkedFiles, markdownFiles, read, REFERENCE_DIR, repoPath, ROUTER, sections, tableRows, withoutFrontMatter } from "./support.js";

const references = markdownFiles(REFERENCE_DIR);

/** The first paragraph after the document's H1 title, or a description of what is there instead. */
function opening(text: string): string {
  const s = sections(text);
  const preamble = s[0]?.body.trim() ?? "";
  if (preamble !== "") return `(text before the title: ${preamble.slice(0, 60)})`;
  const title = s[1];
  if (title === undefined || title.level !== 1) return "(no H1 title first)";
  return title.body.trim().split(/\n\s*\n/)[0]?.trim() ?? "";
}

interface Task {
  readonly name: string;
  readonly pattern: RegExp;
  readonly reference: string;
  /** Further words the same row must carry. */
  readonly also?: readonly RegExp[];
}

const TASKS: readonly Task[] = [
  { name: "adding an endpoint", pattern: /\bendpoints?\b/i, reference: "http-and-validation.md" },
  { name: "storing data", pattern: /\bstor(?:e|es|ing)\b[^|]*\bdata\b/i, reference: "sql-and-migrations.md" },
  { name: "handling files", pattern: /\bfiles?\b/i, reference: "files.md" },
  { name: "adding an admin page", pattern: /\badmin(?:istration)? pages?\b/i, reference: "current-user.md" },
  { name: "testing", pattern: /\btest(?:s|ing)?\b/i, reference: "testing.md" },
  { name: "deploying", pattern: /\bdeploy(?:s|ing|ment)?\b/i, reference: "deploying.md" },
  { name: "diagnosing a failing request", pattern: /\b(?:diagnos\w*|troubleshoot\w*|debug\w*)\b/i, reference: "troubleshooting.md", also: [/\brequests?\b/i] },
  { name: "diagnosing a failing deploy", pattern: /\b(?:diagnos\w*|troubleshoot\w*|debug\w*)\b/i, reference: "troubleshooting.md", also: [/\bdeploy\w*\b/i] },
];

describe("SKILL: reference structure and router task coverage", () => {
  it(tag("SKILL-AC-002", "every reference opens (after its title) with a paragraph beginning \"Read this when\""), () => {
    expect(references.length).toBeGreaterThan(0);
    const bad = references
      .map((f) => ({ file: repoPath(f), first: opening(read(f)) }))
      .filter((r) => !/^read this when\b/i.test(r.first))
      .map((r) => `${r.file}: ${r.first.slice(0, 80)}`);
    expect(bad).toEqual([]);
  });

  it(tag("SKILL-AC-002", "every reference ends with a \"Stopping condition\" section beginning \"Stop reading when\""), () => {
    const bad: string[] = [];
    for (const f of references) {
      const all = sections(read(f));
      const last = all[all.length - 1];
      const body = last?.body.trim() ?? "";
      if (last === undefined || last.level !== 2 || !/^stopping condition$/i.test(last.heading.trim())) {
        bad.push(`${repoPath(f)}: last section is "${last?.heading ?? ""}"`);
      } else if (!/^stop reading when\b/i.test(body) || body.length < "Stop reading when ".length + 10) {
        bad.push(`${repoPath(f)}: stopping condition reads "${body.slice(0, 60)}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it(tag("SKILL-AC-002", "the router's task map covers each listed task, linking the reference it needs"), () => {
    const text = withoutFrontMatter(read(ROUTER));
    const rows = tableRows(text);
    expect(rows.length, "task-map table rows in skill/SKILL.md").toBeGreaterThan(0);
    const uncovered: string[] = [];
    for (const task of TASKS) {
      const want = join(REFERENCE_DIR, task.reference);
      const hit = rows.some((cells) => {
        const taskCell = cells[0] ?? "";
        if (!task.pattern.test(taskCell)) return false;
        if (!(task.also ?? []).every((p) => p.test(taskCell))) return false;
        return linkedFiles(ROUTER, cells.slice(1).join(" | ")).has(want);
      });
      if (!hit) uncovered.push(`${task.name} → ${task.reference}`);
    }
    expect(uncovered, "tasks with no task-map row linking their reference").toEqual([]);
  });
});
