# Decision drafts — B-T1 (integration test cases: core, http, log, config, secrets)

Suites: `packages/framework/test/integration/{core,http,log,config,secrets}/`. Shared harness: `packages/framework/test/integration/core/harness/` (`harness.ts`: temp apps, CLI runner, `dev` runner, schema validators; `reference-app.ts`: the in-process fixture app). Each entry below is an assumption taken under the owner's "do not stop for questions" instruction where a criterion or contract leaves something open.

### DEC-PENDING-B-T1-1 — LOG-AC-001 needs a log-writer injection option in `TestAppOptions`
Origin: ai-proposed · Status: accepted · Affects: LOG-AC-001, `docs/contracts/ts/testing.d.ts` (owner B-16), B-04

LOG-AC-001 requires "an injected log writer that fails and one that never completes", but no public contract offers an injection point; plan B-04 already lists "failing and never-completing writer injection for tests". Proposal: add to `TestAppOptions` `readonly logWriter?: "failing" | "never-completing"` ("failing": every write rejects/throws inside the writer; "never-completing": every write returns a promise that never settles). `log/log.test.ts` uses exactly this name through an intersection type (`TestAppOptions & { logWriter?: … }`), so it type-checks today and fails until B-16 adds the option. If B-16 picks another shape, it updates the contract and this one test together (decision draft required, contract change).

### DEC-PENDING-B-T1-2 — How the suites reach the framework
Origin: ai-proposed · Status: accepted · Affects: all B-T1 suites, B-16, B-17, B-RUN

- In-process tests import the public hubs by relative path (`src/index.ts`, `src/testing/index.ts`), which re-export exactly the contract names; they run against sources and need no build.
- Everything an app would do through the package name uses the package name and therefore the compiled `dist/` (DEC-PENDING-B-01-2): on-disk fixture apps (temp directories whose `node_modules` links to the workspace's), the CORE-AC-001 compiler fixtures, the esbuild bundle of `./client` for the browser test, and the package binary (`bin/prototype-framework.js`) for `build`, `dev` and `secrets set`.
- **Open item:** `npm run test:integration` must build the framework first (`npm run build -w packages/framework`). Without `dist/` those tests fail with a message saying so. Wiring that order is B-16/B-17's (or the integrator's, for the root script).

### DEC-PENDING-B-T1-3 — Finding the `dev` origin; one `dev` at a time
Origin: ai-proposed · Status: accepted · Affects: HTTP-AC-001, HTTP-AC-006, LOG-AC-002, LOG-AC-003, CFG-AC-003, SEC-AC-001, SEC-AC-002

