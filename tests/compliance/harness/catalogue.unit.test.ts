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
  writeFileSync(join(fixture, "components", "cloudflare.md"), "| CF-AC-001 | x | CF-REQ-001 | Cloud |\n");
  writeFileSync(join(fixture, "components", "aws.md"), "| AWS-AC-001 | x | AWS-REQ-001 | Cloud |\n");
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
    writeFileSync(join(fixture, "components", "dup.md"), "| KV-AC-001 | again | KV-REQ-001 | Local |\n");
    expect(() => readCatalogue(fixture)).toThrow(/KV-AC-001 is defined twice/);
    rmSync(join(fixture, "components", "dup.md"));
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
    expect(ids.filter((id) => id.startsWith("E2E-"))).toHaveLength(16);
    expect(ids.filter((id) => /-AC-/.test(id)).length).toBe(124);
    expect(ids).toContain("DEMO-AC-011");
  });

  it("parse E2E-016's review part and AUTH-AC-005's admin-list part", () => {
    const byId = new Map(catalogue.map((e) => [e.id, e.applies]));
    expect(byId.get("E2E-016")).toEqual({ local: { automated: true, milestone: ["review"] } });
    expect(byId.get("AUTH-AC-005")?.cloudflare).toEqual({ automated: true, milestone: ["admin-list part"] });
    expect(byId.get("CF-AC-001")).toEqual({ cloudflare: { automated: true, milestone: [] } });
  });
});
