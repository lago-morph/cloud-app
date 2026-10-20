# E-T2 decision drafts — closing evaluation E flags F1–F5 (test-only)

Test-case author item. It closes the flags in `ai/implementation/evaluations/E.md` for SKILL-AC-001, SKILL-AC-004 and CHECK-AC-003, working from the criteria text (`docs/components/skill.md` §4, `docs/components/check.md` §4). Only test files changed; no docs, skill, template or framework code; no Cloudflare calls. Per plan §1 "Test economy" (test-only item): typecheck, lint and the changed tests, then the compliance driver on the three IDs.

### DEC-PENDING-E-T2-1 — SKILL-AC-001: "each reference links to its examples" means every example tied to it (F1)
Origin: ai-proposed · Status: proposed · Affects: SKILL-AC-001, DEC-0386 (third bullet strengthened)

DEC-0386 read "its examples" as "at least one example". The criterion says *its* examples (plural, possessive): each reference must link every example that shows what it covers. `tests/skill/budgets-and-links.test.ts` now holds a table of each reference's examples, keyed by exactly `REFERENCE_FILES`, and requires every link in it. The "at least one" and "every example linked from somewhere" checks remain. Each row comes from skill.md §2 and from the files each example copies, not from the references' text:

| Reference | Its examples | Reason |
| --- | --- | --- |
| configuration | configuration | the only example of configuration keys and values files |
| current-user | admin-and-current-user | the only example of levels, `getCurrentUser`, `requireUser`/`requireAdmin`/`requireCurrentUser` |
| deploying | configuration, tests | design "Deploying": test stages use `config/<target>/test.json` (copied only in configuration.md); design "Testing": the smoke test against a deployed test stage (tests.md) |
| files | files-tickets | design "Implementation": `files-tickets.md` copies the finalize route "and the references point there" |
| http-and-validation | endpoint-and-page | design "HTTP and validation": `Hono<Env>` from `env.ts`, response types in `src/shared/`, `api<T>` in browser code; all shown there |
| kv | status-kv | the only example using `c.var.kv` |
| local-development | configuration, endpoint-and-page | `config/local.json` (configuration.md) and the `index.html` and client entry `dev` serves (endpoint-and-page.md) |
| log | notes-sql | the only example writing a log entry (`c.var.log.write`) |
| owner-tasks | configuration | copy-ID steps put IDs in `config/<target>/<stage>.json`, copied only in configuration.md |
| secrets | secrets | design "Implementation": `secrets.md` copies the HMAC helper and "the references point there" |
| sql-and-migrations | notes-sql | the only example of tables and generated migrations |
| testing | tests | the only example of `createTestApp` and the smoke test |
| troubleshooting | (none) | the design ties no example to it; the "at least one" check still applies |

Result: **fails today**: `skill/reference/deploying.md does not link skill/examples/configuration.md`. That is a skill gap, not fixed here (test-author item). Fix: add the link in `deploying.md` (E-04 or a docs fix item).

### DEC-PENDING-E-T2-2 — SKILL-AC-004: the template's browser examples are run (F2)
Origin: ai-proposed · Status: proposed · Affects: SKILL-AC-004, DEC-0389

"CI type-checks and runs every example." Examples copy `apps/template/index.html`, `src/client/main.ts`, `src/client/dom.ts` and `src/client/pages/{account,admin,files,notes,status}.ts`. No app test executes them; the app tests reach server routes only. New `tests/skill/example-pages.test.ts` (integration layer, so the driver runs it):
- a static check: every example source that is an `index.html` or under `src/client/` must be loaded by the template's `index.html` (its module script, then the relative non-type imports). So the run covers each one, and a new browser example outside that graph fails;
- a run: a scratch copy of `apps/template` (greeting set, `apiKey` set with `secrets set`) is served with `dev` and driven in Chromium by `tests/compliance/e2e/support/template-pages.ts`, the same driver E2E-001 uses. That covers the greeting, log in and out, Notes, Status (kept after reload), Files upload and download, and the admin secret check. All 7 steps must pass, with no uncaught page exception. The driver now also reports `pageErrors` (Playwright `pageerror`). E2E-001 reads only `steps`, so it is unaffected.

Server-side example files are executed by the apps' `verify` tests, which load `src/app.ts` and so every route module. No per-file coverage check was added: the criterion asks that the examples run, and module load plus the route tests meets that.

The run is not in root `npm run verify`. Putting it there needs a wiring line outside test files, in root `package.json` `verify`: append `&& vitest run --config vitest.integration.config.ts tests/skill/example-pages.test.ts`. It needs the framework built (verify builds it first) and Chromium (`/opt/pw-browsers`). It takes about 20 s. Not applied: changing root scripts is shared configuration (plan §1 rule 1 then requires a full `verify`), so it is left to the orchestrator.

### DEC-PENDING-E-T2-3 — SKILL-AC-004: the byte-for-byte example check runs in root `verify` (F3)
Origin: ai-proposed · Status: proposed · Affects: SKILL-AC-004, DEC-0384

`tests/skill/examples.test.ts` was split into two files:
- `tests/skill/example-copies.unit.test.ts` holds the file-only checks: markers, no `apps/demo/`, byte-for-byte equality, sources inside what `verify` covers, and the root `verify` wiring. The unit include glob `tests/**/*.unit.test.ts` collects it, so `npm run test:unit` and therefore root `npm run verify` run it. The integration glob `tests/skill/**/*.test.ts` also collects it, so the driver's integration run still evidences SKILL-AC-004 from it. The driver's unit run is limited to `UNIT_LEVEL` and ignores it. No configuration changed. A new tagged test asserts this wiring: root `verify` runs `test:unit`, which uses `vitest.unit.config.ts`, which includes `tests/**/*.unit.test.ts`.
- `tests/skill/examples.test.ts` keeps only the two apps' `verify` runs (minutes long). Root `verify` runs those apps' `verify` itself.

### DEC-PENDING-E-T2-4 — CHECK-AC-003 covers the five migration-checker rule IDs (F4)
Origin: ai-proposed · Status: proposed · Affects: CHECK-AC-003, DEC-0187

"Every rule's diagnostic" includes the migration checker's five rule IDs (check.md §2). New `packages/framework/test/integration/check/migration-diagnostics.test.ts` runs the real `verify` on three fixture apps (`apps/base` + `mig/base`; three apps so that one break cannot hide another). For each rule it requires a line in the check.md §2 layout carrying that rule ID, a message that names the construct (the location prefix is excluded), and a `skill/reference/*.md` that exists:
- `migration-checksums`: a comment appended to a generated migration; the message names that migration.
- `migration-history`: a pair numbered two past the last, recorded in checksums; the message names the file.
- `migration-dialects`: a column added to one dialect only, checksum kept; the message names the column.
- `migration-supported-changes`: a column renamed by hand in both dialects; the message names the file and both columns.
- `migration-apply`: an `ALTER TABLE` on a missing table; the message names the file and the missing table.

All 5 pass.

### DEC-PENDING-E-T2-5 — The CHECK-AC-003 coverage control is tagged and checks "exactly one" (F5)
Origin: ai-proposed · Status: proposed · Affects: CHECK-AC-003

The control in `portability-rules.test.ts` is now tagged `[CHECK-AC-003]`, so the driver runs it. It was untagged and showed as `skipped`. Before, it mapped `RULES` through `some(...)`, so a rule with two representative fixtures passed. Now it lists every representative fixture's rule, plus the other representatives, and requires that list sorted to equal `ALL_RULES`. So each rule has exactly one, none missing and none twice. It passes.
Item: E-T2.
