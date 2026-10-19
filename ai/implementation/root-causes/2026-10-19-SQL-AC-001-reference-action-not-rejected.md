# Root cause: SQL-AC-001 "unsupported features are rejected" — a reference action passed to `ref()` is silently ignored

Author: diagnosing subagent (prompt §8 step 1; did not write the code or the tests). Diagnosis only; no code or test changed. Needs independent review (§8 step 2) before any fix.

## Symptom
Phase B run (`validation/local/phase-B/SUMMARY.md`, items 17 and 18; commit under test `b229c57`), integration Vitest, two failures with the same message:

- `packages/framework/test/integration/sql/sql.postgres.test.ts` › `SQL schema rules (PGlite)` › `[SQL-AC-001] unsupported features are rejected: SQL defaults, auto-increment, generated columns, composite keys, reference actions, non-portable column types (PGlite)`
- `packages/framework/test/integration/sql/sql.sqlite.test.ts` › same test `(local D1)`

```
AssertionError: reference action other than fail-while-referenced must be rejected: expected false to be true // Object.is equality
 ❯ expectSchemaRejected packages/framework/test/integration/sql/schema-rules.suite.ts:32:45
 ❯ packages/framework/test/integration/sql/schema-rules.suite.ts:106:7
```

This is the failure B-16 described as "a reference action is not rejected (B-05)": same assertion, same component.

## Evidence
1. **Reproduced** on branch `claude/implement-local-cloudflare-diag-b3` (= `origin/claude/implement-local-cloudflare`, `9c09143`), after `npm ci`:
   `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/sql/sql.postgres.test.ts packages/framework/test/integration/sql/sql.sqlite.test.ts -t "unsupported features"`
   → `Tests 2 failed | 90 skipped`, both with the message above (line 106 of `schema-rules.suite.ts`). B-RUN logs 04 and 05a show the same failure, so 3 of 3 runs fail.
2. **The test** (`schema-rules.suite.ts` lines 102–106) forces the option through with a cast, as untyped code could:
   ```ts
   const parent = defineTable("parents", { id: id() });
   // @ts-expect-error — `ref` takes only its target; delete actions are not supported.
   return { tables: { parent, child: defineTable("children", { id: id(), parentId: ref(() => parent.id, { onDelete: "cascade" }) }) } };
   ```
   and expects `defineTable` or `defineApp` to throw.
