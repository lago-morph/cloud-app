import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readRecords } from "./records.js";

describe("evidence records under validation/", () => {
  const root = mkdtempSync(join(tmpdir(), "records-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const good = { runId: "r1", commit: "c", target: "local", command: "x", startedAt: "2026-10-20T00:00:00Z", finishedAt: "2026-10-20T00:00:01Z", exitStatus: 0, results: [], versions: {} };
  mkdirSync(join(root, "validation", "local", "r1", "raw"), { recursive: true });
  mkdirSync(join(root, "validation", "local", "phase-B"), { recursive: true });
  writeFileSync(join(root, "validation", "local", "r1.json"), JSON.stringify(good));
  writeFileSync(join(root, "validation", "local", "bad.json"), JSON.stringify({ runId: "x" }));
  writeFileSync(join(root, "validation", "local", "r1", "raw", "vitest.json"), "{}");
  writeFileSync(join(root, "validation", "local", "phase-B", "05a-integration-vitest.json"), "{}");

  it("reads the schema-valid records at validation/<target>/*.json only, and names the others", () => {
    const { records, skipped } = readRecords(root);
    expect(records.map((r) => r.runId)).toEqual(["r1"]);
    expect(skipped).toEqual([expect.stringMatching(/^validation\/local\/bad\.json: \/: missing required property commit/) as unknown]);
  });
});