The dev port is not contracted. The harness starts `npx <package> dev` (the binary) in the app directory, collects every `http://localhost:<port>` printed, and uses the one that serves both `GET /` as `text/html` 200 and `GET /api/__framework/health` as a framework response (204 or JSON) — the one-origin requirement (HTTP-REQ-004, LOCAL-REQ-004). `dev` must therefore print that URL. Vitest runs files in parallel, so dev sessions are serialised by a lock directory in the OS temp directory (owner pid inside; a dead owner's lock is taken over). Stopping sends SIGINT to the process group, then SIGKILL after 15 s.

### DEC-PENDING-B-T1-4 — Fixture client entry page location
Origin: ai-proposed · Status: accepted · Affects: HTTP-AC-001

Where the client's `index.html` lives is not contracted (cli.md only says `src/client/` holds browser code). Fixture apps write the same page at the app root and at `src/client/index.html`. HTTP-AC-001 asserts the deep link returns 200 HTML byte-identical to `GET /` and containing the page's marker.

### DEC-PENDING-B-T1-5 — Entry-module export form
Origin: ai-proposed · Status: accepted · Affects: on-disk fixture apps, B-16

The form of `src/app.ts`'s export is not contracted ("the value an app's entry module exports"). Fixture apps export the `defineApp` result both as `default` and as `app`.

### DEC-PENDING-B-T1-6 — CFG-AC-003 local interpretation
Origin: ai-proposed · Status: accepted · Affects: CFG-AC-003, B-17

"A running build" is a running `dev`; "the next build" is the next `dev` start (which builds). The test edits `config/local.json` while `dev` runs, checks the served value is unchanged after 8 s and 10 s, restarts `dev`, and expects the new value. So `dev` must not rebuild on a values-file change while running (E2E-014: "takes effect only after the rebuild").

### DEC-PENDING-B-T1-7 — Local stage name and build invocations
Origin: ai-proposed · Status: accepted · Affects: CORE-AC-007, CFG-AC-002, CFG-AC-004, CFG-AC-006, SEC-AC-002…004

CLI-REQ-001 requires `--stage` for `build` and `secrets set`; no doc names the local stage. Tests use `--target local --stage local`, which reads `config/local.json`. Test/production stage selection (CFG-AC-002) is tested with `build --target cloudflare --stage test-<id>` and `--stage bt1prod`, which run offline (plan B-16).

### DEC-PENDING-B-T1-8 — "Naming" in CLI failures
Origin: ai-proposed · Status: accepted · Affects: CORE-AC-007, CFG-AC-002, CFG-AC-006

A failure "names" something when the command exits non-zero and its combined stdout+stderr contains: the offending key (CFG-AC-002), the missing file as `config/<target>/<stage>.json` (CFG-AC-002), the unknown field's name (CFG-AC-006), or for the app-name rule the bad name plus one of `hyphen`, `lowercase letters and digits`, `[a-z0-9]`, `PAR-290` (CORE-AC-007).

### DEC-PENDING-B-T1-9 — CFG-AC-004: where the resolved configuration is observed
Origin: ai-proposed · Status: accepted · Affects: CFG-AC-004, B-09, B-16

The resolved configuration is embedded in the build as a generated module (DEC-0063) under `.framework/`; its format is not contracted. The test passes when, after `build`, some file under `.framework/` contains both each declared secret's logical name and its location (`SECRET_<NAME>`, SEC-REQ-003), for a local and a Cloudflare test-stage build.

### DEC-PENDING-B-T1-10 — HTTP-AC-007 entry contents and fixtures
Origin: ai-proposed · Status: accepted · Affects: HTTP-AC-007, LOG-AC-005, B-03, B-04

- The log entry schema has no structured fields beyond `message`, so method, route path, code, the error's name and message, the stack (a V8 frame line `\n    at `), and the key or secret name are all asserted inside `message`. The secret is accepted by logical name or location.
- Routes have no path parameters, so "route path" and request path coincide.
- No app-reachable in-process path produces `CORE.MISCONFIGURED`, so the reference route throws `FrameworkError("CORE.MISCONFIGURED")` (a CORE code, not a capability code, so CORE-REQ-007 does not forbid it at runtime).
- "Exactly one `error` entry" counts `error` entries added to `logs()` during that request.
- LOG-AC-005: the entry's `component` is `CORE` for an uncaught error and `SQL` for `SQL.UNAVAILABLE` (LOG-REQ-005 "the failing component's code").

### DEC-PENDING-B-T1-11 — Secret values are redacted from responses and log entries
Origin: ai-proposed · Status: accepted · Affects: HTTP-AC-002, SEC-AC-002, HTTP-REQ-007, B-03, B-04, B-10

HTTP-REQ-007 logs the underlying error's message, while SEC-REQ-002 forbids secret values in log entries and error responses, and C-01's fixture is "a route that throws an error containing the test secret value". The tests therefore require that a known secret value (one read through `c.var.secrets` in this request or set for the test app) never appears in a response — including the message of an app-thrown 4xx `FrameworkError` — nor in any log entry, even when app code put it into an error message. The framework must redact known secret values (or not return app messages).

### DEC-PENDING-B-T1-12 — Other readings
Origin: ai-proposed · Status: accepted · Affects: listed per item

- HTTP-AC-002 "the request's ID": the `requestId` in the body equals `c.var.requestId` seen by app middleware for that request.
- HTTP-AC-003: the over-limit body is sent once with `Content-Length` and once streamed without it; a body of exactly PAR-200 bytes reaches the handler; malformed JSON also gives 400 `HTTP.INVALID_INPUT`.
- HTTP-AC-006: the browser runs the package's `./client` export bundled by esbuild (PAR-119) into a page on the `dev` origin; the session comes from `POST /api/auth/mock-login`; "unreachable" is a Playwright-aborted request (status `null`, `requestId` `null`); the not-from-the-app message is compared exactly.
- CORE-AC-001 "importable from the subpath whose signatures use it": `.` and `./client` must be self-contained; types in `./testing` signatures may come from `.` too, since app test files may import both (CORE-REQ-005). Checked by walking the built declarations with the TypeScript checker.
- CORE-AC-003: forged `Host`, `X-Forwarded-Host`, `Forwarded`, `X-Forwarded-Proto`/`-For` and look-alike headers are sent through `TestApp.request`.
- CORE-AC-004 scan: every quoted string of the form `<PREFIX>.<NAME>` (catalogue prefixes) and every `new FrameworkError("…")` literal in `packages/framework/src` (unit tests excluded) must be a catalogue code.
- CORE-AC-005: this suite covers the exports-map part (expected set without `./targets/aws`, DEC-PENDING-B-01-1); the `verify` part is B-T4's. CORE-AC-008: route part here, `verify` part B-T4's.
- LOG-AC-003: the log file is named after the entry's UTC date; "ignored by git" is checked with `git check-ignore --no-index` for `apps/{template,reference,demo}/.logs/…` in this repository.
- SEC-AC-002 local scope: error responses; `TestApp.logs()`; `.logs/` from `dev`; the app directory after `build --target local` and `--target cloudflare --stage test-…` (excluding `.dev.vars`, the secret store, and `.wrangler/`, emulator state); the repository via `git grep --untracked`. Ticket "URL" = every string of 16+ characters inside the ticket JSON (contents are opaque). The stub authorization code = the query values of `/api/auth/callback` reached by following same-origin `/api/` redirects from `/api/auth/login` in-process; this assumes the stub provider redirects straight to the callback (it "speaks no protocol"). "Deployed browser assets" is cloud-only (C-T1/D).
- SEC-AC-003 local: `.dev.vars` holds exactly one line `SECRET_API_KEY=<value>` (quotes allowed) after `secrets set apiKey --target local --stage local` with the value on stdin. SEC-AC-004 also checks the stdin form of the same command succeeds, so the rejection is specific to the argument forms (positional, `--value x`, `--value=x`).

## Parameter changes

None.
