/**
 * Evidence writer (COMPL-REQ-003), shared by the compliance driver and `smoke`.
 * Writes `validation/<target>/<runId>.json` and the raw output it is based on under
 * `validation/<target>/<runId>/raw/`. It refuses, writing nothing, when the record does not
 * validate against the evidence schema, or when the working tree differs from the recorded
 * commit (another HEAD, or a modified or staged tracked file). Untracked files are not
 * differences: they include the run's own output.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { validateEvidence } from "./schema.js";

export type EvidenceTarget = "local" | "cloudflare" | "aws";
export type ResultStatus = "passed" | "failed" | "blocked" | "not-run";

export interface EvidenceResult {
  readonly id: string;
  readonly status: ResultStatus;
  readonly detail?: string;
}

export interface EvidenceRecord {
  readonly runId: string;
  readonly commit: string;
  readonly target: EvidenceTarget;
  readonly stage?: string;
  readonly command: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly exitStatus: number;
  readonly results: readonly EvidenceResult[];
  readonly versions: Readonly<Record<string, string>>;
  readonly leftovers?: readonly string[];
}

/** What the writer needs to know about the working tree. */
export interface GitState {
  /** The commit HEAD points at. */
  commit(): string;
  /** Tracked files that differ from HEAD (modified, staged, deleted). */
  changedTrackedFiles(): string[];
}

export class DirtyTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirtyTreeError";
  }
}

export function gitState(repoDir: string): GitState {
  const run = (args: string[]): string => execFileSync("git", args, { cwd: repoDir, encoding: "utf8" });
  return {
    commit: () => run(["rev-parse", "HEAD"]).trim(),
    changedTrackedFiles: () =>
      run(["status", "--porcelain=v1", "--untracked-files=no"])
        .split("\n")
        .filter((line) => line.length > 3)
        .map((line) => line.slice(3)),
  };
}

/** Throws DirtyTreeError unless the tree is at `commit` with no changed tracked file. */
export function assertCleanTree(git: GitState, commit: string): void {
  const head = git.commit();
  if (head !== commit) throw new DirtyTreeError(`refusing to record evidence: the working tree is at ${head}, not at the recorded commit ${commit}`);
  const changed = git.changedTrackedFiles();
  if (changed.length > 0) {
    throw new DirtyTreeError(`refusing to record evidence: the working tree differs from commit ${commit} in tracked files: ${changed.join(", ")}`);
  }
}

export interface Redaction {
  readonly value: string;
  readonly replacement: string;
}

export function redact(text: string, redactions: readonly Redaction[]): string {
  let out = text;
  for (const { value, replacement } of redactions) {
    if (value !== "") out = out.split(value).join(replacement);
  }
  return out;
}

export interface WriteEvidenceInput {
  /** Repository root; records go under `<root>/validation/`. */
  readonly root: string;
  readonly git: GitState;
  readonly record: EvidenceRecord;
  /** Raw output files by relative name. */
  readonly raw?: Readonly<Record<string, string>>;
  /** Values never written (personal or secret), with their replacement. */
  readonly redactions?: readonly Redaction[];
}

export interface EvidencePaths {
  readonly recordPath: string;
  readonly rawDir: string;
}

export function writeEvidence(input: WriteEvidenceInput): EvidencePaths {
  const redactions = input.redactions ?? [];
  const text = redact(`${JSON.stringify(input.record, null, 2)}\n`, redactions);
  const errors = validateEvidence(JSON.parse(text));
  if (errors.length > 0) throw new Error(`evidence record does not match evidence.schema.json:\n${errors.join("\n")}`);
  assertCleanTree(input.git, input.record.commit);

  const dir = join(input.root, "validation", input.record.target);
  const recordPath = join(dir, `${input.record.runId}.json`);
  const rawDir = join(dir, input.record.runId, "raw");
  if (existsSync(recordPath)) throw new Error(`evidence record ${recordPath} already exists`);
  const raw = Object.entries(input.raw ?? {});
  for (const [name] of raw) {
    const clean = normalize(name);
    if (name === "" || isAbsolute(name) || clean.startsWith(`..${sep}`) || clean === "..") throw new Error(`raw output name ${JSON.stringify(name)} must stay inside the raw directory`);
  }

  mkdirSync(rawDir, { recursive: true });
  for (const [name, content] of raw) {
    const path = join(rawDir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, redact(content, redactions));
  }
  writeFileSync(recordPath, text);
  return { recordPath, rawDir };
}
