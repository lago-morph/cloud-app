# LOCAL — Local target

Runs an app on the developer's machine with no cloud account: the Worker runtime under Wrangler for the API, Vite for the client, local emulations of storage, and the authentication mock.

Contracts: none of its own. It implements the capability contracts for the local target.

## 1. Requirements

#### LOCAL-REQ-001 — No cloud needed
Origin: provenance-unclear · Derives from: SYS-REQ-022

Running, testing, and verifying an app locally MUST need no cloud account, cloud credentials, or network access to cloud services.

#### LOCAL-REQ-002 — Local resources
Origin: ai-proposed · Derives from: SYS-REQ-022

Local development MUST provide every capability through local emulations:
- local D1 for SQL and KV;
- local R2 for files;
- `.dev.vars` for secrets;
- `config/local.json` for configuration;
- `.logs/` for the log;
- the authentication mock.

Local state persists between runs in a git-ignored directory, and the CLI can reset it.

#### LOCAL-REQ-003 — Postgres-dialect check
Origin: provenance-unclear · Derives from: SYS-REQ-011

App tests MUST be able to run against the Postgres harness as well as local D1, and the verification command MUST run them on each supported dialect, in a separate test-runner process per dialect.

#### LOCAL-REQ-004 — Consistent local origin
Origin: provenance-unclear · Derives from: SYS-REQ-022

Local URLs MUST use the hostname `localhost`. Local dev servers MUST listen on the loopback interface only, the generated configuration MUST NOT widen the listening host, and requests whose `Host` is not `localhost:<port>` MUST be rejected. Local cookies are not marked Secure; this relaxation MUST NOT be possible on cloud targets.

## 2. Design

`dev` (CLI) starts Wrangler (PAR-101) with the generated local entry point, and Vite with a proxy for `/api`. It applies pending migrations, generates missing development-only secrets, and captures log lines into `.logs/`. When stopped, it stops both processes. Local state lives in `.wrangler/` (Wrangler's own) and `.logs/`. The Postgres harness is PGlite (PAR-107), used by the test runner in-process. The dialect is fixed for each test-runner process, so `verify` runs the suite once per dialect.

The local target uses the Cloudflare adapters wherever possible (DEC-0039), with these local-only differences:
- the mock in place of a real provider;
- same-origin file transfers (FILES);
- log capture through the CLI (LOG).

## 3. Uses

All capability components, CLI.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| LOCAL-AC-001 | With networking to cloud providers blocked and no credentials present, a freshly scaffolded app runs and passes the verification command. | LOCAL-REQ-001 | Local |
| LOCAL-AC-002 | Each capability's local acceptance criteria pass, data survives a restart of `dev`, and the reset command clears it. | LOCAL-REQ-002 | Local |
| LOCAL-AC-003 | A query that works on SQLite but not on Postgres makes the verification command fail. | LOCAL-REQ-003 | Local |
| LOCAL-AC-004 | Login and API calls work at `http://localhost:<port>`; cloud builds reject the local cookie settings. The dev servers are not reachable on a non-loopback address, and a request with `Host: evil.example` is rejected. | LOCAL-REQ-004 | Local |
