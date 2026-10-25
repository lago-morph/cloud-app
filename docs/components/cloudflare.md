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

Amendment (Origin: ai-proposed · Decision: DEC-0550): the R2 signing credential is the account's, not each stage's: `setup-account` creates it once, so `deploy` needs no permission to create API tokens. Each stage holds it in its own Worker secrets; each stage's tickets name only that stage's bucket; the credential is denied on the account buckets (the log bucket, the state home, the mail sink's bucket and the backup bucket `prototype-backups`, so a leaked stage secret cannot read or overwrite the backups of removed production stages; DEC-0543).

#### CF-REQ-003 — Workers-compatible bundle
Origin: provenance-unclear · Derives from: SYS-REQ-001, SYS-REQ-004

The Worker bundle MUST contain only Workers-compatible code. It MUST NOT include AWS SDKs, provisioning code, the Postgres harness, filesystem access, or unsupported Node.js modules.

Amendment (Origin: ai-proposed · Decision: DEC-0554): the build MUST fail when the bundle contains a provider SDK: a module bundled from a package of `allowed-imports`' deny list, or a marker string a provider SDK carries in its own code (`PROVIDER_SDK_MARKERS`, `src/build/inspect.ts`).

Amendment (Origin: ai-proposed · Decision: DEC-0516): the only Node.js modules the bundle MAY import are `node:crypto` and `node:async_hooks`, which the password provider needs, and the Worker MUST be configured with the `nodejs_compat` compatibility flag. The minified bundle MUST stay within PAR-245.

## 2. Design

Resources are created by SST (PAR-100) through its Cloudflare components, with raw Pulumi Cloudflare resources (PAR-108) only where SST has no component. Worker settings (built by `cloudflareWorkerSettings` in `src/targets/cloudflare/settings.ts`, which provisioning maps onto the SST Worker, the static-asset settings through SST's Worker `assets` option `{ directory, notFoundHandling, runWorkerFirst }`, DEC-0356; `wranglerWorkerConfig` gives the same settings in Wrangler's form, DEC-0325):
- the Worker runs first for `/api` and `/api/*`;
- other paths go to static assets, with fallback to the entry page (`single-page-application`); a path such as `/apix` is a client path;
- the compatibility date of the framework build (`COMPATIBILITY_DATE`, 2026-10-01) and the compatibility flag `nodejs_compat`, set explicitly although Node APIs are on by default at that date (RESULT.md, DEC-0516);
- the bindings: D1 `DB` (the stage's current database), R2 `FILES` (the stage bucket) and R2 `LOGS` (the shared `prototype-logs` bucket). The bindings carry the database, bucket and log-bucket identifiers to the runtime. Production stages also bind `EMAIL`, an Email Service binding (`send_email`) whose only allowed sender is `no-reply@<emailDomain>` (MAIL, DEC-0514); test stages and local builds bind no `EMAIL`;
- framework variables (CFG): the plain-text `FRAMEWORK_PUBLIC_ORIGIN`, the stage's public origin (an `https` origin, checked when the settings are built). With it, `deploy` sets `FRAMEWORK_R2_ACCOUNT_ID` and `FRAMEWORK_FILES_BUCKET`, the account ID and stage bucket name the R2 transfer tickets address, read when a ticket is created (DEC-0324, DEC-0353); and `FRAMEWORK_MAIL_FROM`, the sender address derived from the account settings record (MAIL);
- secrets (SEC), set separately as `SECRET_<NAME>`. No variable or binding is ever named `SECRET_*`, because an upload that declares one replaces the secret (DEC-0087); building the settings refuses one with `CORE.MISCONFIGURED`.

### Runtime

`createCloudflareWorker` (`./targets/cloudflare`) is the stage runtime the generated entry calls. Its Cloudflare-specific parts:
- **Log.** Each entry is one JSON object (`application/json`) in the shared log bucket through the `LOGS` binding, at the LOG-REQ-004 key; `<id>` is the request ID, or a random UUID for an entry without one (`src/log/cloudflare/`). The write is handed to the request's `waitUntil`, so it never delays the response, and a failed write is dropped. Without a `LOGS` binding, entries are printed as marked Worker output lines instead, as locally, and requests are unaffected (DEC-0323).
- **Secrets.** Read per request from the Worker env as `SECRET_<NAME>` with SEC's env reader; nothing is cached across requests, so a value set by `secrets set` is seen by the next request once the platform serves it (DEC-0092), and an empty or deleted secret is `SEC.MISSING` (DEC-0326).
- **Cookies.** The cloud cookie settings (`__Host-session`, `__Host-login`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain); the local settings are never imported by this runtime and are refused on a cloud target (DEC-0195).

The stage's public origin is its `workers.dev` URL. It is computed before deploy as `<worker>.<account subdomain>.workers.dev`, from the Worker's name and the account subdomain that `setup-account` recorded. `setup-account --target cloudflare` registers and records the account's `workers.dev` subdomain if it has none. Custom domains are not supported (DEC-0073).

### Deploy mechanics

How this target implements the per-target operations (PROV §2, Per-target operations). The stage's resources have fixed names (DEC-0331): the Worker script `<app>-<stage>` and the R2 bucket `<app>-<stage>-files`; databases follow MIG's `<app>-<stage>-db-<n>`. The R2 signing credential is the account's token `prototype-r2-signing` (DEC-0550); a stage deployed before DEC-0550 may still have a legacy token `<app>-<stage>-files-signing`.
- **`setupAccount`** creates the shared R2 log bucket (LOG §2), the backup bucket `prototype-backups` with its PAR-311 lifecycle rule (DEC-0543) and the provisioning tool's state home on Cloudflare, checks that this account owns them, and registers and records the `workers.dev` subdomain as above. It also records the email domain in the account settings record `framework/account.json` in `sst-state` (DEC-0514), onboards the domain for Email Sending, enables Email Routing on `t.<emailDomain>` with subaddressing and one literal rule `sink@t.<emailDomain>` → the sink Worker `prototype-mailsink` (Cloudflare allows catch-all rules only on the apex; DEC-0527; enabling the subdomain also turns routing on zone-wide, without an apex MX), deploys that Worker, and creates the R2 bucket `prototype-mailsink` with its lifecycle rule (MAIL §2). It also creates the account's R2 signing credential when absent: the token `prototype-r2-signing`, denied on the account buckets `prototype-logs`, `sst-state`, `prototype-mailsink` and `prototype-backups`, and its record `framework/r2-signing.json` in `sst-state`, which names the denied buckets (DEC-0550). A record that does not name every one of them (a token created before the backup bucket existed) counts as absent, and the token is replaced: the new token is created and its record written first, and the old token is deleted only then, so a failure on the way leaves the old key working (DEC-0556). Every deployed stage still holds the old key in its Worker secrets, so its file tickets fail until it is redeployed; `setup-account` prints that each deployed stage must be redeployed (`deploy --target cloudflare --stage <stage>`). Each part lists first and creates only what is absent. Cloudflare holds the subdomain, so it is read again on every deploy; on an account without one, `setup-account` registers `pf-<random>`, `pf-` and PAR-320's random part, never a name derived from the account ID or other personal data (DEC-0552).
- **`deploy`** runs SST with the Worker settings above. The current D1 database is an input; it is not in the provisioning tool's state. Its preflight checks every shared resource above, the backup bucket, its lifecycle rule and the signing record included, and names all the absent ones in one message that points to `setup-account` (DEC-0550, DEC-0543). After step 5's SST run it writes the framework-internal secrets: the session key and auth secret when absent, and on every deploy the account's R2 signing credential from its record (DEC-0550). It creates no API token.
- **`setSecret`** sets the Worker secret `SECRET_<NAME>` (SEC-REQ-003) through the Cloudflare API.
- **`stopApp`** turns off the stage Worker's public address (its `workers.dev` route) through the Cloudflare API. **`startApp`** turns it back on. The Worker is never deleted, so its secrets and bindings survive a stop (DEC-0078). The provisioning tool does not undo a change made outside its state, so the start is always an explicit CLI call, made on every deploy (PROV-REQ-002 step 6) and after a failed migration or check (MIG-REQ-003). A stage stopped with `stop` is recorded in `framework/<app>/<stage>/stage.json` in `sst-state`; its deploy turns the route off again after step 5, since the code deploy may turn it on (DEC-0091, DEC-0544).
  Early spike: confirm that an SST/Pulumi update of the Worker script keeps the secrets set by `secrets set`. If it does not, the deploy keeps them through the Cloudflare API's handling of a script's existing secret bindings, never by storing a second copy of the secrets.
- **`createDatabase`, `copyDatabase` and `dropDatabase`** use the D1 HTTP API from the CLI (MIG §2).
- **`backupStage`** (production `remove`, DEC-0543) writes each D1 database's export and each object of the stage bucket, as bytes through the R2 object endpoints of `api.cloudflare.com`, to `prototype-backups/<app>/<stage>/<time>/`, then a manifest, and checks the listing. Before the export it scans each database for values D1's export does not keep (a NUL in text, an integer beyond ±2^53) and also writes those tables losslessly; files go under numbered keys `files/<nnnnnn>`, mapped to their keys in the manifest (DEC-0556). **`listStageBackups`** lists `prototype-backups/<app>/<stage>/` and reads each manifest.
- **`remove`** empties the stage's R2 bucket, deletes a legacy per-stage R2 API token if there is one and the credentials may list tokens (with the everyday token they may not, and the step is skipped), deletes its D1 databases, then runs the provisioning tool's removal (PROV §2, Removal). It never touches the account's signing credential or the backup bucket's other backups.
- **`listStageResources`** reports the Worker, the R2 bucket, a legacy R2 API token, the SST state objects and the stage record by their identifiers, and the D1 databases by the exact database pattern.

## 3. Uses

All capability components, PROV.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| CF-AC-001 | A deployed test stage serves the client and the API from one origin, and unknown API paths return JSON 404s. | CF-REQ-001 | Cloud |
| CF-AC-002 | Two stages of one app have disjoint databases, buckets and secrets; both write to the shared log bucket. Both stages' tickets are signed with the account's R2 signing credential, and each stage's ticket names only its own bucket (DEC-0550). | CF-REQ-002 | Cloud |
| CF-AC-003 | Bundle inspection finds none of the excluded modules, and no `node:*` specifier other than `node:crypto` and `node:async_hooks`; the generated Worker settings carry the `nodejs_compat` flag; the minified bundle of the reference app is within PAR-245. A bundle with a module from a denied package, or with a provider SDK's marker string, fails the build naming it; the template's and reference app's bundles pass (DEC-0554). | CF-REQ-003 | Local |

## 5. Portability note

This component is where Cloudflare names belong: the Worker, D1, R2, Worker secrets and the `workers.dev` origin stay here and in each capability's Cloudflare adapter, never in app-facing contracts. A new target is a sibling component with its own runtime shape, stage resources and PROV §2 per-target operations, plus the shared places the component map lists (§1); this component does not change. LOCAL uses this component's adapters and runs its stage runtime, `src/targets/cloudflare/stage.ts` (LOCAL §2, DEC-0039), so a change here is also a change to LOCAL.
