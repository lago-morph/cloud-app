# Parameters Register

Tunable values used by the framework — limits, sizes, timeouts, defaults, and dependency version pins — are recorded here and nowhere else. Design documents and contracts refer to values by `PAR-…` ID. A value is added only when a component design or contract actually uses it; spec-level requirements and decisions do not reference concrete values (DEC-0057).

IDs are never reused. IDs 010–013, 020–022, 030–033, 040, 050–053, 061–066, and 080 belonged to entries removed by DEC-0057, 211 to an entry removed by DEC-0076, and 240 to an entry removed by DEC-0077; all stay retired. 115 was never assigned; it stays unused so that no reader takes it for a retired pin.

Categories (see [CONVENTIONS.md §5](../CONVENTIONS.md)):

- **owner** — set by the owner; only the owner changes it.
- **platform** — imposed by a cloud platform or dependency; re-verify against the cited source during implementation and whenever the platform changes.
- **ai-proposed** — chosen by an AI with no external basis required; free to change during implementation and testing. When changed, update the value here.

## General

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-001 | Design load | A few simultaneous users | owner | Qualitative; see SYS-REQ-007. |

## HTTP

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-200 | Maximum JSON request body | 1,000,000 bytes | ai-proposed | Used by HTTP-REQ-003. Must stay below PAR-201 and PAR-202. |
| PAR-201 | AWS Lambda request payload limit | 6 MB, less for binary bodies, which are base64-encoded | platform | AWS Lambda quotas. Why large files bypass the API (DEC-0058). Deferred (branch `aws`). |
| PAR-202 | Cloudflare Workers request body limit | 100 MB (Free and Pro plans) | platform | Cloudflare Workers limits. |

## SQL and migrations

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-210 | Time budget for reaching the database, including resume from pause | 45 seconds | ai-proposed | SQL-REQ-006 and the deploy-time wait. PAR-210 + PAR-260 must be below PAR-270. |
| PAR-212 | Aurora capacity range | 0 to 4 ACU | ai-proposed | 0 lets the database pause when idle. Deferred (branch `aws`). |
| PAR-213 | Aurora auto-pause delay | 5 minutes | ai-proposed | Platform minimum is 300 seconds. Deferred (branch `aws`). |
| PAR-214 | Data API maximum response size | 1 MiB | platform | RDS Data API quotas. Deferred (branch `aws`). |
| PAR-215 | Portable maximum query result size | 256 KiB | ai-proposed | Enforced on every read result on every target, measured as defined in sql.md §2.3; a write's RETURNING rows are not limited (DEC-0542). Leaves room for the Data API's JSON encoding within PAR-214. |
| PAR-216 | D1 maximum bound parameters per statement | 100 | platform | Cloudflare D1 limits; measured identical on local D1 and remote D1 (DEC-0102, DEC-0097). Apps chunk long `inArray` lists and multi-row inserts; the D1 copy stays within it. |
| PAR-217 | D1 maximum SQL statement length | 100,000 bytes | platform | Cloudflare D1 limits; SQL text only, bound values excluded; measured identical locally and remotely (DEC-0102, DEC-0097). |
| PAR-218 | D1 copy page size | At most 1,000 rows and 1,000,000 bytes of values per request; a single larger row is sent alone | ai-proposed | Cloudflare `copyDatabase` fallback copy (DEC-0096). Keeps each request far from the observed 30 s / 502 failure at 5.5 MB. |
| PAR-219 | D1 databases per Cloudflare account | 10 on Workers Free; 50,000 on Workers Paid | platform | Free: observed on the test account while it was on Free (HTTP 403, code 7406; DEC-0097). Both: Cloudflare D1 limits, developers.cloudflare.com/d1/platform/limits/ (read 2026-10-25; DEC-0530). A schema-changing deploy briefly holds two databases per stage; `copyDatabase` reports this error clearly, naming the account's plan's limit: the plan is read from `GET /accounts/<account>/subscriptions` when the error occurs, else from `PROTOTYPE_FRAMEWORK_CLOUDFLARE_PLAN=free|paid`, else both limits are named (DEC-0546). |
| PAR-312 | Largest row the native D1 copy accepts | 40,000 bytes of values | ai-proposed | Pre-check of Cloudflare `copyDatabase` (DEC-0545): the export writes a row as one INSERT with inline literals, quoting can double a value, and D1 refuses a statement over PAR-217. A larger row makes the copy take the row-by-row path. |
| PAR-313 | Largest database the native D1 copy accepts | 5,000,000 bytes of values | ai-proposed | Pre-check of Cloudflare `copyDatabase` (DEC-0545): within the 5 MB fixture of spike A-06 (DEC-0096). A larger database is copied row by row. |
| PAR-314 | Time limit of one D1 export or import | 120 seconds, polled every second | ai-proposed | Native copy and the production `remove`'s backup (DEC-0545, DEC-0543). A-06's 5.6 MB export completed in 1.4 s and a 1.5 MB import in about 2 s. A native copy that runs out of time falls back to the row-by-row copy; a backup that does stops `remove` before anything is deleted. |
| PAR-315 | Wait for requests in flight after a production `remove` stops the app | 60 seconds | ai-proposed | Production `remove` on Cloudflare (DEC-0557): after the route is off, a request the Worker took before may still be writing; the backup's reads start only after this wait. Cloudflare sets no wall-clock limit on a Worker request while its client stays connected, but `waitUntil` work may run up to 30 s after the response; 60 s covers ordinary requests and that tail. A longer request can still write during the backup. |

