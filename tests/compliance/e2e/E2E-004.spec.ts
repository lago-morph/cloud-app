/**
 * E2E-004 — Every capability on every target (Where: Local, cloud).
 *
 * "Run the full compliance suite on local, Cloudflare, and AWS for one commit. Pass: every
 * applicable acceptance criterion passes on every target, and each target has a valid evidence
 * record."
 *
 * The scenario is a property of a whole run's evidence record, which no test inside that run
 * can see: the record is written after every test has finished. So this test checks, inside
 * the run, the part a test can check — the suite this run executes covers every criterion and
 * scenario applicable on this target and tier (each has at least one tagged test that this
 * target's run selects), and the evidence writer validates records against the schema — and
 * the pass part ("every applicable criterion passed; the record is valid") is read by the
 * evaluator from the same run's evidence record (ai/implementation/decisions/C-T4.md). The
 * AWS run is not run in this phase ("AWS phase not started").
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { EVIDENCE_SCHEMA, validateEvidence } from "../../../packages/framework/src/evidence/public.js";
import { readCatalogue } from "../harness/catalogue.js";
import { expectedCriteria } from "../harness/expected.js";
import { tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { scanSourceTags } from "../tools/traceability.js";
import { REPO_ROOT } from "./support/process.js";
import { listFiles } from "./support/scan.js";

/** Test files the driver runs on a target (driver.ts: on a cloud only `tests/compliance/`). */
function suiteFiles(targetName: string): string[] {
  const roots = targetName === "local" ? [join(REPO_ROOT, "tests", "compliance"), join(REPO_ROOT, "packages", "framework", "test", "integration")] : [join(REPO_ROOT, "tests", "compliance")];
  const skip = new Set(["node_modules", "harness", "tools", "test-results"]);
  return roots.flatMap((r) => listFiles(r, skip)).filter((f) => /\.(?:test|spec)\.ts$/.test(f) && !/\.unit\.test\.ts$/.test(f) && !/\.selftest\.ts$/.test(f));
}

test(tag("E2E-004", "coverage part: every criterion and scenario applicable on this target has a tagged test in the suite this run executes"), () => {
  const t = target();
  const catalogue = readCatalogue(join(REPO_ROOT, "docs"));
  const expected = expectedCriteria(catalogue, t.target, "automated").filter((e) => e.run);
  expect(expected.length, "criteria expected on this target").toBeGreaterThan(50);
  const tagged = new Map<string, string[]>();
  for (const file of suiteFiles(t.target)) {
    for (const id of scanSourceTags(readFileSync(file, "utf8"))) tagged.set(id, [...(tagged.get(id) ?? []), relative(REPO_ROOT, file)]);
  }
  const untested = expected.map((e) => e.id).filter((id) => !tagged.has(id));
  expect(untested, `applicable on ${t.target} but no tagged test in this target's suite:\n${untested.join("\n")}`).toEqual([]);
});

test(tag("E2E-004", "record part: the evidence writer accepts a record of this target and rejects an invalid one"), () => {
  const t = target();
  const valid = {
    runId: "e2e004check",
    commit: "0".repeat(40),
    target: t.target,
    command: "npm run compliance",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    exitStatus: 0,
    results: [{ id: "E2E-004", status: "passed" }],
    versions: { node: process.version },
    ...(t.target === "local" ? {} : { stage: t.stage ?? "test-x", leftovers: [] }),
  };
  // The writer's schema is the contract's (docs/contracts/schemas/evidence.schema.json).
  const contract = JSON.parse(readFileSync(join(REPO_ROOT, "docs", "contracts", "schemas", "evidence.schema.json"), "utf8")) as { required: string[]; properties: Record<string, unknown> };
  const schema = EVIDENCE_SCHEMA as unknown as { required: string[]; properties: Record<string, unknown> };
  expect([...schema.required].sort()).toEqual([...contract.required].sort());
  expect(Object.keys(schema.properties).sort()).toEqual(Object.keys(contract.properties).sort());
  expect(validateEvidence(valid)).toEqual([]);
  expect(validateEvidence({ ...valid, results: [{ id: "E2E-004", status: "works" }] })).not.toEqual([]);
  expect(validateEvidence({ ...valid, results: [{ id: "E2E-004", status: "not-run" }] }), "not-run needs a detail").not.toEqual([]);
});
