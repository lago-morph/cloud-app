/**
 * `whereSets` reads criteria only from criteria tables (root cause
 * ai/implementation/root-causes/2026-10-20-COMPL-AC-001-where-parser-decision-log.md, Review:
 * fix requirements 1–4). Fixture docs trees in a temp dir, not the real `docs/`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { milestoneItemsNamed, whereSets } from "./support.js";

const HEADER = ["| ID | Criterion | Verifies | Where |", "| --- | --- | --- | --- |"];

function tree(files: Record<string, string[]>): string {
  const dir = mkdtempSync(join(tmpdir(), "where-sets-"));
  for (const [path, lines] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), lines.join("\n"));
  }
  return dir;
}

const sorted = (s: ReadonlySet<string>): string[] => [...s].sort();

describe("[COMPL-AC-001] whereSets reads criteria only from criteria tables", () => {
  const dirs: string[] = [];
  const make = (files: Record<string, string[]>): string => {
    const dir = tree(files);
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const criteria = {
    "components/compliance.md": [
      "# Compliance",
      ...HEADER,
      "| COMPL-AC-001 | One command; a `a \\| b` pipe. | COMPL-REQ-001 | Local, cloud |",
      "| COMPL-AC-002 | Unit test. | COMPL-REQ-002 | Local |",
      "",
      "Prose that mentions COMPL-AC-009.",
    ],
    "components/cloudflare.md": [...HEADER, "| CF-AC-001 | x | CF-REQ-001 | Cloud (milestone) |"],
    "acceptance/e2e-scenarios.md": ["#### E2E-001 — New app", "Verifies: SYS-REQ-022", "Where: Local; cloud (milestone)"],
  };

  it("reads the Where column of criteria tables and the scenarios' Where lines", () => {
    const sets = whereSets(make(criteria));
    expect(sorted(sets.automated.local)).toEqual(["COMPL-AC-001", "COMPL-AC-002", "E2E-001"]);
    expect(sorted(sets.automated.cloudflare)).toEqual(["COMPL-AC-001"]);
    expect(sorted(sets.automated.aws)).toEqual(["COMPL-AC-001"]);
    expect(sorted(sets.milestone.local)).toEqual([]);
    expect(sorted(sets.milestone.cloudflare)).toEqual(["CF-AC-001", "E2E-001"]);
    expect(sorted(sets.milestone.aws)).toEqual(["E2E-001"]);
  });

  it("ignores a two-column table of criterion IDs outside a criteria table (DEC-0319's shape)", () => {
    const dir = make({
      ...criteria,
      "decisions/decision-log.md": [
        "### DEC-0319 — x",
        "| ID | Why unit-level (criterion text) |",
        "| --- | --- |",
        '| COMPL-AC-002 | "A unit test of the report generator shows a criterion whose test has lost its tag as untested." Names a unit test. |',
      ],
    });
    expect(sorted(whereSets(dir).automated.local)).toEqual(["COMPL-AC-001", "COMPL-AC-002", "E2E-001"]);
  });

  it("ignores three- and four-column tables of criterion IDs outside criteria tables", () => {
    const dir = make({
      ...criteria,
      "decisions/decision-log.md": [
        "| ID | Change | Note |",
        "| --- | --- | --- |",
        "| COMPL-AC-002 | x | Cloud |",
        "",
        "| ID | Why | Note | Where |",
        "| --- | --- | --- | --- |",
        "| COMPL-AC-003 | x | y | Local |",
      ],
    });
    const sets = whereSets(dir);
    expect(sorted(sets.automated.local)).toEqual(["COMPL-AC-001", "COMPL-AC-002", "E2E-001"]);
    expect(sorted(sets.automated.cloudflare)).toEqual(["COMPL-AC-001"]);
  });

  it.each([
    ["a body row whose first cell is not a criterion ID", [...HEADER, "| COMPL-AC-001 | x | y | Local |", "| note | x | y | Local |"], /bad\.md:4/],
    ["a body row with fewer cells than the header", [...HEADER, "| COMPL-AC-001 | x | Local |"], /bad\.md:3/],
    ["a body row with more cells than the header", [...HEADER, "| COMPL-AC-001 | x | y | z | Local |"], /bad\.md:3/],
    ["an ID | Criterion header without the Where column", ["| ID | Criterion | Verifies |", "| --- | --- | --- |", "| COMPL-AC-001 | x | Local |"], /bad\.md:1/],
  ])("throws, with file and line, on %s inside a criteria table", (_name, lines, message) => {
    const dir = make({ ...criteria, "components/bad.md": lines });
    expect(() => whereSets(dir)).toThrow(message);
  });
});

describe("[COMPL-AC-001] milestoneItemsNamed reads COMPL-REQ-006's list as last amended", () => {
  const original = "The milestone items are GOOGLE-AC-005, E2E-007 (cloud part), AUTH-AC-005 (admin-list part) and COMPL-AC-008. A milestone item MUST be run again.";
  const amendment = "Amendment (DEC-0526): E2E-007 leaves the list. The milestone items of release 1 are therefore E2E-015, MAIL-AC-007 and COMPL-AC-008.";
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const docs = (lines: string[]): string => {
    const dir = tree({ "components/compliance.md": lines });
    dirs.push(dir);
    return dir;
  };

  it("takes the original sentence when no amendment restates the list", () => {
    expect(sorted(milestoneItemsNamed(docs(["#### COMPL-REQ-006", "", original])))).toEqual(["AUTH-AC-005", "COMPL-AC-008", "E2E-007", "GOOGLE-AC-005"]);
  });

  it("takes the latest amendment's full list over the original", () => {
    expect(sorted(milestoneItemsNamed(docs(["#### COMPL-REQ-006", "", original, "", amendment])))).toEqual(["COMPL-AC-008", "E2E-015", "MAIL-AC-007"]);
  });

  it("on the real compliance.md, gives DEC-0526's release 1 list", () => {
    expect(sorted(milestoneItemsNamed())).toEqual(["COMPL-AC-008", "E2E-010", "E2E-012", "E2E-015", "E2E-016", "MAIL-AC-007", "PROV-AC-003", "PROV-AC-004", "PROV-AC-006", "SKILL-AC-006"]);
  });
});
