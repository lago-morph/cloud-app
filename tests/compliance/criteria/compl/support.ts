/**
 * Support for the COMPL run-level criteria (C-T5; assumptions: DEC-0321…DEC-0322 in docs/decisions/decision-log.md).
 * Written from compliance.md (COMPL-REQ-001, COMPL-REQ-003, COMPL-REQ-006, COMPL-AC-001,
 * COMPL-AC-003, "Driver"), the evidence contract and the Where columns and lines, not from the
 * driver's implementation: nothing here imports the harness's catalogue, expected-ID or result
 * code, so the tests compare the real command's records with an independent reading of the docs.
 *
 * - `cloneAtHead` makes a throwaway clone of this commit (sharing the object store and the
 *   installed node_modules), so a test can commit into it or modify a tracked file without
 *   touching the working tree the enclosing compliance run records evidence from.
 * - `runCompliance` runs the one command, `npm run compliance -- …`, in that clone, with no
 *   cloud credentials and a dead proxy, so a nested run can make no cloud call.
 * - `whereSets` reads which IDs apply on which target and tier from the documents.
 * - `contractViolations` checks a record against docs/contracts/schemas/evidence.schema.json.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** tests/compliance/criteria/compl → repository root. */
export const REPO_ROOT = resolve(here, "../../../..");
export const DOCS = join(REPO_ROOT, "docs");

/** Every target the documents' Where texts name. */
export type Target = "local" | "cloudflare" | "aws";
export const TARGETS: readonly Target[] = ["local", "cloudflare", "aws"];
/** The targets release 1 runs (DEC-0508): `npm run compliance` refuses `--target aws`, deferred to a later release. */
export const RELEASE_TARGETS: readonly Target[] = ["local", "cloudflare"];

/** Bound for one nested `npm run compliance` (bundling the CLI, and in a self-test one Vitest run). */
export const NESTED_RUN_MS = 240_000;

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export interface Clone {
  readonly dir: string;
  git(...args: string[]): string;
  /** Commits the given paths (added, changed or removed) in the clone. */
  commit(message: string, ...paths: string[]): void;
  remove(): void;
}

/** A clone of this repository's HEAD in a temporary directory, with the installed dependencies linked in. */
export function cloneAtHead(): Clone {
  const base = mkdtempSync(join(tmpdir(), "compl-run-"));
  const dir = join(base, "repo");
  const head = git(REPO_ROOT, ["rev-parse", "HEAD"]).trim();
  git(base, ["clone", "--quiet", "--shared", "--no-checkout", REPO_ROOT, dir]);
  git(dir, ["checkout", "--quiet", "--detach", head]);
  // Dependencies are not tracked; link the installed ones (never a tracked change in the clone).
  appendFileSync(join(dir, ".git", "info", "exclude"), "\nnode_modules\n");
  for (const workspace of ["", "packages/framework", "apps/template", "apps/reference", "apps/demo", "tests/compliance"]) {
    const source = join(REPO_ROOT, workspace, "node_modules");
    if (existsSync(source) && existsSync(join(dir, workspace))) symlinkSync(source, join(dir, workspace, "node_modules"), "dir");
  }
  const id = ["-c", "user.name=compliance-test", "-c", "user.email=compliance-test@example.invalid"];
  return {
    dir,
    git: (...args) => git(dir, args),
    commit: (message, ...paths) => {
      git(dir, ["add", "-A", "--", ...paths]);
      git(dir, [...id, "commit", "--quiet", "--no-verify", "-m", message]);
    },
    remove: () => rmSync(base, { recursive: true, force: true }),
  };
}

export interface NestedRun {
  readonly status: number;
  readonly output: string;
  /** Every record file the run wrote under `<out>/validation/`, relative to `out`. */
  readonly recordFiles: readonly string[];
  /** Every file the run wrote under `out`, relative to `out`. */
  readonly writtenFiles: readonly string[];
  /** The one record the run wrote (throws unless there is exactly one). */
  record(): EvidenceRecordShape;
}

export interface EvidenceRecordShape {
  readonly runId: string;
  readonly commit: string;
  readonly target: string;
  readonly stage?: string;
  readonly command: string;
  readonly exitStatus: number;
  readonly results: readonly { readonly id: string; readonly status: string; readonly detail?: string }[];
  readonly leftovers?: readonly string[];
  readonly [key: string]: unknown;
}

function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(root);
  return out.sort();
}