3. **The code** (`packages/framework/src/sql/columns.ts` lines 77–79):
   ```ts
   export function ref(target: () => Column<string, false>): ColumnBuilder<string> {
     return builder({ ...plain("ref"), target });
   }
   ```
   It never reads a second argument. Nothing in `src/sql/` reads `onDelete`/`onUpdate` from app input (`grep -rn onDelete packages/framework/src`: only unit-test assertions and the migration checker's introspection).
4. **Minimal reproduction**: script `ref-action.mts` (scratchpad `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/repro/ref-action.mts`), run with `npx tsx` from the repo root with `PROTOTYPE_FRAMEWORK_DIALECT=sqlite` and `=postgres`. Output (sqlite / postgres):
   ```
   dialect sqlite | ref.length 1
   defineTable(children, ref(target, {"onDelete":"cascade"})) -> no throw
     defineApp with it -> no throw
     foreign keys: [{"name":"children_parent_id_fk","onDelete":null,"onUpdate":null}]
   defineTable(children, ref(target, {"onDelete":"set null","onUpdate":"cascade"})) -> no throw
     defineApp with it -> no throw
     foreign keys: [{"name":"children_parent_id_fk","onDelete":null,"onUpdate":null}]
   defineTable(children, ref(target, "cascade")) -> no throw
     defineApp with it -> no throw
     foreign keys: [{"name":"children_parent_id_fk","onDelete":null,"onUpdate":null}]
   plain ref(target) foreign keys: [{"name":"children2_parent_id_fk","onDelete":null,"onUpdate":null}]
   control: {tables} path with primaryKey option -> threw: table "bad_rows": option "primaryKey" is not supported; only "indexes" and "uniques" are
   control: index over unknown key -> threw: table "notes": indexes entry names unknown column key "missing"

   dialect postgres | ref.length 1
   … identical "no throw" lines …
     foreign keys: [{"name":"children_parent_id_fk","onDelete":"no action","onUpdate":"no action"}]
   control lines identical (both threw)
   ```
   The foreign key of a `ref()` given `{ onDelete: "cascade" }` is identical to one from plain `ref(target)`: the action is dropped, nothing throws.
5. **Requirement and decisions**:
   - `docs/components/sql.md` SQL-REQ-001 (line 12): "… reference actions other than "fail while referenced" are not supported." SQL-AC-001: "schemas with each unsupported feature or invalid name … are rejected."
   - `docs/contracts/ts/sql.d.ts` line 67: `ref(target)` only; "Deleting a referenced row fails while references exist." There is no typed way to state an action.
   - DEC-0132 (B-05, accepted): a broken schema makes `defineTable` throw `CORE.MISCONFIGURED`; the reference action is Drizzle's default. It does not say what happens to extra arguments.
   - DEC-0221 (B-T2, accepted; owner review open): "Composite primary keys, reference actions and SQL-expression defaults cannot be expressed through `sql.d.ts`; the suite asserts this at the type level (`@ts-expect-error`) **and also forces each through with a cast and expects a run-time rejection**." Only custom collations are named as "covered only by the absence of an API (not testable at run time)"; reference actions are not.
   - The same code already rejects the analogous cast-through cases instead of ignoring them: `defineTable` rejects unknown table options (`primaryKey`; control line in evidence 4, unit test `table.unit.test.ts` "rejects table options other than indexes and uniques"), raw Drizzle columns, and SQL-expression defaults (these earlier assertions in the same test pass; the test stops at the first failing one, line 106).

## Cause → symptom chain
1. `ref()` accepts and discards any argument after the target (evidence 3; `ref.length 1`, evidence 4).
2. So `ref(() => parent.id, { onDelete: "cascade" })` returns the same builder as `ref(() => parent.id)`, and `defineTable` / `defineApp` see an ordinary reference and do not throw (evidence 4: "no throw" for three different action forms, FK action unchanged).
3. `expectSchemaRejected` records `threw = false` and asserts `threw === true` (evidence 2), giving "reference action other than fail-while-referenced must be rejected: expected false to be true" (evidence 1).
4. The code path is dialect-independent (`columns.ts` has no dialect branch), so it fails on both PGlite and local D1 (evidence 1, 4).

## Code or test?
The **code** is wrong (a gap in B-05), not the test:
- DEC-0221, the accepted reading of SQL-AC-001 for this suite, explicitly requires a run-time rejection of a forced-through reference action (evidence 5).
- The only channel by which an app could ask for a reference action is an extra argument to `ref()` (raw Drizzle columns and foreign keys are already rejected by `defineTable`). If that argument is ignored, the "reference actions" clause of SQL-AC-001 is unenforced at run time: untyped app code asking for `cascade` gets a schema that fails on delete, with no error at definition time. That contradicts "rejected" and the framework's own handling of every other cast-through case (unknown table options throw rather than being ignored).
- The test's construction (`{ tables: { parent, child } }` through `defineApp`) works: the control in evidence 4 shows the same path rejects a broken table.

## Alternatives ruled out
- **Test harness wrapper misroutes `{ tables }`**: ruled out; the control (`{ tables: { parent, bad } }` with a `primaryKey` option) throws through the same `defineApp` call (evidence 4).
- **An earlier assertion in the test fails**: ruled out; the stack points to line 106 (the reference-action call) and the message names it. The later "index over an unknown column key" assertion would pass (control in evidence 4).
- **Dialect-specific behaviour**: ruled out; same result on both dialects (evidence 1, 4); `ref()` has no dialect branch.
- **Flaky / timing**: ruled out; the code path is synchronous, has no I/O, and fails in 3 of 3 runs (B-RUN 04, 05a, this reproduction).
- **The unsupported action reaching the database** (i.e. the failure being about a wrong schema): ruled out; the FK action stays Drizzle's default (`null` on SQLite, `no action` on Postgres) (evidence 4). The defect is the silent drop, not a wrong DDL.
- **Type-level part broken**: ruled out; `npm run verify` (which runs `typecheck`) exited 0 in B-RUN 02, so the `@ts-expect-error` is satisfied.

## Proposed fix (owner: B-05, `packages/framework/src/sql/columns.ts`)
Make `ref()` reject any argument after its target, keeping the public signature from `sql.d.ts` unchanged:

```ts
export function ref(target: () => Column<string, false>): ColumnBuilder<string> {
  if (arguments.length > 1) {
    throw new FrameworkError(
      "CORE.MISCONFIGURED",
      "ref() takes only its target column; reference actions (onDelete/onUpdate) are not supported: deleting a referenced row fails while references exist",
    );
  }
  return builder({ ...plain("ref"), target });
}
```

`CORE.MISCONFIGURED` follows DEC-0132 (schema errors). The throw happens while the `defineTable` call's arguments are evaluated, i.e. at definition time, which DEC-0221 counts as "rejected". No contract, spec or test change. Optionally, a one-line addition to DEC-0132 recording that extra `ref()` arguments are rejected.

## How the fix will be verified (red-green, §8 step 3)
1. Red: add a unit test in `packages/framework/src/sql/columns.unit.test.ts`, tagged SQL-AC-001, e.g. "ref() rejects a reference action argument with CORE.MISCONFIGURED", calling `(ref as any)(() => parent.id, { onDelete: "cascade" })`; it must fail on the current code.
2. Green: apply the fix; the unit test passes; `npm run test:unit` stays green.
3. Rerun the two failing integration tests:
   `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/sql/sql.postgres.test.ts packages/framework/test/integration/sql/sql.sqlite.test.ts` — all tests pass, including both `[SQL-AC-001] unsupported features are rejected` tests.
4. `npm run verify` (typecheck: the `@ts-expect-error` in the suite must still be needed, since the contract is unchanged) exits 0.
5. Rerun the repro script: every "defineTable(children, ref(target, …))" line must report "threw: ref() takes only its target column…", plain `ref(target)` unchanged.

All local; no Cloudflare calls; no test data beyond the in-memory table definitions.

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2; did not diagnose this failure or write the code or the tests). No code or test changed.

