# fix-e1 decision drafts — drop the unused app Vitest configuration

Fix of root cause `ai/implementation/root-causes/2026-10-20-SKILL-AC-004-example-config-not-typechecked.md` (accepted by its Review). Local only; no Cloudflare calls.

### DEC-PENDING-fix-e1-1 — `apps/template` and `apps/reference` have no `vitest.config.ts`
Origin: ai-proposed · Status: accepted (assumption under the owner's instruction; owner review open) · Affects: SKILL-AC-004, SKILL-REQ-004, PROV-AC-001 (reading in `tests/compliance/criteria/prov/template-deploy.test.ts`), decision-log entries at lines 1564 and 1599 (their mentions of "the template's `vitest.config.ts`" are now historical)

The Review left open whether to delete the file. Rule taken: delete it from an app only if nothing uses it. Checked:
- No script: neither app's `package.json` has a `test` script or any script that runs Vitest directly.
- Not `verify` or `smoke`: both start Vitest with `config: false` (`packages/framework/src/cli/verify/tests.ts`, `smoke.ts`) and set the PAR-116 glob and 60 s timeouts themselves (decision log line 1564).
- Not the scaffolder: `skill/scripts/scaffold.mjs` copies the template's files; no step reads or names the file, and no scaffolder test lists it.
- No test needs it: the PROV-AC-001 test's `ALLOWED` list only permits the name; an app without the file still passes.
- No doc tells developers to run plain `vitest` in an app; `skill/reference/testing.md` names only `verify` and `smoke`.

So both files are deleted. This also settles the record's Observation: the template has no TypeScript outside `src/` and `tests/`, so "CI type-checks … the template" holds for every file. A bare `npx vitest` inside an app now runs with Vitest defaults (5 s timeouts, SQLite only), which was never a supported test command.

Not changed: the decision log text (history) and the PROV-AC-001 reading comment, which still list `vitest.config.ts` as permitted metadata; permitting a file that is absent is harmless. The owner may trim both.
Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.
Item: fix-e1.