## KV

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-220 | Maximum key length | 1,024 UTF-8 bytes | ai-proposed | |
| PAR-221 | Default list page size | 20 | ai-proposed | |
| PAR-222 | Maximum list page size | 50 | ai-proposed | 50 × (PAR-220 + PAR-223) stays within PAR-215. |
| PAR-223 | Maximum value size | 4,096 UTF-8 bytes | ai-proposed | |

## Files

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-230 | Maximum file name length | 1,024 UTF-8 bytes | platform | S3 and R2 object key limit. |
| PAR-231 | Default list page size | 100 | ai-proposed | |
| PAR-232 | Maximum list page size | 1,000 | platform | S3 `ListObjectsV2` returns at most 1,000 keys per call. |
| PAR-233 | Transfer ticket lifetime | 15 minutes | ai-proposed | Assumes on AWS that the Lambda role's session credentials outlast PAR-233. If they expire earlier, the transfer fails in the browser as `FILES.TRANSFER_FAILED` with storage's status, and nothing is logged on the server. |
| PAR-234 | Maximum single-upload file size | About 5 GB (S3: 5 GB; R2: 4.995 GiB, i.e. 5 GiB less 5 MiB, per developers.cloudflare.com/r2/platform/limits/, read 2026-10-25) | platform | Not a framework limit; larger files would need multipart upload (DEC-0062). The template sets no lower cap (DEC-0539). |

## Authentication

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-250 | Session lifetime | 7 days | ai-proposed | The owner has no preference (DEC-0057). |
| PAR-251 | Validity of an in-progress login | 10 minutes | ai-proposed | |
| PAR-252 | Clock skew tolerated when validating provider responses | 60 seconds | ai-proposed | Also bounds a session cookie's future issued-at time (DEC-0169). |
| PAR-253 | Minimum session signing key length | 32 bytes | ai-proposed | Also the length of `frameworkAuthSecret` (SEC). |

## Password login provider and mail

