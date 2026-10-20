# CF — Cloudflare target

Runs an app on Cloudflare: one Worker serving the API and the static client, with D1, R2, Worker secrets, and the shared log bucket.

Contracts: none of its own. It implements the capability contracts for Cloudflare.

## 1. Requirements

#### CF-REQ-001 — Runtime shape
Origin: provenance-unclear · Derives from: SYS-REQ-001, SYS-REQ-008

Each stage MUST run as one Worker that serves the API and the client's static assets from one origin (HTTP), exporting a standard `fetch` handler.

#### CF-REQ-002 — Stage resources
Origin: ai-proposed · Derives from: SYS-REQ-001, SYS-REQ-024

Each stage MUST have its own:
- D1 database;
- R2 bucket;
- R2 signing credential;
- Worker secrets.

It MUST also have a write binding to the account's shared log bucket.

#### CF-REQ-003 — Workers-compatible bundle
Origin: provenance-unclear · Derives from: SYS-REQ-001, SYS-REQ-004

The Worker bundle MUST contain only Workers-compatible code. It MUST NOT include AWS SDKs, provisioning code, the Postgres harness, filesystem access, or unsupported Node.js modules.

## 2. Design

Resources are created by SST (PAR-100) through its Cloudflare components, with raw Pulumi Cloudflare resources (PAR-108) only where SST has no component. Worker settings (built by `cloudflareWorkerSettings` in `src/targets/cloudflare/settings.ts`, which provisioning maps onto the SST Worker, the static-asset settings through SST's Worker `assets` option `{ directory, notFoundHandling, runWorkerFirst }`, DEC-PENDING-D-06-1; `wranglerWorkerConfig` gives the same settings in Wrangler's form, DEC-PENDING-D-01-3):
- the Worker runs first for `/api` and `/api/*`;
- other paths go to static assets, with fallback to the entry page (`single-page-application`); a path such as `/apix` is a client path;
- the bindings: D1 `DB` (the stage's current database), R2 `FILES` (the stage bucket) and R2 `LOGS` (the shared `prototype-logs` bucket). The bindings carry the database, bucket and log-bucket identifiers to the runtime;
- framework variables (CFG): the plain-text `FRAMEWORK_PUBLIC_ORIGIN`, the stage's public origin (an `https` origin, checked when the settings are built). With it, `deploy` sets `FRAMEWORK_R2_ACCOUNT_ID` and `FRAMEWORK_FILES_BUCKET`, the account ID and stage bucket name the R2 transfer tickets address, read when a ticket is created (DEC-PENDING-D-01-2, DEC-PENDING-D-05-5);
- secrets (SEC), set separately as `SECRET_<NAME>`. No variable or binding is ever named `SECRET_*`, because an upload that declares one replaces the secret (DEC-0087); building the settings refuses one with `CORE.MISCONFIGURED`.

### Runtime

`createCloudflareWorker` (`./targets/cloudflare`) is the stage runtime the generated entry calls. Its Cloudflare-specific parts:
- **Log.** Each entry is one JSON object (`application/json`) in the shared log bucket through the `LOGS` binding, at the LOG-REQ-004 key; `<id>` is the request ID, or a random UUID for an entry without one (`src/log/cloudflare/`). The write is handed to the request's `waitUntil`, so it never delays the response, and a failed write is dropped. Without a `LOGS` binding, entries are printed as marked Worker output lines instead, as locally, and requests are unaffected (DEC-PENDING-D-01-1).
- **Secrets.** Read per request from the Worker env as `SECRET_<NAME>` with SEC's env reader; nothing is cached across requests, so a value set by `secrets set` is seen by the next request once the platform serves it (DEC-0092), and an empty or deleted secret is `SEC.MISSING` (DEC-PENDING-D-01-4).
- **Cookies.** The cloud cookie settings (`__Host-session`, `__Host-login`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain); the local settings are never imported by this runtime and are refused on a cloud target (DEC-0195).

The stage's public origin is its `workers.dev` URL. It is computed before deploy as `<worker>.<account subdomain>.workers.dev`, from the Worker's name and the account subdomain that `setup-account` recorded. `setup-account --target cloudflare` registers and records the account's `workers.dev` subdomain if it has none. Custom domains are not supported (DEC-0073).

### Deploy mechanics

How this target implements the per-target operations (PROV §2, Per-target operations):
- **`setupAccount`** creates the shared R2 log bucket (LOG §2) and the provisioning tool's state home on Cloudflare, checks that this account owns them, and registers and records the `workers.dev` subdomain as above.
- **`deploy`** runs SST with the Worker settings above. The current D1 database is an input; it is not in the provisioning tool's state.
- **`setSecret`** sets the Worker secret `SECRET_<NAME>` (SEC-REQ-003) through the Cloudflare API.
- **`stopApp`** turns off the stage Worker's public address (its `workers.dev` route) through the Cloudflare API. **`startApp`** turns it back on. The Worker is never deleted, so its secrets and bindings survive a stop (DEC-0078). The provisioning tool does not undo a change made outside its state, so the start is always an explicit CLI call, made on every deploy (PROV-REQ-002 step 6) and after a failed migration or check (MIG-REQ-003).
  Early spike: confirm that an SST/Pulumi update of the Worker script keeps the secrets set by `secrets set`. If it does not, the deploy keeps them through the Cloudflare API's handling of a script's existing secret bindings, never by storing a second copy of the secrets.
- **`createDatabase`, `copyDatabase` and `dropDatabase`** use the D1 HTTP API from the CLI (MIG §2).
- **`remove`** empties the stage's R2 bucket, deletes the stage's R2 API token (the R2 signing credential, which is outside the provisioning tool's state) and its D1 databases, then runs the provisioning tool's removal (PROV §2, Removal).
- **`listStageResources`** reports the Worker, the R2 bucket and the R2 API token by their identifiers, and the D1 databases by the exact database pattern.

## 3. Uses

All capability components, PROV.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CF-AC-001 | A deployed test stage serves the client and the API from one origin, and unknown API paths return JSON 404s. | CF-REQ-001 | Cloud |
| CF-AC-002 | Two stages of one app have disjoint databases, buckets, credentials, and secrets; both write to the shared log bucket. | CF-REQ-002 | Cloud |
| CF-AC-003 | Bundle inspection finds none of the excluded modules. | CF-REQ-003 | Local |
