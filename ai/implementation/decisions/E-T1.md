# E-T1 decisions (test-case author: skill checks SKILL-AC-001…-004)

Tests: `tests/skill/{budgets-and-links,structure,hard-rules,examples}.test.ts`, helpers `tests/skill/support.ts`. Written from skill.md §1 (SKILL-REQ-001…-005), §4 (SKILL-AC-001…-005) and the §2 "Layout"/"Implementation" shapes, not from the skill's text.

### DEC-PENDING-E-T1-1 — Where the skill tests run, and the wiring that collects them
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-001…-004, vitest.integration.config.ts, tsconfig.json

The plan puts the tests in `tests/skill/`, which neither the integration nor the unit glob collected. The criteria are Local and not unit-level (they are not in the driver's `UNIT_LEVEL`), so they belong in the integration layer, which the driver runs on local with its tag filter. Wiring: `tests/skill/**/*.test.ts` added to `vitest.integration.config.ts` `include`; `tests/skill/**/*.ts` added to root `tsconfig.json` `include`, so `npm run typecheck` (part of `verify`) checks them. No harness change. The files are not `*.unit.test.ts`, so `npm run test:unit`/`verify` do not run them (the AC-004 test runs both apps' `verify`, minutes long).

### DEC-PENDING-E-T1-2 — SKILL-AC-005 is not duplicated
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-005

`tests/compliance/criteria/skill/scaffold.test.ts` already runs the real scaffolder into two non-empty directories and checks exit 1, the message and a byte- and mtime-identical tree. E-T1 adds no second test for it.

### DEC-PENDING-E-T1-3 — Readings of SKILL-AC-001
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-001

- "Every document" = the router (PAR-070), each `skill/reference/*.md` (PAR-071), each `skill/examples/*.md` (PAR-072); sizes are file bytes (UTF-8). `skill/templates/` has no budget.
- "Every reference" is the set CHECK names (`packages/framework/src/check/references.ts`, fixed by skill.md §2 "Implementation"); a test checks `skill/reference/` holds exactly that set so the link check cannot miss one.
- "Each reference links to its examples": every reference links to at least one existing example (skill.md §2: "links to at least one example"), and every example is linked from some reference.
- The link check also requires every relative link in any `skill/**/*.md` to resolve to an existing file (anchors are not checked).

### DEC-PENDING-E-T1-4 — Readings of SKILL-AC-002
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-002

- "Opens with 'read this when'": the first paragraph after the H1 title begins "Read this when" (case-insensitive); nothing may come before the title.
- "Ends with a stopping condition": the last section is an H2 "Stopping condition" whose text begins "Stop reading when" (skill.md §2).
- "The router covers each listed task": for each SKILL-REQ-002 task, a row of the router's task-map table whose task cell names the task links the reference it needs: endpoint → http-and-validation.md; storing data → sql-and-migrations.md; files → files.md; admin page → current-user.md; testing → testing.md; deploying → deploying.md; diagnosing a failing request, and a failing deploy (a diagnose/troubleshoot/debug row naming each) → troubleshooting.md.

### DEC-PENDING-E-T1-5 — Readings of SKILL-AC-003
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-003

Each SKILL-REQ-003 rule must be stated, every clause in one numbered item of the router's "Hard rules" section (skill.md §2: hard rules as a numbered list). Phrases are matched case-insensitively with light wording tolerance; the five `FRAMEWORK-ISSUE.md` entry fields are matched as the requirement words them. `npx <package> verify` accepts the package name or its binary name (DEC-0049).

### DEC-PENDING-E-T1-6 — Readings of SKILL-AC-004
Origin: ai-proposed · Status: accepted · Affects: SKILL-AC-004

- An example is "derived from" an app when its code blocks are copies of that app's files; every code block must therefore carry a directly preceding `<!-- example-source: <path> -->` (blank lines between are refused), name a file of `apps/template` or `apps/reference` (never `apps/demo/`), and equal it byte for byte (a missing final newline is tolerated). No block may equal a non-empty `apps/demo/` file.
- "CI type-checks and runs every example": CI is the framework's root `npm run verify`, which must run both apps' `verify`; `verify` type-checks only `src/` and `tests/` and runs `tests/**/*.test.ts` (cli.md §2, PAR-116), so every TypeScript source must lie there and every test source match that glob. Non-TypeScript sources (SQL, HTML, JSON) need only exist in those apps.
- "Runs ... the template": the test runs `npm --workspace <app> run verify` for `apps/template` and `apps/reference` and requires exit 0 (needs the framework built, as the driver and `test:integration` do).

## Parameter changes

None.
