# Root cause: SKILL-AC-001 — `skill/reference/deploying.md` does not link `skill/examples/configuration.md`

Diagnosed on branch `claude/implement-local-cloudflare-diag-e3` (from `origin/claude/implement-local-cloudflare` at `aad6097`). Local only; no Cloudflare calls. No code, docs or tests changed.

## Symptom

`npx vitest run --config vitest.integration.config.ts tests/skill/budgets-and-links.test.ts` (2026-10-20): 9 tests, 1 failed:

```
× [SKILL-AC-001] link check: each reference links to every one of its examples
AssertionError: missing links from a reference to one of its examples
+ [
+   "skill/reference/deploying.md does not link skill/examples/configuration.md",
+ ]
 ❯ tests/skill/budgets-and-links.test.ts:116:78
```

It is the only missing link; the other 12 rows of the table pass.

## Evidence

1. **The test's table.** `tests/skill/budgets-and-links.test.ts` `ITS_EXAMPLES` has `"deploying.md": ["configuration.md", "tests.md"]`. Added by `c74ade6` (E-T2). E-T2 DEC-PENDING-E-T2-1 gives the reason: design "Deploying": test stages use `config/<target>/test.json` (copied only in configuration.md); design "Testing": the smoke test against a deployed test stage (tests.md). E-T2 recorded "fails today" and left the skill fix to another item.
2. **The design text.** `docs/components/skill.md` §2, "Specific content the references carry", **Deploying**: "A stage whose name starts with `test-` is a test stage: it uses `config/<target>/test.json` … Every other stage is production and needs its own committed `config/<target>/<stage>.json`." §2 does **not** name an example for the deploying reference in so many words. It names examples explicitly only for files (`files-tickets.md`) and secrets (`secrets.md`) ("Implementation", last bullet). Every other row of the table is derived the same way: from what the reference must carry and which example copies those files.
3. **Which example shows that file.** `skill/examples/configuration.md` lines 56–64: `<!-- example-source: apps/template/config/cloudflare/test.json -->` and its contents. Its intro (line 9): "The template's values files for local development and for Cloudflare test stages." `grep` over `skill/examples/*.md` finds no other example copying any `config/` file. `apps/template/config/` holds only `local.json` and `cloudflare/test.json`.
4. **What deploying.md says and links.** `skill/reference/deploying.md` §1 tells the reader that a test stage "uses `config/cloudflare/test.json`" and a production stage "needs its own committed `config/cloudflare/<stage>.json`", and §3 step 1 says to create and commit that file. Its "Examples" section links only `examples/tests.md`. Its body links only `owner-tasks.md` and `troubleshooting.md`.
5. **Consistency with sibling references.** `owner-tasks.md` line 129 already links `examples/configuration.md` for exactly this reason ("the template's committed values files (`config/<target>/<stage>.json`)"); `local-development.md` line 58 links it for `config/local.json`. So the skill author already treats configuration.md as the example of the values files that a reference names; deploying.md is the one reference that names a values file and omits it.
6. **The criterion and prior reading.** SKILL-AC-001: "each reference links to its examples". DEC-0386 (accepted, E-T1) read this as "at least one"; E-T2-1 (proposed) strengthens it to "every example that shows what the reference covers". deploying.md passes the DEC-0386 reading (it links tests.md) and fails only the E-T2-1 reading.

## Chain (cause → symptom)

1. skill.md §2 requires the deploying reference to carry the test-stage / production-stage values-file rule (evidence 2), and deploying.md does (evidence 4).
2. The only example that shows such a values file is `configuration.md` (evidence 3), so under the E-T2-1 reading it is one of deploying.md's examples; the test table encodes that (evidence 1).
3. deploying.md links `tests.md` but not `configuration.md` (evidence 4).
4. So the per-reference loop at `budgets-and-links.test.ts:108–117` records exactly that one missing link and fails (symptom).

Every link is shown by file text or the test run above.

## Verdict: the table is right; the skill is missing a link

The row is not stated verbatim in skill.md, but it follows from §2 "Deploying" by the same derivation used for every other non-explicit row, it matches the links the skill already has in `owner-tasks.md` and `local-development.md` (evidence 5), and the linked file is the one deploying.md itself tells the reader to use. The failure is a skill gap, as E-T2 predicted.

## Alternatives considered

- **The table row is wrong (drop `configuration.md` from deploying).** Rejected: §2 "Deploying" names `config/<target>/test.json` and `config/<target>/<stage>.json` as content the reference carries, and configuration.md is the only example copying such a file (evidence 2, 3). Dropping it would make the row inconsistent with `owner-tasks.md`, which has the same basis. Weakening the test to pass is also forbidden (prompt §8).
- **The link exists but the parser misses it.** Rejected: `grep -n "examples/" skill/reference/deploying.md` returns only the `tests.md` line; there is no `configuration.md` link in any form.
- **The test should use DEC-0386 ("at least one").** That is a criterion-reading question for E-T2-1, not a cause of this failure. E-T2-1 is still "proposed"; if the orchestrator rejects it, the whole table check goes, not just this row. Under E-T2-1 as proposed, the skill is at fault.

## Fix and files

- `skill/reference/deploying.md`, section "Examples": add one bullet, for example
  `- [examples/configuration.md](../examples/configuration.md): the template's values file for Cloudflare test stages (\`config/cloudflare/test.json\`); a production stage needs its own file in the same place.`
  Keep the file within its budget (PAR-071); one line is well within it, but the size check in the same test file confirms it.
- No change to the test, design or other references.
- Owner of the fix: a skill/docs fix item (E-04 follow-up), red-green: the failing test above is already the red test.

## Verification

1. `npx vitest run --config vitest.integration.config.ts tests/skill/budgets-and-links.test.ts`: 9/9 pass (the link test and the size budget test).
2. Compliance driver on SKILL-AC-001 (and SKILL-AC-002, since deploying.md must still end with "Stopping condition": the new bullet goes in "Examples", before it).

## Side question: does SKILL-AC-004 require the E-T2 wiring of `tests/skill/example-pages.test.ts` into root `verify`?

**Yes, under the accepted reading, if E-T2-2 is accepted.**

- DEC-0389 (accepted): "'CI type-checks and runs every example': CI is the framework's root `npm run verify`."
- Root `verify` (`package.json` line 23) = framework build, typecheck, lint, `test:unit`, and both apps' `verify`. It does not run `tests/skill/example-pages.test.ts` (an integration-layer file, not `*.unit.test.ts`).
- Eight example blocks copy browser sources (`apps/template/index.html` or `src/client/**`: admin-and-current-user 2, endpoint-and-page 3, files-tickets 1, notes-sql 1, status-kv 1). `grep -rln "client/" apps/template/tests apps/reference/tests` finds nothing: no app test executes them, so the apps' `verify` type-checks them but does not run them.
- So the only thing that "runs" those examples is `example-pages.test.ts`, and CI (root `verify`) does not run it. The driver run evidences the test, but the criterion asks for CI. Without the wiring line E-T2 recorded (`&& vitest run --config vitest.integration.config.ts tests/skill/example-pages.test.ts`), SKILL-AC-004's "runs every example" is not met for the browser examples.
- If the orchestrator instead decides "runs" is met by type-checking plus module load (rejecting E-T2-2's reading), the wiring is not required; that would need a decision-log entry amending DEC-0389. Changing root `verify` is shared configuration, so plan §1 rule 1 requires a full `verify` after applying it.
