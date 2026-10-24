import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../../../packages/framework/src/evidence/public.js";
import { parseWhere, readCatalogue, type CatalogueEntry } from "../harness/catalogue.js";
import { buildTraceability, renderTraceability, scanSourceTags, type ListedTest } from "./traceability.js";

const entry = (id: string, where: string): CatalogueEntry => ({ id, where, source: "components/kv.md", applies: parseWhere(where, "components/kv.md") });
const catalogue = [entry("KV-AC-001", "Local, cloud"), entry("KV-AC-002", "Local")];

const rec = (target: EvidenceRecord["target"], finishedAt: string, results: EvidenceRecord["results"], runId = finishedAt): EvidenceRecord => ({
  runId,
  commit: "c1",
  target,
  command: "x",
  startedAt: finishedAt,
  finishedAt,
  exitStatus: 0,
  results,
  versions: {},
});

describe("[COMPL-AC-002] traceability report", () => {
  it("lists every criterion with its tests and latest result per target", () => {
    const tests: ListedTest[] = [
      { title: "kv > [KV-AC-001] put", file: "tests/compliance/criteria/kv/kv.test.ts" },
      { title: "[KV-AC-001][KV-AC-002] list", file: "tests/compliance/criteria/kv/kv.test.ts" },
    ];
    const records = [
      rec("local", "2026-10-20T10:00:00Z", [{ id: "KV-AC-001", status: "failed", detail: "boom" }]),
      rec("local", "2026-10-20T11:00:00Z", [{ id: "KV-AC-001", status: "passed" }]),
      rec("cloudflare", "2026-10-20T12:00:00Z", [{ id: "KV-AC-001", status: "blocked", detail: "D1 unavailable" }]),
    ];
    const report = buildTraceability({ catalogue, tests, records });
    expect(report.rows).toEqual([
      {
        id: "KV-AC-001",
        where: "Local, cloud",
        source: "components/kv.md",
        tests: ["tests/compliance/criteria/kv/kv.test.ts › kv > [KV-AC-001] put", "tests/compliance/criteria/kv/kv.test.ts › [KV-AC-001][KV-AC-002] list"],
        results: { local: "passed (2026-10-20T11:00:00Z)", cloudflare: "blocked: D1 unavailable (2026-10-20T12:00:00Z)" },
        untested: false,
      },
      { id: "KV-AC-002", where: "Local", source: "components/kv.md", tests: ["tests/compliance/criteria/kv/kv.test.ts › [KV-AC-001][KV-AC-002] list"], results: {}, untested: false },
    ]);
  });

  it("shows a criterion whose test has lost its tag as untested", () => {
    const tagged = buildTraceability({ catalogue, tests: [{ title: "[KV-AC-002] keys", file: "a.test.ts" }, { title: "[KV-AC-001] put", file: "a.test.ts" }], records: [] });
    expect(tagged.rows.find((r) => r.id === "KV-AC-002")?.untested).toBe(false);
    const lostTag = buildTraceability({ catalogue, tests: [{ title: "keys", file: "a.test.ts" }, { title: "[KV-AC-001] put", file: "a.test.ts" }], records: [] });
    expect(lostTag.rows.find((r) => r.id === "KV-AC-002")).toMatchObject({ tests: [], untested: true });
    expect(lostTag.untested).toEqual(["KV-AC-002"]);
    expect(renderTraceability(lostTag)).toMatch(/\| KV-AC-002 \| Local \| \*\*UNTESTED\*\* \|/);
    expect(renderTraceability(lostTag)).toMatch(/Untested: 1 of 2/);
  });

  it("flags tags that name no criterion or scenario in the documents", () => {
    const report = buildTraceability({ catalogue, tests: [{ title: "[KV-AC-009] typo", file: "a.test.ts" }], records: [] });
    expect(report.unknownTags).toEqual(["KV-AC-009 (a.test.ts › [KV-AC-009] typo)"]);
    expect(renderTraceability(report)).toContain("KV-AC-009 (a.test.ts › [KV-AC-009] typo)");
  });

  it("joins several result entries of one criterion in one run", () => {
    const records = [rec("cloudflare", "2026-10-20T12:00:00Z", [{ id: "KV-AC-001", status: "passed" }, { id: "KV-AC-001", status: "not-run", detail: "cloud production part: Google login mocked for this phase" }])];
    expect(buildTraceability({ catalogue, tests: [], records }).rows[0]?.results.cloudflare).toBe("passed; not-run: cloud production part: Google login mocked for this phase (2026-10-20T12:00:00Z)");
  });

  it("a newer record that did not select a criterion (--only) does not hide the latest result of the run that did", () => {
    const records = [
      rec("cloudflare", "2026-10-20T12:00:00Z", [{ id: "KV-AC-001", status: "passed" }]),
      rec("cloudflare", "2026-10-20T13:00:00Z", [{ id: "KV-AC-001", status: "not-run", detail: "not selected for this run (--only)" }]),
      rec("local", "2026-10-20T13:00:00Z", [{ id: "KV-AC-001", status: "not-run", detail: "not selected for this run (--only)" }]),
    ];
    const results = buildTraceability({ catalogue, tests: [], records }).rows[0]?.results;
    expect(results).toEqual({ cloudflare: "passed (2026-10-20T12:00:00Z)" });
    expect(renderTraceability(buildTraceability({ catalogue, tests: [], records }))).not.toContain("not selected for this run");
  });

  it("lists every ID defined in the real documents", () => {
    const real = readCatalogue(new URL("../../../docs/", import.meta.url).pathname);
    const report = buildTraceability({ catalogue: real, tests: [], records: [] });
    expect(report.rows.map((r) => r.id)).toEqual(real.map((e) => e.id));
    expect(report.rows.length).toBe(140);
  });

  it("finds tags in test sources: bracketed titles and tag() calls, not untagged mentions", () => {
    const source = [
      'it("[KV-AC-001][KV-AC-004] list", () => {});',
      'it(tag("KV-AC-002", "empty keys"), () => {});',
      'test(tag(["SQL-AC-003", "E2E-004"], "cases"), () => {});',
      "// KV-AC-009 mentioned in a comment without brackets",
    ].join("\n");
    expect(scanSourceTags(source)).toEqual(["E2E-004", "KV-AC-001", "KV-AC-002", "KV-AC-004", "SQL-AC-003"]);
  });
});
