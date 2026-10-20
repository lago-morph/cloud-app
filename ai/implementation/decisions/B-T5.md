# Decision drafts — B-T5 (strengthening phase-B tests: evaluation flags F2, F3, F5, F7, F8, F12)

Assumptions the strengthened tests make where the criteria, design docs or contracts leave a choice
open. Each entry is the simplest reading that makes the assertion as strong as its criterion. No
assertion was weakened. Only files under `packages/framework/test/**` were changed.

### DEC-PENDING-B-T5-1 — CHECK-AC-003 covers 15 rules; type-escape rule IDs are matched by bare name
Origin: ai-proposed · Status: proposed · Affects: CHECK-AC-003 (flag F2); `test/fixtures/support/check-catalog.ts`, `check/portability-rules.test.ts`

"Every rule's diagnostic" is read as every rule check.md §2 ("Shipped configuration") lists as shipped: the ten CHECK-REQ-001 rules, `no-raw-html`, `no-suppression-comments`, and typescript-eslint's `no-explicit-any`, `consistent-type-assertions` and `no-non-null-assertion`. The last three are matched as whole tokens, so `@typescript-eslint/no-explicit-any` satisfies `no-explicit-any`; the test does not fix the plugin prefix. Representatives: `html-inner` (construct `innerHTML`), `te-ts-ignore` (`@ts-ignore`), `te-any-param` (`any`), `te-as-unknown-as` (`as` or "type assertion"), and a new fixture `te-non-null` (construct "non-null"). For `consistent-type-assertions`, a message naming the construct's kind ("type assertions") is accepted as naming the construct, since the cast has no identifier of its own. `te-non-null` is not added to `TYPE_ESCAPE_FIXTURES` (CHECK-AC-002 does not list non-null assertions). An untagged control asserts the representative set equals the 15 rules. The five new tests fail until E-01/E-02 create `skill/reference/*.md`, for the same reason as the existing ten (B evaluation §3); they are judged at E-EV.

### DEC-PENDING-B-T5-2 — CFG-AC-004 reads the generated resolved-configuration module
Origin: ai-proposed · Status: proposed · Affects: CFG-AC-004 (flag F3); `config/build.test.ts`

Following config.md §2 "Delivery" (DEC-0063), the test locates, under `.framework/`, the generated JavaScript modules that have no imports and a default export, imports each, and keeps those whose default export has the `ResolvedConfig` shape (`deployment`, `values`, `secrets`). It requires exactly one such module for the built target and stage (by `deployment.target`/`deployment.stage`), and its `secrets` to equal exactly the declared secrets as `{ name, location }` (`SECRET_<NAME>` locally and on Cloudflare, SEC-REQ-003). The file name is not fixed. A module whose import throws (e.g. a Worker bundle) is skipped as not plain data.

### DEC-PENDING-B-T5-3 — LOCAL-AC-004's non-loopback probe must run, with a positive control
Origin: ai-proposed · Status: proposed · Affects: LOCAL-AC-004 (flag F5); `local/dev.test.ts`

The test now fails if the machine has no non-loopback address (non-internal IPv4, or IPv6 other than link-local), instead of passing with zero probes. A wildcard listener started by the test must be reachable on every probed address (positive control), so "not reachable" is not an artefact of the probe. The number of probes must equal addresses × dev listeners and be > 0. Consequence: `test:integration` must run where a non-loopback interface exists. The sandbox has `eth0` 192.0.2.2, so it runs there. It cannot run inside `unshare -n`, which only the template's `verify` (not the integration layer) uses for the offline exit check.

### DEC-PENDING-B-T5-4 — Type-only assertions are compiled inside the Vitest run
Origin: ai-proposed · Status: proposed · Affects: FILES-AC-004, AUTH-AC-001 (flag F7); new helper `test/fixtures/support/typecheck.ts`

A new tagged test in each file runs the TypeScript compiler API with `packages/framework/tsconfig.json`'s options on the test file (and, for AUTH, `support.ts`, whose reference routes read the ID with no assertion), and requires zero diagnostics in those files. Unused `@ts-expect-error` (TS2578) and failing `expectTypeOf` calls would show up there. Negative controls in the same program, as in-memory probe files, must produce errors on exactly the expected lines. For FILES these are reading `url`/`headers`/`expiresAt`, treating a ticket as a string, and `keyof Ticket = "url"`. For AUTH they are reading `.id` on an un-narrowed `CurrentUser`, an extra field, a missing field, and an `id` key on the anonymous member. So the Vitest status now carries the type evidence; the `tsc` step remains as well.

### DEC-PENDING-B-T5-5 — CORE-AC-005's `./targets/aws` fixture must fail on `allowed-imports`
Origin: ai-proposed · Status: proposed · Affects: CORE-AC-005 (flag F8); `cli/verify.test.ts`

CORE-REQ-005 says the portability rules must reject imports outside a subpath's allowed importers, and check.md assigns that to `allowed-imports`. So the test requires a diagnostic for `aws-runtime.ts` that names `allowed-imports` and contains `targets/aws`. An unresolved-module type error alone no longer satisfies it.

### DEC-PENDING-B-T5-6 — HTTP-AC-007 compares the logged error name and message with the caught error's own
Origin: ai-proposed · Status: proposed · Affects: HTTP-AC-007 (flag F12); `core/harness/reference-app.ts`, `http/errors.test.ts`

The contract does not fix `FrameworkError.name`, so the test does not hard-code names. The reference app gains a `/api/caught/:what` route that performs the same failing operation as each logged route (plain `Error`, `CORE.MISCONFIGURED`, the undeclared config key, the missing secret, SQL with `unavailable: ["sql"]`) inside `try/catch`, and returns the caught error's `name` and `message`. The entry of the uncaught request must contain that name as a whole token (so "Error" is not satisfied by "FrameworkError") and that exact message, in addition to the existing method, route, code, stack and key/secret-name checks.
