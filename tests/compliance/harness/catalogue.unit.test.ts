import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseWhere, readCatalogue } from "./catalogue.js";

const docs = new URL("../../../docs/", import.meta.url).pathname;

describe("[COMPL-AC-001] criteria catalogue from the documents", () => {
  const fixture = mkdtempSync(join(tmpdir(), "catalogue-"));
  afterAll(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(join(fixture, "components"));
  mkdirSync(join(fixture, "acceptance"));
  writeFileSync(
    join(fixture, "components", "kv.md"),
    [
      "# KV",
      "| ID | Criterion | Verifies | Where |",
      "| --- | --- | --- | --- |",
      "| KV-AC-001 | Put and get; a `a \\| b` pipe. | KV-REQ-001 | Local, cloud |",
      "| KV-AC-002 | Local only. | KV-REQ-002 | Local |",
      "Mentions KV-AC-009 in prose, which is not a definition.",
    ].join("\n"),
  );
  writeFileSync(join(fixture, "components", "cloudflare.md"), "| ID | Criterion | Verifies | Where |\n| --- | --- | --- | --- |\n| CF-AC-001 | x | CF-REQ-001 | Cloud |\n");
  writeFileSync(join(fixture, "components", "aws.md"), "| ID | Criterion | Verifies | Where |\n| --- | --- | --- | --- |\n| AWS-AC-001 | x | AWS-REQ-001 | Cloud |\n");
  writeFileSync(
    join(fixture, "acceptance", "e2e-scenarios.md"),
    ["#### E2E-001 — New app", "Verifies: SYS-REQ-022", "Where: Local", "", "#### E2E-007 — Admin", "Verifies: x", "Where: Local; cloud (milestone)"].join("\n"),
  );

  it("reads criteria rows and scenario headers with their Where text and source file", () => {
    const catalogue = readCatalogue(fixture);
    expect(catalogue.map((e) => [e.id, e.where, e.source])).toEqual([
      ["AWS-AC-001", "Cloud", "components/aws.md"],
      ["CF-AC-001", "Cloud", "components/cloudflare.md"],
      ["E2E-001", "Local", "acceptance/e2e-scenarios.md"],
      ["E2E-007", "Local; cloud (milestone)", "acceptance/e2e-scenarios.md"],
      ["KV-AC-001", "Local, cloud", "components/kv.md"],
      ["KV-AC-002", "Local", "components/kv.md"],
    ]);
  });

  it("maps cloud to both clouds, except in cloudflare.md and aws.md", () => {
    const byId = new Map(readCatalogue(fixture).map((e) => [e.id, e.applies]));
    expect(byId.get("KV-AC-001")).toEqual({ local: { automated: true, milestone: [] }, cloudflare: { automated: true, milestone: [] }, aws: { automated: true, milestone: [] } });
    expect(byId.get("KV-AC-002")).toEqual({ local: { automated: true, milestone: [] } });
    expect(byId.get("CF-AC-001")).toEqual({ cloudflare: { automated: true, milestone: [] } });
    expect(byId.get("AWS-AC-001")).toEqual({ aws: { automated: true, milestone: [] } });
  });

  it("refuses a document that defines one ID twice", () => {
    writeFileSync(join(fixture, "components", "dup.md"), "| ID | Criterion | Verifies | Where |\n| --- | --- | --- | --- |\n| KV-AC-001 | again | KV-REQ-001 | Local |\n");
    expect(() => readCatalogue(fixture)).toThrow(/KV-AC-001 is defined twice/);
    rmSync(join(fixture, "components", "dup.md"));
  });

  // Root cause 2026-10-20-COMPL-AC-001-where-parser-decision-log.md, Review: fix requirements 1–4.
  it("ignores two-, three- and four-column tables of criterion IDs outside criteria tables", () => {
    const before = readCatalogue(fixture);
    mkdirSync(join(fixture, "decisions"));
    writeFileSync(
      join(fixture, "decisions", "decision-log.md"),
      [
        "### DEC-0319 — x",
        "| ID | Why unit-level (criterion text) |",
        "| --- | --- |",
        '| KV-AC-001 | "A unit test of the report generator shows a criterion whose test has lost its tag as untested." Names a unit test. |',
        "",
        "| ID | Change | Note |",
        "| --- | --- | --- |",
        "| KV-AC-001 | x | Cloud |",
        "",
        "| ID | Why | Note | Where |",
        "| --- | --- | --- | --- |",
        "| KV-AC-002 | x | y | Cloud |",
        "| KV-AC-003 | x | y | Local |",
      ].join("\n"),
    );
    try {
      expect(readCatalogue(fixture)).toEqual(before);
    } finally {
      rmSync(join(fixture, "decisions"), { recursive: true });
    }
  });

  it.each([
    ["a body row whose first cell is not a criterion ID", "| KV-AC-003 | x | KV-REQ-003 | Local |\n| note | x | y | Local |", /bad\.md:4/],
    ["a body row with fewer cells than the header", "| KV-AC-003 | x | Local |", /bad\.md:3/],
    ["a body row with more cells than the header", "| KV-AC-003 | x | y | z | Local |", /bad\.md:3/],
  ])("refuses %s inside a criteria table, naming file and line", (_name, body, message) => {
    writeFileSync(join(fixture, "components", "bad.md"), `| ID | Criterion | Verifies | Where |\n| --- | --- | --- | --- |\n${body}\n`);
    try {
      expect(() => readCatalogue(fixture)).toThrow(message);
    } finally {
      rmSync(join(fixture, "components", "bad.md"));
    }
  });

  it("refuses an ID | Criterion header without the Where column, naming file and line", () => {
    writeFileSync(join(fixture, "components", "bad.md"), "Intro.\n| ID | Criterion | Verifies |\n| --- | --- | --- |\n| KV-AC-003 | x | Local |\n");
    try {
      expect(() => readCatalogue(fixture)).toThrow(/bad\.md:2/);
    } finally {
      rmSync(join(fixture, "components", "bad.md"));
    }
  });
});

describe("[COMPL-AC-001] Where parsing", () => {
  it.each([
    ["Local", "x.md", { local: { automated: true, milestone: [] } }],
    ["Cloud (milestone)", "x.md", { cloudflare: { automated: false, milestone: [""] }, aws: { automated: false, milestone: [""] } }],
    ["Cloud (manual, milestone)", "x.md", { cloudflare: { automated: false, milestone: [""] }, aws: { automated: false, milestone: [""] } }],
    ["Local; cloud (milestone)", "x.md", { local: { automated: true, milestone: [] }, cloudflare: { automated: false, milestone: [""] }, aws: { automated: false, milestone: [""] } }],
    [
      "Local, cloud; admin-list part: cloud (milestone)",
      "x.md",
      { local: { automated: true, milestone: [] }, cloudflare: { automated: true, milestone: ["admin-list part"] }, aws: { automated: true, milestone: ["admin-list part"] } },
    ],
    ["Local; review: milestone", "x.md", { local: { automated: true, milestone: ["review"] } }],
    ["Local, cloud (milestone)", "x.md", { local: { automated: false, milestone: [""] }, cloudflare: { automated: false, milestone: [""] }, aws: { automated: false, milestone: [""] } }],
  ])("%s", (where, source, expected) => {
    expect(parseWhere(where, source)).toEqual(expected);
  });

  it("refuses Where text it cannot read", () => {
    expect(() => parseWhere("Somewhere", "x.md")).toThrow(/Where/);
  });
});

describe("[COMPL-AC-002] the real documents", () => {
  const catalogue = readCatalogue(docs);
  it("define every component criterion and scenario once", () => {
    const ids = catalogue.map((e) => e.id);
    // 16, plus E2E-017 (v0.2.0 setup, DEC-0763) and E2E-018 (sign-in, DEC-0764).
    expect(ids.filter((id) => id.startsWith("E2E-"))).toHaveLength(18);
    // 124, less the four retired GOOGLE criteria, plus AUTH-AC-013/014, PWD-AC-001…009 and MAIL-AC-001…007 (DEC-0513);
    // then less the retired DEMO-AC-011, plus AUTH-AC-015, PWD-AC-010, CLI-AC-006 and CLI-AC-007 (DEC-0522, DEC-0526).
    // Then plus SETUP-AC-001…011, CLI-AC-008, SKILL-AC-007 and SKILL-AC-008 (DEC-0603): 155.
    // Then less the retired PWD-AC-001…010 and MAIL-AC-001…007 (v0.2.0, DEC-0696): 138.
    // Then less the retired CLI-AC-006 and CLI-AC-007 (`admins` removed, v0.2.0, DEC-0698): 136.
    expect(ids.filter((id) => /-AC-/.test(id)).length).toBe(136);
    expect(ids.filter((id) => id.startsWith("PWD-AC-") || id.startsWith("MAIL-AC-"))).toEqual([]);
    expect(ids.filter((id) => id.startsWith("GOOGLE-AC-"))).toEqual([]);
    expect(ids).not.toContain("DEMO-AC-011");
    for (const id of ["AUTH-AC-015", "CLI-AC-008"]) expect(ids).toContain(id);
    for (const id of ["CLI-AC-006", "CLI-AC-007"]) expect(ids).not.toContain(id);
  });

  it("parse E2E-016's review part and the live sign-in parts of E2E-007 and E2E-008 (DEC-0755); AUTH-AC-005 has no milestone part (DEC-0526)", () => {
    const byId = new Map(catalogue.map((e) => [e.id, e.applies]));
    expect(byId.get("E2E-016")).toEqual({ local: { automated: true, milestone: ["review"] } });
    expect(byId.get("AUTH-AC-005")?.cloudflare).toEqual({ automated: true, milestone: [] });
    // Plan-v0.2.0 §7.1 (DEC-0753): E2E-007 is automated locally only; on a cloud it has only its live sign-in.
    expect(byId.get("E2E-007")).toEqual({ local: { automated: true, milestone: [] }, cloudflare: { automated: false, milestone: ["live sign-in"] }, aws: { automated: false, milestone: ["live sign-in"] } });
    expect(byId.get("E2E-008")?.cloudflare).toEqual({ automated: true, milestone: ["live sign-in"] });
    expect(byId.get("CF-AC-001")).toEqual({ cloudflare: { automated: true, milestone: [] } });
  });
});
