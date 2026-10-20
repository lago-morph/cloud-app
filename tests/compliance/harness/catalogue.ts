/**
 * The catalogue of acceptance criteria and E2E scenarios, read from the documents
 * (COMPL-REQ-001, COMPL-REQ-002). Component criteria are table rows whose first cell is the ID
 * and whose last cell is the "Where" column; scenarios are `#### E2E-nnn` headers followed by a
 * `Where:` line (e2e-scenarios.md preamble).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Target = "local" | "cloudflare" | "aws";
export const TARGETS: readonly Target[] = ["local", "cloudflare", "aws"];

/** How a criterion applies on one target. */
export interface TargetApplicability {
  /** Run on every commit (the automated tier). */
  readonly automated: boolean;
  /** Milestone parts on this target: "" for the whole criterion, else the part's label. */
  readonly milestone: readonly string[];
}

export type Applicability = Partial<Record<Target, TargetApplicability>>;

export interface CatalogueEntry {
  readonly id: string;
  readonly where: string;
  /** Path relative to the docs directory. */
  readonly source: string;
  readonly applies: Applicability;
}

const ROW = /^\|\s*((?:[A-Z]+-AC)-\d{3})\s*\|.*\|\s*([^|]*?)\s*\|\s*$/;
const SCENARIO = /^####\s+(E2E-\d{3})\b/;
const WHERE_LINE = /^Where:\s*(.+?)\s*$/;

function cloudsFor(source: string): Target[] {
  if (source.endsWith("cloudflare.md")) return ["cloudflare"];
  if (source.endsWith("aws.md")) return ["aws"];
  return ["cloudflare", "aws"];
}

/** Parses a "Where" column or line. Throws on text it cannot read. */
export function parseWhere(where: string, source: string): Applicability {
  const result: Partial<Record<Target, { automated: boolean; milestone: string[] }>> = {};
  let firstTargets: Target[] = [];
  where.split(";").forEach((rawSegment, index) => {
    const segment = rawSegment.trim();
    const labelled = /^([^:()]+):\s*(.+)$/.exec(segment);
    const label = labelled?.[1]?.trim() ?? "";
    const body = (labelled?.[2] ?? segment).trim();
    const parts = /^([A-Za-z ,]*?)\s*(?:\(([^)]*)\))?$/.exec(body);
    if (parts === null) throw new Error(`${source}: cannot read the Where text ${JSON.stringify(where)}`);
    let targetText = parts[1] ?? "";
    let flags = (parts[2] ?? "").split(",").map((f) => f.trim().toLowerCase()).filter((f) => f !== "");
    if (targetText.trim().toLowerCase() === "milestone" && flags.length === 0) {
      targetText = "";
      flags = ["milestone"];
    }
    for (const flag of flags) {
      if (flag !== "milestone" && flag !== "manual") throw new Error(`${source}: unknown Where flag ${JSON.stringify(flag)} in ${JSON.stringify(where)}`);
    }
    const targets: Target[] = [];
    for (const token of targetText.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t !== "")) {
      if (token === "local") targets.push("local");
      else if (token === "cloud") targets.push(...cloudsFor(source));
      else throw new Error(`${source}: unknown target ${JSON.stringify(token)} in the Where text ${JSON.stringify(where)}`);
    }
    const effective = targets.length > 0 ? targets : firstTargets;
    if (effective.length === 0) throw new Error(`${source}: the Where text ${JSON.stringify(where)} names no target`);
    if (index === 0) firstTargets = effective;
    const milestone = flags.includes("milestone");
    for (const target of effective) {
      const entry = (result[target] ??= { automated: false, milestone: [] });
      if (milestone) entry.milestone.push(label);
      else entry.automated = true;
    }
  });
  return result;
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(path));
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

/** Every criterion and scenario defined under `docsDir`, sorted by ID. */
export function readCatalogue(docsDir: string): CatalogueEntry[] {
  const found = new Map<string, CatalogueEntry>();
  const add = (id: string, where: string, source: string): void => {
    const earlier = found.get(id);
    if (earlier !== undefined) throw new Error(`${id} is defined twice: in ${earlier.source} and ${source}`);
    found.set(id, { id, where, source, applies: parseWhere(where, source) });
  };
  for (const file of markdownFiles(docsDir)) {
    const source = relative(docsDir, file).split("\\").join("/");
    const lines = readFileSync(file, "utf8").split("\n");
    let scenario: string | undefined;
    for (const line of lines) {
      const row = ROW.exec(line);
      if (row?.[1] !== undefined && row[2] !== undefined) add(row[1], row[2], source);
      const header = SCENARIO.exec(line);
      if (header?.[1] !== undefined) {
        scenario = header[1];
        continue;
      }
      const where = WHERE_LINE.exec(line);
      if (scenario !== undefined && where?.[1] !== undefined) {
        add(scenario, where[1], source);
        scenario = undefined;
      }
    }
  }
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