**Verdict: ACCEPTED.**

### Reproduction (branch `claude/implement-local-cloudflare-rc-sql001-review`, base `476fcab`, after `npm ci`)
- `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/sql/sql.postgres.test.ts packages/framework/test/integration/sql/sql.sqlite.test.ts -t "unsupported features"` → `Tests 2 failed | 90 skipped`, both `AssertionError: reference action other than fail-while-referenced must be rejected: expected false to be true` at `schema-rules.suite.ts:106:7`. Matches the symptom exactly.
- The record's repro script (`PROTOTYPE_FRAMEWORK_DIALECT=sqlite npx tsx …/scratchpad/repro/ref-action.mts`) gives the recorded output: `ref.length 1`; all three action forms "no throw" in `defineTable` and `defineApp`; FK actions identical to plain `ref(target)`; both controls throw. (Note: the script imports from the diagnosing worktree `agent-aeb1b386be949a039`; the integration test rerun above independently confirms the result on this branch.)

### Links checked
1. `ref()` ignores extra arguments: confirmed by reading `packages/framework/src/sql/columns.ts:77-79` (the builder spec holds only `kind`, flags and `target`; no field could carry an action) and by `ref.length 1`. `grep -rn onDelete packages/framework/src` finds no app-input read.
2. Same builder → no throw: `table.ts` only inspects `spec.target` for refs (`resolveRef`, lines 319-325), so nothing downstream could detect the dropped argument. Confirmed by the repro's identical FK output.
3. `expectSchemaRejected` → assertion message: confirmed by reading the suite (lines 22-33, 106-110).
4. Dialect-independent: `columns.ts` has no dialect branch; both dialect tests fail identically.

### Alternatives
The ruled-out list is complete and each item is backed by evidence (controls through the same `{ tables }` / `defineApp` path, stack line, both dialects, synchronous code, introspected FK actions, typecheck passing). I found no further plausible cause: `grep` finds no framework or app code calling `ref` with a second argument, and no `.map(ref)`-style call that would pass one implicitly.

### Code or test
Agree the code is wrong. SQL-REQ-001 says reference actions other than "fail while referenced" are not supported; SQL-AC-001 says such schemas are rejected; DEC-0221 (accepted) explicitly says reference actions are forced through with a cast and must be rejected at run time, and lists only collations as untestable. The test follows DEC-0221 literally and is not weakened or wrong.

### Fix: cause, not symptom; consistency with requirement and contract
- **Addresses the cause** (the silent drop in `ref()`), not the test: any untyped caller asking for an action now fails at definition time instead of getting a different-from-intended schema.
- **Is rejecting *any* extra argument the right rule?** Yes. `docs/contracts/ts/sql.d.ts:67` declares `ref(target: () => Column<string, false>)` with no second parameter, and sql.md §2.1 (line 55) lists only `ref(() => t.id)`. Neither the requirement nor the contract offers any way to state an action, not even the supported one: "fail while referenced" is the fixed, implicit behaviour (DEC-0132: Drizzle's default). So there is no permitted second argument to distinguish; accepting e.g. `{ onDelete: "restrict" }` would add surface the contract does not have. Throwing on `arguments.length > 1` (including an explicit `undefined`) matches the contract exactly and mirrors how `defineTable` rejects unknown table options instead of filtering them.
- **Error code / timing**: `CORE.MISCONFIGURED` matches DEC-0132 and sql.md §2.2 "Schema checks"; the throw happens while the `defineTable` arguments are evaluated, which DEC-0221 counts as "rejected".
- **Minor, non-blocking**: §2.2 says the schema-check error names "the table and the broken rule"; a throw inside `ref()` cannot name the table or key. This has an accepted precedent: `id().nullable()/.unique()/.default()` already throw from the builder (`idOption`, `columns.ts:27-32`), as DEC-0132 describes. The fixer may, optionally, instead record the extra argument in the spec and reject it in `defineTable` with table and key named; either form satisfies SQL-AC-001 and the suite. Not a reason to reject.
- **Verification plan** is red-green per §8 step 3 (unit test first, then fix, then both integration tests, `npm run verify` keeping the `@ts-expect-error` needed, repro rerun). Adequate. Local only; no Cloudflare calls.
