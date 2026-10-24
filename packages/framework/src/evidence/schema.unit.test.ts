import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVIDENCE_SCHEMA, validateEvidence } from "./schema.js";

const contractPath = new URL("../../../../docs/contracts/schemas/evidence.schema.json", import.meta.url);

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "abc123",
    commit: "0123456789abcdef0123456789abcdef01234567",
    target: "local",
    command: "npm run compliance -- --target local",
    startedAt: "2026-10-20T10:00:00.000Z",
    finishedAt: "2026-10-20T10:01:00.000Z",
    exitStatus: 0,
    results: [{ id: "KV-AC-001", status: "passed" }],
    versions: { "@lago-morph/prototype-framework": "0.1.0" },
    ...overrides,
  };
}

describe("[COMPL-AC-003] evidence schema", () => {
  it("embeds exactly the contract file docs/contracts/schemas/evidence.schema.json", () => {
    expect(EVIDENCE_SCHEMA).toEqual(JSON.parse(readFileSync(contractPath, "utf8")));
  });

  it("accepts a complete record", () => {
    expect(validateEvidence(record())).toEqual([]);
    expect(validateEvidence(record({ stage: "test-abc", leftovers: ["worker x"] }))).toEqual([]);
  });

  // G-EV F3: a run against fakes carries what was faked; the reports never count such a record.
  it("accepts a dry-run marker naming what was faked, as a string", () => {
    expect(validateEvidence(record({ dryRun: "fake stage operations (OperationsFactory)" }))).toEqual([]);
    expect(validateEvidence(record({ dryRun: true }))).toEqual(["/dryRun: must be a string"]);
  });

  it("requires every top-level required field", () => {
    const r = record();
    delete r.commit;
    expect(validateEvidence(r)).toEqual(["/: missing required property commit"]);
  });

  it("rejects unknown properties at the top level and in results", () => {
    expect(validateEvidence(record({ extra: 1 }))).toEqual(["/: unknown property extra"]);
    expect(validateEvidence(record({ results: [{ id: "X", status: "passed", why: "y" }] }))).toEqual(["/results/0: unknown property why"]);
  });

  it("checks enums, integer and date-time", () => {
    expect(validateEvidence(record({ target: "gcp" }))).toEqual(["/target: must be one of local, cloudflare, aws"]);
    expect(validateEvidence(record({ exitStatus: 1.5 }))).toEqual(["/exitStatus: must be an integer"]);
    expect(validateEvidence(record({ startedAt: "yesterday" }))).toEqual(["/startedAt: must be a date-time"]);
    expect(validateEvidence(record({ results: [{ id: "X", status: "ok" }] }))).toEqual(["/results/0/status: must be one of passed, failed, blocked, not-run"]);
  });

  it("requires detail for blocked and not-run results, not for passed or failed", () => {
    expect(validateEvidence(record({ results: [{ id: "X", status: "blocked" }] }))).toEqual(["/results/0: missing required property detail"]);
    expect(validateEvidence(record({ results: [{ id: "X", status: "not-run" }] }))).toEqual(["/results/0: missing required property detail"]);
    expect(validateEvidence(record({ results: [{ id: "X", status: "failed" }] }))).toEqual([]);
    expect(validateEvidence(record({ results: [{ id: "X", status: "blocked", detail: "D1 daily row limit reached" }] }))).toEqual([]);
  });

  it("requires string values in versions and leftovers", () => {
    expect(validateEvidence(record({ versions: { node: 22 } }))).toEqual(["/versions/node: must be a string"]);
    expect(validateEvidence(record({ leftovers: [3] }))).toEqual(["/leftovers/0: must be a string"]);
  });

  it("rejects a non-object", () => {
    expect(validateEvidence([])).toEqual(["/: must be an object"]);
  });
});