The owner approved these values on 2026-10-25 ("Approve recommended values", DEC-0517). Rate limits are counted per client IP (`CF-Connecting-IP`) and per operation over every request, successes included, in the `__framework_auth_rate_limit` table (PWD §2).

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-241 | Mail sink retention | 1 day | owner | R2 lifecycle rule on the `prototype-mailsink` bucket (MAIL §2). The plan's PAR-240 is not used: it is retired (DEC-0077). |
| PAR-242 | Verify and reset submission rate limit | 10 per 60 s per IP | owner | BA paths `/verify-email`, `/reset-password`. The tokens cannot be guessed; this caps the cost. |
| PAR-243 | Default rate limit for other credential-library paths | 100 per 60 s per IP | owner | BA's fallback rule (`rateLimit.window`, `rateLimit.max`). |
| PAR-244 | Password hash | scrypt, N=16384, r=16, p=1, 64-byte key, 16-byte random salt; stored as `<salt hex>:<key hex>` | owner | BA's default, which on workerd is `node:crypto.scrypt`: about 72 ms CPU per hash or verify in local workerd (RESULT.md S2), so Workers Paid is required (DEC-0509). The deployed figure is spike S2's online part. |
| PAR-245 | Cloudflare Worker bundle size bound | 2 MiB (2,097,152 bytes) for the minified `worker.js` | owner | Checked by `build --target cloudflare` (CF-AC-003). The credential library with its adapter is about 600 KiB minified, 170 KiB gzip, with `better-auth/minimal` (RESULT.md); the bound fails fast on a dependency pulled in by mistake, far below Workers' limits (3 MiB Free, 10 MiB Paid, gzip). |
| PAR-254 | Minimum password length | 12 characters | owner | BA `minPasswordLength`; no composition rules (PWD-REQ-002). |
| PAR-255 | Maximum password length | 128 characters | owner | BA `maxPasswordLength`. |
| PAR-256 | Verification link validity | 24 hours | owner | BA `emailVerification.expiresIn: 86400`. The token is a stateless JWT and can be replayed within this time, which changes nothing (DEC-0516). |
| PAR-257 | Reset link validity | 1 hour | owner | BA `resetPasswordTokenExpiresIn: 3600`; single-use. |
| PAR-258 | Sign-in rate limit | 5 per 60 s per IP | owner | BA path `/sign-in/email`. |
| PAR-259 | Sign-up, forgot and resend rate limit | 3 per 300 s per IP | owner | BA paths `/sign-up/email`, `/request-password-reset`, `/send-verification-email`. |

