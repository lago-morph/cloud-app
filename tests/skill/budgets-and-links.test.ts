/**
 * SKILL-AC-001: "A size check confirms every document is within its budget, and a link check
 * confirms the router links to every reference and each reference links to its examples."
 * (docs/components/skill.md §4, SKILL-REQ-001; Where: Local.)
 *
 * Budgets PAR-070 (router), PAR-071 (each reference), PAR-072 (each example), in UTF-8 bytes.
 * Layout from skill.md §2: router `skill/SKILL.md`, references `skill/reference/*.md`, examples
 * `skill/examples/*.md`; the references are the files CHECK names (`references.ts`).
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REFERENCE_FILES } from "../../packages/framework/src/check/references.js";
import { tag } from "../support/tags.js";
import {
  EXAMPLES_DIR,
  linkedFiles,
  linksIn,
  markdownFiles,
  PAR_070_ROUTER_BYTES,
  PAR_071_REFERENCE_BYTES,
  PAR_072_EXAMPLE_BYTES,
  REFERENCE_DIR,
  repoPath,
  ROUTER,
  SKILL_DIR,
  filesUnder,
} from "./support.js";

const references = markdownFiles(REFERENCE_DIR);
const examples = markdownFiles(EXAMPLES_DIR);

function bytes(path: string): number {
  return statSync(path).size;
}

describe("SKILL: size budgets and links", () => {
  it(tag("SKILL-AC-001", "size check: the router is within PAR-070 (8,000 bytes)"), () => {
    expect(existsSync(ROUTER), "skill/SKILL.md exists").toBe(true);
    expect(bytes(ROUTER), "skill/SKILL.md bytes").toBeLessThanOrEqual(PAR_070_ROUTER_BYTES);
  });

  it(tag("SKILL-AC-001", "size check: every reference is within PAR-071 (12,000 bytes)"), () => {
    expect(references.length, "skill/reference/*.md").toBeGreaterThan(0);
    const over = references.filter((f) => bytes(f) > PAR_071_REFERENCE_BYTES).map((f) => `${repoPath(f)}: ${bytes(f)} bytes`);
    expect(over).toEqual([]);
  });

  it(tag("SKILL-AC-001", "size check: every example is within PAR-072 (20,000 bytes)"), () => {
    expect(examples.length, "skill/examples/*.md").toBeGreaterThan(0);
    const over = examples.filter((f) => bytes(f) > PAR_072_EXAMPLE_BYTES).map((f) => `${repoPath(f)}: ${bytes(f)} bytes`);
    expect(over).toEqual([]);
  });

  it(tag("SKILL-AC-001", "link-check scope: skill/reference holds exactly the reference files CHECK names, so \"every reference\" covers each"), () => {
    const present = references.map((f) => f.slice(REFERENCE_DIR.length + 1)).sort();
    expect(present).toEqual([...REFERENCE_FILES].sort());
  });

  it(tag("SKILL-AC-001", "link check: the router links to every reference"), () => {
    const linked = linkedFiles(ROUTER);
    const missing = references.filter((f) => !linked.has(f)).map(repoPath);
    expect(missing, "references the router does not link to").toEqual([]);
  });

  it(tag("SKILL-AC-001", "link check: each reference links to at least one existing example, and every example is linked from a reference"), () => {
    const exampleSet = new Set(examples);
    const withoutExample: string[] = [];
    const linkedExamples = new Set<string>();
    for (const ref of references) {
      const toExamples = [...linkedFiles(ref)].filter((f) => f.startsWith(EXAMPLES_DIR + "/"));
      const existing = toExamples.filter((f) => exampleSet.has(f));
      if (existing.length === 0) withoutExample.push(repoPath(ref));
      for (const f of existing) linkedExamples.add(f);
    }
    expect(withoutExample, "references with no link to an example").toEqual([]);
    expect(examples.filter((f) => !linkedExamples.has(f)).map(repoPath), "examples no reference links to").toEqual([]);
  });

  // "Its examples" (E-T2, flag F1): every example that shows what a reference covers, not only
  // one. Each row comes from skill.md §2 ("References cover", "Specific content the references
  // carry", "Implementation") and from the files each example copies, never from the
  // references' own text; ai/implementation/decisions/E-T2.md gives the reason for each row.
  // A reference the design ties to no particular example has an empty row and keeps only the
  // "at least one example" check above.
  const ITS_EXAMPLES: Readonly<Record<string, readonly string[]>> = {
    "configuration.md": ["configuration.md"],
    "current-user.md": ["admin-and-current-user.md"],
    "deploying.md": ["configuration.md", "tests.md"],
    "files.md": ["files-tickets.md"],
    "http-and-validation.md": ["endpoint-and-page.md"],
    "kv.md": ["status-kv.md"],
    "local-development.md": ["configuration.md", "endpoint-and-page.md"],
    "log.md": ["notes-sql.md"],
    "owner-tasks.md": ["configuration.md"],
    "secrets.md": ["secrets.md"],
    "sql-and-migrations.md": ["notes-sql.md"],
    "testing.md": ["tests.md"],
    "troubleshooting.md": [],
  };

  it(tag("SKILL-AC-001", "link check: the table of each reference's examples covers exactly the references CHECK names and names only existing examples"), () => {
    expect(Object.keys(ITS_EXAMPLES).sort()).toEqual([...REFERENCE_FILES].sort());
    const unknown = [...new Set(Object.values(ITS_EXAMPLES).flat())].filter((name) => !existsSync(join(EXAMPLES_DIR, name)));
    expect(unknown, "examples named in the table that do not exist").toEqual([]);
  });

  it(tag("SKILL-AC-001", "link check: each reference links to every one of its examples"), () => {
    const missing: string[] = [];
    for (const ref of references) {
      const linked = linkedFiles(ref);
      for (const example of ITS_EXAMPLES[ref.slice(REFERENCE_DIR.length + 1)] ?? []) {
        if (!linked.has(join(EXAMPLES_DIR, example))) missing.push(`${repoPath(ref)} does not link skill/examples/${example}`);
      }
    }
    expect(missing, "missing links from a reference to one of its examples").toEqual([]);
  });

  it(tag("SKILL-AC-001", "link check: every relative link in the skill's documents resolves to an existing file"), () => {
    const docs = filesUnder(SKILL_DIR).filter((f) => f.endsWith(".md"));
    const broken: string[] = [];
    for (const doc of docs) {
      for (const link of linksIn(doc)) {
        if (link.resolved !== undefined && !existsSync(link.resolved)) broken.push(`${repoPath(doc)} → ${link.target}`);
      }
    }
    expect(docs).toContain(join(SKILL_DIR, "SKILL.md"));
    expect(broken).toEqual([]);
  });
});
