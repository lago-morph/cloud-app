/**
 * COMPL-AC-003 (Where: Local, cloud): "Evidence records validate against the schema. A run with
 * a deliberately omitted criterion records it as `not-run` with a reason. A deliberately failing
 * HTTP check records the status, code, and requestId in `detail`. A run started from a working
 * tree with a modified tracked file records no evidence."
 *
 * Each clause is checked on a real run of the one command, `npm run compliance -- …`, in a
 * throwaway clone of this commit (so the enclosing run's working tree is never changed). Runs
 * that must execute a test use the driver's self-test path (`--self-test`: the harness's own
 * self-test suite only, never the real suites), into which a test commits the deliberate case
 * first. Assumptions: DEC-0321…DEC-0322 (docs/decisions/decision-log.md, Item: C-T5).
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { NESTED_RUN_MS, cloneAtHead, contractViolations, runCompliance, whereSets, type Clone } from "./support.js";

const SELF_TEST_DIR = "tests/compliance/harness/self-test";
const ID = "COMPL-AC-003";

describe("evidence records of a run", () => {
  const clones: Clone[] = [];
  const fresh = (): Clone => {
    const clone = cloneAtHead();
    clones.push(clone);
    return clone;
  };
  afterEach(() => {
    for (const clone of clones.splice(0)) clone.remove();
  });

  it(
    tag(ID, "a run's evidence record validates against the evidence schema"),
    () => {
      const clone = fresh();
      const run = runCompliance(clone.dir, ["--self-test"]);
      expect(run.recordFiles, run.output.slice(-3000)).toHaveLength(1);
      const record = run.record();
      expect(contractViolations(record)).toEqual([]);
      expect(record.commit).toBe(clone.git("rev-parse", "HEAD").trim());
      expect(record.results.map((r) => r.id)).toContain(ID);
      // A run that executes nothing (every criterion blocked by the operator) writes a valid record too.
      const listOnly = runCompliance(clone.dir, ["--target", "local", "--blocked", "*=schema check"]);
      expect(listOnly.status, listOnly.output.slice(-3000)).toBe(0);
      expect(contractViolations(listOnly.record())).toEqual([]);
    },
    2 * NESTED_RUN_MS,
  );

  it(
    tag(ID, "a criterion whose test is deliberately omitted from the run is recorded not-run with a reason"),
    () => {
      const clone = fresh();
      // Omit the criterion's only test from the suite the run executes.
      rmSync(join(clone.dir, SELF_TEST_DIR, "sample.selftest.ts"));
      clone.commit("omit the self-test's tagged test", SELF_TEST_DIR);
      const run = runCompliance(clone.dir, ["--self-test"]);
      const record = run.record();
      expect(contractViolations(record)).toEqual([]);
      const mine = record.results.filter((r) => r.id === ID);
      expect(mine.length, JSON.stringify(record.results)).toBeGreaterThan(0);
      for (const r of mine) {
        expect(r.status).toBe("not-run");
        expect((r.detail ?? "").trim(), "a not-run result states its reason").not.toBe("");
      }
    },
    NESTED_RUN_MS,
  );

  it(
    tag(ID, "criteria deliberately left out of a run with --only are each recorded not-run with a reason, never passed"),
    () => {
      const clone = fresh();
      const kept = "E2E-004";
      const run = runCompliance(clone.dir, ["--target", "local", "--only", kept, "--blocked", `${kept}=kept out of this check`]);
      expect(run.status, run.output.slice(-3000)).toBe(0);
      const record = run.record();
      expect(contractViolations(record)).toEqual([]);
      const omitted = [...whereSets().automated.local].filter((id) => id !== kept);
      expect(omitted.length).toBeGreaterThan(50);
      for (const id of omitted) {
        const results = record.results.filter((r) => r.id === id);
        expect(results.length, `${id} has a result`).toBeGreaterThan(0);
        for (const r of results) {
          expect(r.status, id).toBe("not-run");
          expect((r.detail ?? "").trim(), `${id}: reason`).not.toBe("");
        }
      }
    },
    NESTED_RUN_MS,
  );

  it(
    tag(ID, "a deliberately failing HTTP check records the observed status, error code and requestId in detail"),
    () => {
      const clone = fresh();
      const code = `TEST.DELIBERATE_${randomBytes(4).toString("hex").toUpperCase()}`;
      const requestId = `req${randomBytes(8).toString("hex")}`;
      const status = 503;
      // A self-test case whose HTTP check fails against a server answering with an ErrorResponse.
      writeFileSync(
        join(clone.dir, SELF_TEST_DIR, "http-failure.selftest.ts"),
        `import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { it } from "vitest";
import { tag } from "../../../support/tags.js";
import { createClient } from "../http.js";

it(tag("${ID}", "deliberately failing HTTP check"), async () => {
  const server = createServer((_req, res) => {
    res.writeHead(${String(status)}, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "${code}", message: "deliberate failure", requestId: "${requestId}" } }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const client = createClient({ baseUrl: \`http://127.0.0.1:\${String((server.address() as AddressInfo).port)}\` });
    client.expectStatus(await client.get("/api/deliberate"), 200);
  } finally {
    server.close();
  }
});
`,
      );
      clone.commit("add a deliberately failing HTTP check", SELF_TEST_DIR);
      const run = runCompliance(clone.dir, ["--self-test"]);
      const record = run.record();
      expect(contractViolations(record)).toEqual([]);
      const failed = record.results.filter((r) => r.id === ID && r.status === "failed");
      expect(failed, `${JSON.stringify(record.results)}\n${run.output.slice(-3000)}`).toHaveLength(1);
      const detail = failed[0]?.detail ?? "";
      expect(detail).toContain(String(status));
      expect(detail).toContain(code);
      expect(detail).toContain(requestId);
      expect(record.exitStatus).not.toBe(0);
    },
    NESTED_RUN_MS,
  );

  it(
    tag(ID, "a run started from a working tree with a modified tracked file records no evidence"),
    () => {
      const clone = fresh();
      appendFileSync(join(clone.dir, "docs", "README.md"), "\nmodified by the COMPL-AC-003 check\n");
      expect(clone.git("status", "--porcelain", "--untracked-files=no").trim()).not.toBe("");
      const dirty = runCompliance(clone.dir, ["--self-test"]);
      expect(dirty.status, dirty.output.slice(-3000)).not.toBe(0);
      expect(dirty.writtenFiles, "nothing written under the evidence directory").toEqual([]);
      const dirtyList = runCompliance(clone.dir, ["--target", "local", "--blocked", "*=dirty-tree check"]);
      expect(dirtyList.status).not.toBe(0);
      expect(dirtyList.writtenFiles).toEqual([]);
      // Control: the same clone with the change reverted records evidence.
      clone.git("checkout", "--", "docs/README.md");
      const clean = runCompliance(clone.dir, ["--self-test"]);
      expect(clean.recordFiles, clean.output.slice(-3000)).toHaveLength(1);
    },
    3 * NESTED_RUN_MS,
  );
});
