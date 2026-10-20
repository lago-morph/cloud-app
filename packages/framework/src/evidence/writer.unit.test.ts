import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EvidenceRecord } from "./writer.js";
import { DirtyTreeError, gitState, redact, writeEvidence } from "./writer.js";
import { validateEvidence } from "./schema.js";

let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { cwd: repo, encoding: "utf8" }).trim();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "evidence-"));
  git("init", "-q");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function record(commit: string, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    runId: "r1",
    commit,
    target: "local",
    command: "npm run compliance -- --target local",
    startedAt: "2026-10-20T10:00:00.000Z",
    finishedAt: "2026-10-20T10:01:00.000Z",
    exitStatus: 0,
    results: [{ id: "COMPL-AC-003", status: "passed" }],
    versions: { node: "22.22.0" },
    ...overrides,
  };
}

describe("[COMPL-AC-003] evidence writer", () => {
  it("reads the commit and reports a clean tree", () => {
    const state = gitState(repo);
    expect(state.commit()).toBe(git("rev-parse", "HEAD"));
    expect(state.changedTrackedFiles()).toEqual([]);
  });

  it("writes validation/<target>/<runId>.json and the raw output under <runId>/raw/", () => {
    const state = gitState(repo);
    const paths = writeEvidence({ root: repo, git: state, record: record(state.commit()), raw: { "vitest.json": "{}", "logs/dev.log": "line\n" } });
    expect(paths.recordPath).toBe(join(repo, "validation", "local", "r1.json"));
    const written: unknown = JSON.parse(readFileSync(paths.recordPath, "utf8"));
    expect(validateEvidence(written)).toEqual([]);
    expect(readFileSync(join(repo, "validation", "local", "r1", "raw", "logs", "dev.log"), "utf8")).toBe("line\n");
  });

  it("records no evidence from a working tree with a modified tracked file", () => {
    const state = gitState(repo);
    const commit = state.commit();
    writeFileSync(join(repo, "a.txt"), "changed\n");
    expect(state.changedTrackedFiles()).toEqual(["a.txt"]);
    expect(() => writeEvidence({ root: repo, git: state, record: record(commit), raw: { "x.txt": "x" } })).toThrow(DirtyTreeError);
    expect(() => writeEvidence({ root: repo, git: state, record: record(commit) })).toThrow(/a\.txt/);
    expect(existsSync(join(repo, "validation"))).toBe(false);
  });

  it("records no evidence when the tree is at a different commit than the record names", () => {
    const state = gitState(repo);
    const first = state.commit();
    writeFileSync(join(repo, "b.txt"), "b\n");
    git("add", "b.txt");
    git("commit", "-q", "-m", "second");
    expect(() => writeEvidence({ root: repo, git: state, record: record(first) })).toThrow(DirtyTreeError);
    expect(existsSync(join(repo, "validation"))).toBe(false);
  });

  it("does not count untracked files (its own output) as a modification", () => {
    const state = gitState(repo);
    writeFileSync(join(repo, "untracked.log"), "x");
    expect(state.changedTrackedFiles()).toEqual([]);
  });

  it("refuses a record that does not validate against the schema, naming the violation", () => {
    const state = gitState(repo);
    const bad = record(state.commit(), { results: [{ id: "KV-AC-001", status: "not-run" }] });
    expect(() => writeEvidence({ root: repo, git: state, record: bad })).toThrow(/\/results\/0: missing required property detail/);
    expect(existsSync(join(repo, "validation"))).toBe(false);
  });

  it("refuses to overwrite an existing record and refuses raw names leaving the raw directory", () => {
    const state = gitState(repo);
    writeEvidence({ root: repo, git: state, record: record(state.commit()) });
    expect(() => writeEvidence({ root: repo, git: state, record: record(state.commit()) })).toThrow(/already exists/);
    expect(() => writeEvidence({ root: repo, git: state, record: record(state.commit(), { runId: "r2" }), raw: { "../x": "x" } })).toThrow(/raw output name/);
  });

  it("applies redactions to the record and the raw output", () => {
    const state = gitState(repo);
    const r = record(state.commit(), { results: [{ id: "HTTP-AC-001", status: "failed", detail: "GET https://w.owner-sub.workers.dev/api → 500" }] });
    const paths = writeEvidence({ root: repo, git: state, record: r, raw: { "out.txt": "owner-sub here" }, redactions: [{ value: "owner-sub", replacement: "<account-subdomain>" }] });
    expect(readFileSync(paths.recordPath, "utf8")).not.toContain("owner-sub");
    expect(readFileSync(join(paths.rawDir, "out.txt"), "utf8")).toBe("<account-subdomain> here");
  });
});

describe("redact", () => {
  it("replaces every occurrence and ignores empty values", () => {
    expect(redact("a s3cret b s3cret", [{ value: "s3cret", replacement: "<secret>" }, { value: "", replacement: "x" }])).toBe("a <secret> b <secret>");
  });
});
