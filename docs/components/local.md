# LOCAL — Local target

Runs an app on the developer's machine with no cloud account: the Worker runtime under Wrangler for the API, Vite for the client, local emulations of storage, and the authentication mock.

Contracts: none of its own. It implements the capability contracts for the local target.

## 1. Requirements

#### LOCAL-REQ-001 — No cloud needed
Origin: provenance-unclear · Derives from: SYS-REQ-022

Running, testing, and verifying an app locally MUST need no cloud account, cloud credentials, or network access to cloud services.

#### LOCAL-REQ-002 — Local resources
Origin: ai-proposed · Derives from: SYS-REQ-022 · Decision: DEC-0518

Local development MUST provide every capability through local emulations:
- local D1 for SQL and KV;
- local R2 for files;
- `.dev.vars` for secrets;
- `config/local.json` for configuration;
- `.logs/` for the log;
- `.mail/` for the framework's email, captured and never sent (MAIL);
- the authentication mock, beside the password provider (AUTH §2).

Local state, including `.logs/` and `.mail/`, persists between runs in git-ignored directories, and the CLI can reset it.

#### LOCAL-REQ-003 — Postgres-dialect check
Origin: provenance-unclear · Derives from: SYS-REQ-011

App tests MUST be able to run against the Postgres harness as well as local D1, and the verification command MUST run them on each supported dialect, in a separate test-runner process per dialect.

#### LOCAL-REQ-004 — Consistent local origin
Origin: provenance-unclear · Derives from: SYS-REQ-022

Local URLs MUST use the hostname `localhost`. Local dev servers MUST listen on the loopback interface only, the generated configuration MUST NOT widen the listening host, and requests whose `Host` is not `localhost:<port>` MUST be rejected. Local cookies are not marked Secure; this relaxation MUST NOT be possible on cloud targets.

## 2. Design

`dev` (CLI) starts Vite with a proxy for `/api`, then Wrangler (PAR-101) with the generated local entry point; each binds a loopback port itself and `dev` reads the real port back (DEC-0417). It applies pending migrations, generates missing development-only secrets, captures log lines into `.logs/`, and captures the mail sender's marked lines into `.mail/<timestamp>-<id>.json` (MAIL §2). When stopped, it stops both processes. Local state lives in `.wrangler/` (Wrangler's own) and `.logs/`. The Postgres harness is PGlite (PAR-107), used by the test runner in-process. The dialect is fixed for each test-runner process, so `verify` runs the suite once per dialect.

The local target uses the Cloudflare adapters wherever possible (DEC-0039), with these local-only differences:
- the mock beside the password provider, whose mail is captured (MAIL);
- same-origin file transfers (FILES);
- log capture through the CLI (LOG).

**Build output.** `build --target <t> --stage <s>` (`src/build/`) loads `src/app.ts` (its default export, or the export `app`), checks the declared secret names, fixes the deployment identity, resolves the stage's values file and writes everything under `.framework/<target>/`, replacing what was there: `config.mjs` (the embedded resolved configuration), `entry.mjs` (the generated entry point, importing the app module, `config.mjs` and `<package>/targets/<target>`), and `worker.js` (the esbuild bundle of the entry). The local target also gets `wrangler.jsonc` for `dev`: `main: "worker.js"`, local D1 bound as `DB`, local R2 as `FILES` (DEC-0188, DEC-0190). Only a Cloudflare test-stage entry imports the authentication mock; production entries do not, and framework modules are bundled as side-effect free, so the mock module is not in their bundles (DEC-0189).

**Worker runtimes.** Both Workers (`createLocalWorker`, `createCloudflareWorker`) run the same stage runtime (`src/targets/cloudflare/stage.ts`) over the Worker `env`: `DB`, `FILES`, the variable `FRAMEWORK_PUBLIC_ORIGIN` (the public origin: set by `dev` locally and by deploy on Cloudflare; missing is `CORE.MISCONFIGURED` on first use), and `SECRET_<NAME>` values. The local Worker adds the mock, local tickets signed with `frameworkLocalTicketKey` and the transfer route, and prints log entries as marked lines. The health route checks one SQL read, every declared app secret, and the framework secrets the target needs (session key and `frameworkAuthSecret`; locally also the ticket key).

**Test apps.** `createTestApp` runs the same stage runtime in the test process. Each call is one build: it starts local D1 and R2 through `getPlatformProxy` with nothing persisted (on the Postgres dialect, SQL uses a fresh PGlite database instead), applies the framework migrations and then the app's — `<cwd>/migrations/<dialect>/` when present, otherwise a history generated once per process from the table definitions (DEC-0192) — and generates fresh session, auth and ticket keys. Requests without `CF-Connecting-IP` get `127.0.0.1`, so the password provider's rate limits apply per test client (DEC-0516). Its public origin is `http://localhost:8787`; it keeps cookies only from `loginWithStub` (DEC-0193).

## 3. Uses

All capability components, CLI.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| LOCAL-AC-001 | With networking to cloud providers blocked and no credentials present, a freshly scaffolded app runs and passes the verification command. | LOCAL-REQ-001 | Local |
| LOCAL-AC-002 | Each capability's local acceptance criteria pass, data survives a restart of `dev`, and the reset command clears it. | LOCAL-REQ-002 | Local |
| LOCAL-AC-003 | A query that works on SQLite but not on Postgres makes the verification command fail. | LOCAL-REQ-003 | Local |
| LOCAL-AC-004 | Login and API calls work at `http://localhost:<port>`; cloud builds reject the local cookie settings. The dev servers are not reachable on a non-loopback address, and a request with `Host: evil.example` is rejected. | LOCAL-REQ-004 | Local |

## 5. Portability note

LOCAL uses the Cloudflare adapters and stage runtime (DEC-0039), with only the local differences listed in §2; the app source is the same as on a cloud target (SYS-REQ-001). A new cloud target does not change LOCAL, and the Postgres harness stays as it is, because `verify` already runs the app tests once per supported dialect (LOCAL-REQ-003).
