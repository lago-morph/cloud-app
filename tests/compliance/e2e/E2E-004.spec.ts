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
 * target's run selects, as the driver's runners list them), and the evidence writer validates records against the schema — and
 * the pass part ("every applicable criterion passed; the record is valid") is read by the
 * evaluator from the same run's evidence record (DEC-0279, DEC-0302…DEC-0310, decision log Item: C-T4). The
 * AWS run is deferred with the AWS target (DEC-0508, branch `aws`); release 1 does not judge it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_SCHEMA, validateEvidence } from "../../../packages/framework/src/evidence/public.js";
import { readCatalogue } from "../harness/catalogue.js";
import { expectedCriteria } from "../harness/expected.js";
import { tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { uncovered } from "../harness/selection.js";
import { listDriverTests } from "../tools/listing.js";
import { REPO_ROOT } from "./support/process.js";

// The coverage part lists every test of the driver's selection through the runners (collect
// only, no test body runs): Vitest's collection of the integration and unit configs takes a while.
const LISTING_TIMEOUT_MS = 10 * 60_000;

test(tag("E2E-004", "coverage part: every criterion and scenario applicable on this target has a tagged test in the suite this run executes"), () => {
  test.setTimeout(LISTING_TIMEOUT_MS);
  const t = target();
  const catalogue = readCatalogue(join(REPO_ROOT, "docs"));
  const expected = expectedCriteria(catalogue, t.target, "automated").filter((e) => e.run);
  expect(expected.length, "criteria expected on this target").toBeGreaterThan(50);
  // Exactly the tests the driver's runners select on this target, as the runners name them
  // (harness/selection.ts, shared with the driver): titles built at run time count, and a
  // unit-layer test counts only for the unit-level IDs it carries.
  const listing = listDriverTests(t.target, { root: REPO_ROOT });
  const untested = uncovered(
    expected.map((e) => e.id),
    listing.tests,
  );
  const problems = listing.errors.length === 0 ? "" : `\n(listing problems: ${listing.errors.join("; ")})`;
  expect(untested, `applicable on ${t.target} but no tagged test in this target's suite:\n${untested.join("\n")}${problems}`).toEqual([]);
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
