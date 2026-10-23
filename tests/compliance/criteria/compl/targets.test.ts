/**
 * COMPL-AC-001 (Where: Local, cloud): "One command runs the suite against each target, and the
 * per-target lists of executed criteria and scenarios match the criteria's "Where" columns and
 * the scenarios' "Where" lines. Milestone items are compared only in milestone runs."
 *
 * The real command, `npm run compliance -- --target <t> [--milestone]`, is run for every target
 * and both tiers in a clone of this commit. Each nested run is started with
 * `--blocked '*=<reason>'`, so it lists every criterion and scenario it would execute on that
 * target (each recorded `blocked` with the operator's reason) without starting `dev`, deploying,
 * or running a test: no cloud call, and no recursion into this suite. That the same list is what
 * a full run executes is what the enclosing run's own record and E2E-004 show. Assumptions:
 * DEC-0321…DEC-0322 (docs/decisions/decision-log.md, Item: C-T5).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { NESTED_RUN_MS, TARGETS, cloneAtHead, contractViolations, milestoneItemsNamed, runCompliance, whereSets, type Clone, type Target } from "./support.js";

const REASON = "COMPL-AC-001 list check: nothing executed";

describe("compliance runs per target", () => {
  let clone: Clone;
  const where = whereSets();
  beforeAll(() => {
    clone = cloneAtHead();
  });
  afterAll(() => clone.remove());

  for (const tier of ["automated", "milestone"] as const) {
    it(
      tag("COMPL-AC-001", `one command lists, for each target, exactly the ${tier} criteria and scenarios the Where columns and lines name`),
      () => {
        const head = clone.git("rev-parse", "HEAD").trim();
        const lists = new Map<Target, Set<string>>();
        for (const target of TARGETS) {
          const args = ["--target", target, ...(tier === "milestone" ? ["--milestone"] : []), "--blocked", `*=${REASON}`];
          const run = runCompliance(clone.dir, args);
          expect(run.status, `npm run compliance -- ${args.join(" ")}\n${run.output.slice(-3000)}`).toBe(0);
          const record = run.record();
          expect(contractViolations(record)).toEqual([]);
          expect(record.target).toBe(target);
          expect(record.commit).toBe(head);
          // The one command, as the record names it.
          expect(record.command.startsWith(`npm run compliance -- ${args.join(" ")} --out `), record.command).toBe(true);
          // Nothing deployed: no stage, nothing left over.
          expect(record.stage).toBeUndefined();
          if (target !== "local") expect(record.leftovers).toEqual([]);
          // Every result is the operator's block or a recorded not-run reason; nothing was executed.
          for (const r of record.results) {
            expect(["blocked", "not-run"], `${r.id} on ${target}`).toContain(r.status);
            expect(r.detail ?? "", `${r.id} on ${target}`).not.toBe("");
          }
          const listed = new Set(record.results.map((r) => r.id));
          const wanted = where[tier][target];
          expect([...listed].filter((id) => !wanted.has(id)).sort(), `${target} ${tier}: listed but not in its Where`).toEqual([]);
          expect([...wanted].filter((id) => !listed.has(id)).sort(), `${target} ${tier}: in its Where but not listed`).toEqual([]);
          lists.set(target, listed);
        }
        // The lists differ by target exactly as the Where texts do (no per-target expectations of the suite's own).
        expect(lists.get("local")?.size ?? 0).toBeGreaterThan(0);
        if (tier === "automated") {
          expect(lists.get("cloudflare")?.size ?? 0).toBeGreaterThan(0);
          // Milestone items are compared only in milestone runs: an item that is a milestone item
          // everywhere (no automated part) appears in no automated run.
          const everyAutomated = new Set(TARGETS.flatMap((t) => [...(lists.get(t) ?? [])]));
          const milestoneOnly = [...milestoneItemsNamed()].filter((id) => TARGETS.every((t) => !where.automated[t].has(id)));
          expect(milestoneOnly.length).toBeGreaterThan(0);
          expect(milestoneOnly.filter((id) => everyAutomated.has(id))).toEqual([]);
        } else {
          // A milestone run lists milestone items only, and together they are COMPL-REQ-006's list.
          const named = milestoneItemsNamed();
          const union = new Set(TARGETS.flatMap((t) => [...(lists.get(t) ?? [])]));
          expect([...union].sort()).toEqual([...named].sort());
        }
      },
      TARGETS.length * NESTED_RUN_MS,
    );
  }
});