## Provisioning

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-311 | Retention of a production stage's backup in `prototype-backups` | 30 days | owner | The bucket's lifecycle rule `framework-backups-retention` deletes every object this long after it was written (DEC-0543). Set by `setup-account`. |
| PAR-331 | Version of the Cloudflare permission list (`PERMISSIONS_VERSION`) | 1 | ai-proposed | `provision/cloudflare/permissions.ts` (DEC-0563). Raised by a release whose everyday or bootstrap token needs a permission the previous list lacked; setup then upgrades the everyday token in place. Release 1 of the setup wizard starts at 1. |
| PAR-332 | Version of the account setup this release expects (`ACCOUNT_SETUP_VERSION`) | 1 | ai-proposed | `provision/cloudflare/permissions.ts` (DEC-0563); compared with the account setup record's `setupVersion` (plan-setup-wizard §4.4). Raised by a release that needs more account setup. |
| PAR-340 | The Cloudflare settings file | `.env.cloudflare` in the project root (the app directory) | owner | Read after the environment by every Cloudflare command; holds `CLOUDFLARE_BOOTSTRAP_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_EMAIL_DOMAIN` and `CLOUDFLARE_ACCOUNT_ID` (DEC-0570, plan-setup-wizard §4.2). |
| PAR-341 | Mode of `.env.cloudflare` after every write | `600` (owner read and write only) | ai-proposed | Set by every framework write, also on an existing file with a wider mode (DEC-0571). Has no effect on Windows. |
| PAR-342 | The bootstrap token's line after use | `# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process` | owner | Replaces the `CLOUDFLARE_BOOTSTRAP_TOKEN=` line once the token has deleted itself (DEC-0571, plan-setup-wizard §4.2). |
| PAR-343 | The `.gitignore` marker that keeps setup from adding `.env.cloudflare` | `# keep-env-cloudflare-tracked` (a whole line of the project's `.gitignore`) | ai-proposed | Plan-setup-wizard §4.3 step 1; the warnings still print (DEC-0572). |
| PAR-360 | Time limit of each host of `cloudflare-setup`'s network check | 10 seconds | ai-proposed | `api.cloudflare.com`, the account's R2 storage host and its `workers.dev` subdomain; any HTTPS answer counts as reachable (plan-setup-wizard §4.3 step 8, DEC-0590). |
| PAR-361 | The setting naming API token IDs `cloudflare-setup` never updates or deletes | `PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS` (environment; comma-separated token IDs) | ai-proposed | Added to the command's `protectedTokenIds` (DEC-0589); the live pass lists the owner's token there. |

## Secrets

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-310 | Bound for a Cloudflare secret change to reach requests | 60 seconds | owner | SEC-AC-005 (DEC-0540, DEC-0562). A secret set or deleted reaches requests once the Worker version it rolls out serves them, a few seconds later (DEC-0092); the same value as the compliance harness's `CLOUD_WAITS.secretRolloutMs` (DEC-0431). |

## Log

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-260 | Maximum time a response waits for pending log writes | 2 seconds | ai-proposed | Matters on AWS, where a frozen Lambda would lose pending writes. |

## AWS deployment — deferred (branch `aws`)

Deferred to a later release (DEC-0508): these parameters belong to the AWS target, which is not part of release 1. Its code is on the branch `aws`.

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-060 | Default AWS region | `us-east-1` | ai-proposed | Used by `setup-account` unless another region is chosen there (SYS-REQ-023, DEC-0075). |
| PAR-270 | HTTP Lambda timeout | 55 seconds | ai-proposed | Must be below PAR-271 and above PAR-210 + PAR-260. |
| PAR-271 | API read timeout at the AWS router | 60 seconds | ai-proposed | Must exceed PAR-270. Already the maximum SST and CloudFront allow for `readTimeout`; raising it needs a CloudFront quota change (DEC-0438). |
| PAR-272 | HTTP Lambda runtime | `nodejs22.x` | ai-proposed | Matches PAR-111's Node.js 22. Set explicitly: SST's default is `nodejs24.x`. The managed runtime's patch level is AWS's choice (DEC-0433). |
| PAR-273 | HTTP Lambda architecture | `arm64` | ai-proposed | Lower cost; the bundle has no native modules. Set explicitly: SST's default is `x86_64` (DEC-0433). |
| PAR-274 | HTTP Lambda memory | 1024 MB | ai-proposed | SST's default, set explicitly. Lambda CPU scales with memory; at PAR-001's load the cost is negligible (DEC-0433). |
| PAR-275 | Data API resume backoff | Wait before retry n: random(0, min(5 s, 250 ms × 2ⁿ)) (base 250 ms, factor 2, cap 5 s, full jitter); retries stop when the next attempt would start after PAR-210 | ai-proposed | SQL-REQ-006 on AWS. A resume usually takes about 15 s; short early waits catch a resume in progress, the cap bounds the wasted wait, and jitter spreads concurrent retries. The SDK client's own retry is off (`maxAttempts: 1`) (DEC-0435, DEC-0452). |
| PAR-276 | HTTP Lambda bundle size bound | 4 MiB (4,194,304 bytes) for the minified `index.mjs` | ai-proposed | Checked by `build --target aws`. A framework app's bundle is about 0.6 MB; the bound fails fast on a large dependency pulled in by mistake, far below Lambda's own limits, and protects cold starts (DEC-0474). |

## AI skill

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-070 | Maximum size of the skill's top-level router document | 8,000 UTF-8 bytes | ai-proposed | |
| PAR-071 | Maximum size of each capability reference document | 12,000 UTF-8 bytes | ai-proposed | |
| PAR-072 | Maximum size of each complete example | 20,000 UTF-8 bytes | ai-proposed | |
| PAR-370 | How long `version-check` stays quiet about a newer npm release it has mentioned | 12 hours | ai-proposed | Stands for "once per session" (plan-setup-wizard §4.8a, DEC-0594): the mark is an empty file in the OS temp directory, keyed by the app folder and the release, so a cloud sandbox forgets it with the session and a computer after this long. |
| PAR-371 | Time limit of each `version-check` network lookup | 5 seconds | ai-proposed | The npm registry's latest version and the release tag's CHANGELOG (DEC-0594). A lookup that fails or runs out of time skips the npm row quietly. |

## Testing

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-280 | Floating-point comparison tolerance in compliance tests | `abs(actual − expected) ≤ max(1e-12, 1e-12 × abs(expected))` | ai-proposed | |
| PAR-281 | AWS-AC-005 wait for a paused cluster | 15 minutes (PAR-213 plus 10 minutes), polling every 30 seconds | ai-proposed | If the cluster has not observably paused by then, AWS-AC-005 is recorded not-run with the reason and the last observed state. Keeps one slow test under about 20 minutes (DEC-0437). Deferred (branch `aws`). |
| PAR-282 | AWS API calls by the cloud test hooks per compliance run | 2,000 | ai-proposed | `COMPLIANCE_AWS_MAX_RUN_CALLS` overrides it. Calls the framework CLI makes (deploy, remove, the leftover check) are not counted; a total above the cap fails the run (DEC-0501). Deferred (branch `aws`). |
| PAR-283 | Test-stage Aurora clusters at once in the AWS account | 3 | ai-proposed | The driver and the stage-lifecycle tests refuse a deploy that would exceed it and record the criteria not-run (DEC-0501). Deferred (branch `aws`). |
| PAR-284 | D1 budget of compliance testing on a Cloudflare Free account | Per pass ≤ 10,000 rows written and ≤ 500,000 read; per UTC day ≤ 50,000 written and ≤ 2,500,000 read; ≤ 8 test-stage D1 databases at once | owner | DEC-0419, kept as the Free budget by DEC-0530: half of Free's daily 100,000 written / 5,000,000 read (developers.cloudflare.com/d1/platform/pricing/), 8 of PAR-219's 10. Also applies when the plan is unknown. No test runs into it. |
| PAR-285 | D1 budget of compliance testing on a Cloudflare Workers Paid account | Per pass ≤ 100,000 rows written and ≤ 5,000,000 read; per UTC day ≤ 500,000 written and ≤ 25,000,000 read; ≤ 20 test-stage D1 databases at once | owner | DEC-0530. Workers Paid includes 50 million rows written and 25 billion read per month (developers.cloudflare.com/d1/platform/pricing/): 31 days at the daily cap use 31 % and 3.1 % of that. The plan is read from `GET /accounts/<account>/subscriptions` (rate plan `workers_paid`), else `COMPLIANCE_CLOUDFLARE_PLAN`, else Free (PAR-284). No test runs into it. |
| PAR-286 | Lifetime of a restricted test token the compliance driver creates | 6 hours | ai-proposed | A backstop: the driver deletes its `prototype-compliance-*` tokens at the end of every run, and the leftover check reports any still listed (DEC-0531). |

## Names

| ID | Parameter | Value | Category | Notes |
| --- | --- | --- | --- | --- |
| PAR-290 | Maximum app name length | 20 characters | ai-proposed | Lowercase letters and digits; no hyphens (stage names may contain hyphens). The length keeps names readable and log keys short. |
| PAR-291 | Maximum stage name length | 20 characters | ai-proposed | Lowercase letters, digits, hyphens. The length keeps names readable and log keys short. |
| PAR-320 | Random part of the `workers.dev` subdomain `setup-account` registers | 12 characters from `a`–`z` and `0`–`9`, after `pf-` | ai-proposed | Only on an account without a subdomain; drawn from the system's secure random source, never derived from the account ID or any personal data (DEC-0552). 36^12 names make a collision with another account's subdomain negligible; a refused registration names the subdomain, and a new run draws a new name. |

## Dependency pins

All pins are **ai-proposed**, except PAR-122, whose value the owner approved (DEC-0517). They were selected around October 9, 2026; spike A-10 installed and ran them together on Node 22.22.0 on 2026-10-19 and recorded the remaining pins (DEC-0104). A pin may be replaced when it cannot satisfy a requirement or a newer compatible version is preferable; record the new value here and rerun the affected acceptance criteria. Apps never change framework pins.

| ID | Dependency | Version | Notes |
| --- | --- | --- | --- |
| PAR-100 | SST | 4.17.2 | |
| PAR-101 | Wrangler | 4.149.0 | |
| PAR-102 | Drizzle ORM | 0.45.4 | |
| PAR-103 | drizzle-kit | 0.31.11 | |
| PAR-104 | Hono | 4.13.13 | |
| PAR-105 | aws4fetch | 1.0.20 | |
| PAR-106 | jose | retired | Was used only by GOOGLE (`src/google/`); retired with that code in implementation item I-G (DEC-0513). The framework no longer declares jose; the credential library brings its own copy as a dependency. The value was 6.2.12 (branch `google`). |
| PAR-107 | PGlite | 0.5.8 | |
| PAR-108 | @pulumi/cloudflare | 6.15.0 | The provider generation SST 4.17.2 pins. A direct framework dependency only if framework code imports it (DEC-0109). |
| PAR-109 | @pulumi/aws | 7.20.0 | The provider generation SST 4.17.2 pins. |
| PAR-110 | Aurora PostgreSQL engine | 17.x | The highest 17.x minor that the region supports with Data API and auto-pause, resolved at implementation start; verified per region by `setup-account` and deploy preflight. Deferred (branch `aws`). |
| PAR-111 | Node.js, TypeScript, ESLint, AWS SDKs | Node.js 22.22.0; TypeScript 6.0.3; ESLint 10.13.0 with typescript-eslint 8.72.0; @types/node 22.20.5 (framework and tests only); AWS SDKs: AWS SDK for JavaScript v3 3.1153.0 for every `@aws-sdk/client-*` the framework uses (ec2, iam, lambda, rds, rds-data, resource-groups-tagging-api, s3, secrets-manager, ssm, sts), and `@smithy/node-http-handler` 4.12.1 | TypeScript 7.x is outside typescript-eslint's supported range (`<6.1.0`), which CHECK's type-aware rules need (DEC-0104). `@typescript-eslint/utils` is declared at the typescript-eslint version (DEC-0243). AWS SDK: one version for every client, the one SST 4.17.2 resolves for `client-lambda`; the ten clients share one `@aws-sdk/core` (3.978.5); their transitive ranges are fixed by the root lockfile. `@smithy/node-http-handler` is the version already in the lockfile, imported directly by the Data API adapter. The HTTP Lambda bundle carries only rds-data and ssm, never the runtime's own SDK copy (DEC-0432, DEC-0451, DEC-0455, DEC-0472). (The AWS SDKs: deferred, branch `aws`; release 1 installs none.) |
| PAR-112 | Zod | 4.6.7 | Re-exported to apps (DEC-0059). Verified by spike A-10 (DEC-0104). |
| PAR-113 | Vite | 8.3.4 | Client build and local dev server; `/api` proxy to `wrangler dev` verified (DEC-0104). |
| PAR-114 | Playwright | `@playwright/test` 1.64.1; browser Chrome Headless Shell 156.0.8078.4 (`npx playwright install chromium`) | Browser-level compliance tests (DEC-0104). |
| PAR-116 | Test runner and test file glob | Vitest 5.0.5; app test glob `tests/**/*.test.ts` | The runner `verify` uses for the app test suite, once per supported dialect, and the glob that selects app test files. Framework unit tests `src/**/*.unit.test.ts`; Playwright specs `*.spec.ts`, so the globs never overlap (DEC-0104). |
| PAR-117 | Miniflare | 5.20261006.1-alpha | Exactly the version Wrangler (PAR-101) depends on, so there is one workerd; declared only if framework code imports Miniflare directly (DEC-0105). Moves with PAR-101. |
| PAR-118 | @cloudflare/workers-types | 5.20261006.1 | Framework dev dependency only, for Miniflare's type declarations; never in a `types` array (DEC-0105, CHECK §2). Moves with PAR-101. |
| PAR-119 | esbuild | 0.28.2 | Exactly the version Wrangler (PAR-101) depends on; a framework dependency so npm hoists it for Vite (PAR-113) and the build pipeline, while drizzle-kit keeps its own nested copy (DEC-0114). Moves with PAR-101. |
| PAR-120 | aws-sdk-client-mock | 4.1.0 | Framework dev dependency for AWS SDK unit tests; works with the PAR-111 clients (DEC-0432). Deferred (branch `aws`). |
| PAR-121 | @types/aws-lambda | 8.10.164 | Framework dev dependency only, for the Lambda entry's event and result types; the published declarations do not need it (DEC-0432, DEC-0468). Deferred (branch `aws`). |
| PAR-122 | better-auth | 1.7.7 (exact; `@better-auth/*` move in lock-step and are pinned exactly by it) | The newest version at least two weeks old on 2026-10-25, approved by the owner (DEC-0517). Move to 1.7.12 (the version spike BA-S1/S3 ran) only if a fix needed by the implementation is in 1.7.8–1.7.12, recording the fix in a decision entry. Peer range `drizzle-orm ^0.45.2`, met by PAR-102. Imported only as `better-auth/minimal` and `better-auth/adapters/drizzle` (DEC-0516). |
| PAR-330 | undici | 7.29.1 | Framework dependency for `check-login`'s one-connection dispatcher (`connections: 1`, through `EnvHttpProxyAgent` when a proxy variable is set), so that its burst leaves from one client IP (DEC-0561). Exactly the version Miniflare (PAR-117) depends on and the compliance harness pins, so there is one copy in the tree. Moves with PAR-101. |