/** An environment with no cloud credentials, no compliance variables of the enclosing run, and a proxy that answers nothing. */
function isolatedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^(COMPLIANCE_|CLOUDFLARE_|AWS_|NODE_USE_ENV_PROXY$|VITEST|npm_)/i.test(key)) continue;
    if (/^(https?|all)_proxy$/i.test(key)) continue;
    env[key] = value;
  }
  const dead = "http://127.0.0.1:9";
  return { ...env, HTTPS_PROXY: dead, HTTP_PROXY: dead, https_proxy: dead, http_proxy: dead, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" };
}

/** Runs `npm run compliance -- <args> --out <fresh dir>` in `cwd`. */
export function runCompliance(cwd: string, args: readonly string[]): NestedRun {
  const out = mkdtempSync(join(tmpdir(), "compl-out-"));
  const result = spawnSync("npm", ["run", "--silent", "compliance", "--", ...args, "--out", out], { cwd, env: isolatedEnv(), encoding: "utf8", timeout: NESTED_RUN_MS, maxBuffer: 64 * 1024 * 1024 });
  const writtenFiles = filesUnder(out);
  const recordFiles = writtenFiles.filter((f) => /^validation\/[^/]+\/[^/]+\.json$/.test(f));
  return {
    status: result.status ?? -1,
    output: `${result.stdout}${result.stderr}${result.error === undefined ? "" : `\n${result.error.message}`}`,
    recordFiles,
    writtenFiles,
    record: () => {
      if (recordFiles.length !== 1) throw new Error(`expected exactly one evidence record, found ${String(recordFiles.length)}: ${recordFiles.join(", ")}`);
      return JSON.parse(readFileSync(join(out, recordFiles[0] ?? ""), "utf8")) as EvidenceRecordShape;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The Where columns and lines (component criteria tables, `| ID | Criterion | Verifies | Where |`;
// e2e-scenarios.md "Where:" lines).

export interface WhereSets {
  /** IDs run on every commit on each target (the automated tier). */
  readonly automated: Readonly<Record<Target, ReadonlySet<string>>>;
  /** IDs with a milestone part on each target. */
  readonly milestone: Readonly<Record<Target, ReadonlySet<string>>>;
}

function markdown(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? markdown(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : []));
}

/**
 * "Local", "Cloud", "Local, cloud", "<targets> (milestone)", "(manual, milestone)", and
 * segments after ";" ("cloud (milestone)", "review: milestone", "admin-list part: cloud (milestone)"),
 * where a segment that names no target means the first segment's targets. "cloud" means both
 * clouds, except in cloudflare.md / aws.md, whose criteria concern that cloud only.
 */
function readWhere(where: string, file: string): { target: Target; milestone: boolean }[] {
  const clouds: Target[] = file.endsWith("cloudflare.md") ? ["cloudflare"] : file.endsWith("aws.md") ? ["aws"] : ["cloudflare", "aws"];
  const out: { target: Target; milestone: boolean }[] = [];
  let first: Target[] = [];
  where.split(";").forEach((segment, index) => {
    const body = segment.includes(":") ? segment.slice(segment.indexOf(":") + 1) : segment;
    const milestone = /milestone/i.test(body);
    const names = body.replace(/\([^)]*\)/g, "").replace(/milestone/i, "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
    const targets = names.flatMap((n): Target[] => {
      if (n === "local") return ["local"];
      if (n === "cloud") return clouds;
      throw new Error(`${file}: unexpected target ${JSON.stringify(n)} in Where ${JSON.stringify(where)}`);
    });
    const effective = targets.length > 0 ? targets : first;
    if (index === 0) first = effective;
    for (const target of effective) out.push({ target, milestone });
  });
  return out;
}

export function whereSets(docsDir: string = DOCS): WhereSets {
  const sets = (): Record<Target, Set<string>> => ({ local: new Set(), cloudflare: new Set(), aws: new Set() });
  const automated = sets();
  const milestone = sets();
  const add = (id: string, where: string, file: string): void => {
    for (const { target, milestone: m } of readWhere(where, file)) (m ? milestone : automated)[target].add(id);
  };
  // A criterion is a body row of a criteria table: header `| ID | Criterion | Verifies | Where |`,
  // a `| --- |` separator next, ending at the first line not starting with `|`. Its ID and Where
  // text come from those columns. Other tables are ignored; a malformed row inside a criteria
  // table, or an `ID | Criterion` header of another shape, throws (no criterion is dropped
  // silently). Root cause 2026-10-20-COMPL-AC-001-where-parser-decision-log, Review.
  const columns = ["ID", "Criterion", "Verifies", "Where"];
  const row = (line: string): string[] => line.trim().slice(1).replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
  for (const file of markdown(docsDir)) {
    let scenario: string | undefined;
    let table: string[] | undefined;
    const lines = readFileSync(file, "utf8").split("\n");
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n] ?? "";
      const at = `${file}:${String(n + 1)}`;
      if (!line.startsWith("|")) table = undefined;
      else if (table !== undefined) {
        const cells = row(line);
        const id = cells[table.indexOf("ID")] ?? "";
        if (cells.length !== table.length || !/^[A-Z]+-AC-\d{3}$/.test(id)) throw new Error(`${at}: malformed criteria row ${JSON.stringify(line)}`);
        add(id, cells[table.indexOf("Where")] ?? "", file);
        continue;
      } else {
        const cells = row(line);
        if (cells[0] === "ID" && cells[1] === "Criterion") {
          const separator = (lines[n + 1] ?? "").startsWith("|") ? row(lines[n + 1] ?? "") : [];
          if (cells.join() !== columns.join() || separator.length !== columns.length || separator.some((c) => !/^:?-{3,}:?$/.test(c))) {
            throw new Error(`${at}: a criteria table needs the header | ${columns.join(" | ")} | and a | --- | separator row`);
          }
          table = cells;
          n++;
          continue;
        }
      }
      const header = /^####\s+(E2E-\d{3})\b/.exec(line);
      if (header?.[1] !== undefined) scenario = header[1];
      const whereLine = /^Where:\s*(.+?)\s*$/.exec(line);
      if (scenario !== undefined && whereLine?.[1] !== undefined) {
        add(scenario, whereLine[1], file);
        scenario = undefined;
      }
    }
  }
  return { automated, milestone };
}

/** The milestone items COMPL-REQ-006 names ("The milestone items are …"). */
export function milestoneItemsNamed(docsDir: string = DOCS): Set<string> {
  const text = readFileSync(join(docsDir, "components", "compliance.md"), "utf8");
  const sentence = /The milestone items are ([^\n]*?)\. A milestone item/.exec(text)?.[1];
  if (sentence === undefined) throw new Error("compliance.md: COMPL-REQ-006's list of milestone items not found");
  return new Set(Array.from(sentence.matchAll(/\b(?:[A-Z]+-AC|E2E)-\d{3}\b/g), (m) => m[0]));
}

// ---------------------------------------------------------------------------------------------
// The evidence contract, checked directly (the subset of JSON Schema the contract uses).

type Schema = Readonly<Record<string, unknown>>;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function violations(schema: Schema, value: unknown, at: string, out: string[]): void {
  const type = schema.type;
  if (type === "object" && !isObject(value)) return void out.push(`${at}: not an object`);
  if (type === "array" && !Array.isArray(value)) return void out.push(`${at}: not an array`);
  if (type === "string" && typeof value !== "string") return void out.push(`${at}: not a string`);
  if (type === "integer" && !Number.isInteger(value)) return void out.push(`${at}: not an integer`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) out.push(`${at}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
  if (schema.format === "date-time" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value))) out.push(`${at}: not a date-time`);
  if (isObject(value)) {
    const props = isObject(schema.properties) ? schema.properties : {};
    for (const name of Array.isArray(schema.required) ? (schema.required as string[]) : []) if (!(name in value)) out.push(`${at}: missing ${name}`);
    for (const [name, child] of Object.entries(value)) {
      const sub = props[name];
      if (isObject(sub)) violations(sub, child, `${at}/${name}`, out);
      else if (schema.additionalProperties === false) out.push(`${at}: unknown property ${name}`);
      else if (isObject(schema.additionalProperties)) violations(schema.additionalProperties, child, `${at}/${name}`, out);
    }
    if (isObject(schema.if) && isObject(schema.then)) {
      const probe: string[] = [];
      violations(schema.if, value, at, probe);
      if (probe.length === 0) violations(schema.then, value, at, out);
    }
  }
  if (Array.isArray(value) && isObject(schema.items)) value.forEach((item, i) => violations(schema.items as Schema, item, `${at}/${String(i)}`, out));
}

/** Violations of docs/contracts/schemas/evidence.schema.json by `record`; empty when it conforms. */
export function contractViolations(record: unknown): string[] {
  const schema = JSON.parse(readFileSync(join(DOCS, "contracts", "schemas", "evidence.schema.json"), "utf8")) as Schema;
  const out: string[] = [];
  violations(schema, record, "", out);
  return out;
}
