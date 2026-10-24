# Spike BA-S1/S3 (+ S2 offline): Better Auth on workerd/D1 and PGlite, the handler bridge, scrypt cost

This is throwaway proof code for `ai/implementation/plan-auth.md` §8: spikes S1 and S3, and the offline part of S2. It ran on 2026-10-24 on branch `claude/better-auth-spike` (from `claude/better-auth`).

- **No Cloudflare API call was made.** Everything ran in local workerd (Miniflare) and PGlite.
- `wrangler deploy --dry-run` ran with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` removed from the environment (`build.sh`).
- better-auth is NOT added to the framework package. It lives in this folder's own `package.json`.

## Verdict

| Question | Answer |
| --- | --- |
| S1: pinned BA on workerd + D1 through the Drizzle sqlite adapter, `__framework_auth_*` names, one instance per request | **Works.** 30/30 scenario checks pass (`logs/s1s3-workerd.log`). |
| S1: BA on PGlite through the Drizzle pg adapter in plain Node | **Works.** The same 30/30 (`logs/s1s3-pglite.log`). |
| S1: hand-written tables, no BA `migrate` | **Works.** Tables are in `sql/sqlite.sql`, `sql/pg.sql` and `src/schema-*.js`. The adapter's schema keys are the `modelName`s. |
| S1: is `nodejs_compat` required? | **Yes, in effect.** BA needs the real `node:crypto` and `node:async_hooks`. At the framework's `compatibility_date` 2026-10-01, workerd already exposes them **without** the flag. Set the flag explicitly anyway (details below). |
| S3: same sign-up response for a new and an existing email | **Yes.** Same status (200), same body shape, `token:null`, no Set-Cookie. The values differ (a synthetic random `user.id`, timestamps), so the framework must not echo BA's body. |
| S3: the token in the verification email verifies through a POST we construct | **Yes.** The framework's POST `{token}` makes the bridge send BA's **GET** `/verify-email?token=` server-side. Result: 200 `{status:true}`, no cookie, no session row. |
| S3: sign-in refused before verification, accepted after it with user.id and a token | **Yes.** 403 `EMAIL_NOT_VERIFIED` before; 200 `{token, user.id}` after. |
| S3: strip BA's Set-Cookie and delete the BA session row | **Yes.** BA sets `better-auth.session_token` and `better-auth.dont_remember`. The bridge copies no headers and deletes the row by token (1 → 0). |
| S3: reset flow | **Yes.** Forgot gives the same 200 body for an unknown email. The emailed token resets with 200 and is single-use (a second use gets 400). The old password then gets 401 and the new one 200. |
| S3: database rate limiter returns 429 through `auth.handler()` | **Yes.** With `storage:"database"`, the rows are in `__framework_auth_rate_limit`. One IP gets 5×401, then 429; another IP is unaffected. |
| S3: `baseURL` + `trustedOrigins` reject a forged Origin | **Partly.** Sign-in and sign-up get 403 `INVALID_ORIGIN`. **For forgot, reset and verify, BA checks Origin only when the request has a Cookie header.** So the framework's `forgeryCheck` (plan §1 "CSRF and origin") is the real defence, not a second layer. A forged Host or X-Forwarded-Host never changes the links in emails, because they come from `baseURL`. |
| S2: scrypt cost in local workerd | **About 72 ms CPU** per hash and per verify with BA's default, which on workerd *is* `node:crypto.scrypt`. A custom `node:crypto` hasher costs the same; pure-JS scrypt costs about 110–120 ms. |
| S2: Worker bundle size with BA | wrangler (unminified): **1268 KiB / 254 KiB gzip** (BA + drizzle + D1 Worker). Minified with esbuild: **595 KiB / 170 KiB gzip**. Drizzle-only baseline: 63 KiB / 17 KiB minified. |

## Versions

| Item | Version | Evidence |
| --- | --- | --- |
| better-auth | **1.7.12** (npm `latest`), published **2026-10-20T11:59:45.143Z** | From `registry.npmjs.org/better-auth`: dist-tags `latest 1.7.12`, `beta 1.8.0-beta.2`, `rc 1.7.0-rc.6`. Versions 1.7.8 to 1.7.12 were published between 10-14 and 10-20, about one patch every 1–3 days. |
| @better-auth/core, drizzle-adapter, utils, telemetry | 1.7.12 / 1.7.12 / 0.5.0 / 1.7.12 | Pulled in by better-auth, which pins `@better-auth/*` exactly; `better-call` 1.4.4. |
| drizzle-orm | 0.45.4 (repo version; BA's peer range is `^0.45.2`) | |
| @electric-sql/pglite | 0.5.8 (PostgreSQL 18.3) | repo version |
| miniflare / workerd | 5.20261006.1-alpha / 1.20261006.1 | repo versions |
| wrangler | 4.149.0 (repo root) | |
| esbuild | 0.28.2 | |
| Node | 22.22.0, on 4 vCPU Intel Xeon @ 2.10GHz | |

Version 1.7.12 is 4 days old. If the project has a minimum package-age rule, 1.7.7 (2026-09-30) is the newest version older than two weeks. Nothing in this spike depended on a change made in 1.7.8 or later.

## Layout and how to rerun

```
npm install --prefix ai/implementation/spikes/ba-s1-s3 --workspaces=false
sh ai/implementation/spikes/ba-s1-s3/build.sh                                  # wrangler dry-run -> dist/worker.js
sh ai/implementation/spikes/ba-s1-s3/build.sh wrangler-min.toml dist-min       # BA only (no custom hashers)
sh ai/implementation/spikes/ba-s1-s3/build.sh wrangler-nocompat.toml dist-nocompat
cd ai/implementation/spikes/ba-s1-s3
node run-workerd.mjs                                   # S1+S3 on workerd + D1        -> logs/s1s3-workerd.log
node run-pglite.mjs                                    # S1+S3 on Node + PGlite       -> logs/s1s3-pglite.log
NODE_ENV=test BA_DEFAULT_ORIGIN_CHECK=1 node run-pglite.mjs   # pitfall demo         -> 26/30
node probe-compat.mjs                                  # Node APIs per compat date/flag -> logs/probe-compat.log
node build-browser.mjs                                 # bundle without workerd/node conditions -> dist-browser/
node run-workerd.mjs dist-nocompat/worker-min.js "" 2026-08-01   # -> No such module "node:crypto"
node run-workerd.mjs dist-browser/worker-min.js "" 2026-08-01    # -> 30/30 with no Node APIs
node concurrency.mjs dist/worker.js                    # 12 concurrent sign-ups/sign-ins
node bench.mjs dist/worker.js 20                       # S2 timings        -> logs/s2-bench-workerd.log
node bench.mjs dist-browser/worker-min.js 20 2026-10-01 nodejs_compat default
node cross-verify.mjs                                  # hash formats interoperate
node size.mjs                                          # bundle breakdown   -> logs/s2-bundle-size-minimal.log
node instance-cost.mjs                                 # per-request instance cost (Node)
```

- `src/auth.js`: `makeAuth()`, one `betterAuth()` per request with the plan's options (below).
- `src/app.js`: the bridge (`rebuild` + `forward`) and the framework-style routes `POST /api/auth/password/{sign-up,verify,sign-in,forgot,reset}`. It also has spike-only `/spike/*` routes and `/raw/*`, an unbridged passthrough kept for comparison.
- `src/worker.js` (D1 binding `DB`, `drizzle-orm/d1`) and `run-pglite.mjs` (`drizzle-orm/pglite`) run the same app code.
- `src/schema-sqlite.js`, `src/schema-pg.js` and `sql/*.sql` hold the hand-written tables. `spike_outbox` stands in for MAIL's capture sender.
- `src/hashers.js` holds a custom `node:crypto.scrypt` hasher and a pure-JS (@noble) one, both in BA's format.
- `scenario.mjs` holds the 30 checks, shared by both runtimes. Each check is one HTTP request, so one BA instance.

The BA options used, which are what the framework would pass:

```js
betterAuth({                       // import from "better-auth/minimal", see problem P5
  baseURL: origin, basePath: "/api/auth/password", secret, trustedOrigins: [origin],
  telemetry: { enabled: false },
  database: drizzleAdapter(db, { provider: "sqlite" | "pg", schema }),   // schema keys = modelNames
  user: { modelName: "__framework_auth_user" }, session: { modelName: "__framework_auth_session" },
  account: { modelName: "__framework_auth_account" }, verification: { modelName: "__framework_auth_verification" },
  rateLimit: { enabled: true, storage: "database", modelName: "__framework_auth_rate_limit", window: 60, max: 100,
    customRules: { "/sign-in/email": {window:60,max:5}, "/sign-up/email": {window:300,max:3},
      "/request-password-reset": {window:300,max:3}, "/send-verification-email": {window:300,max:3},
      "/verify-email": {window:60,max:10}, "/reset-password": {window:60,max:10} } },
  advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] }, disableOriginCheck: false,
    backgroundTasks: { handler: ctx.waitUntil } },
  emailAndPassword: { enabled: true, requireEmailVerification: true, autoSignIn: false,
    minPasswordLength: 12, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 3600, sendResetPassword, onExistingUserSignUp },
  emailVerification: { sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false,
    expiresIn: 86400, sendVerificationEmail },
})
```

How the bridge works:
- It rebuilds every request as `new Request(origin + basePath + baPath)` with a JSON body.
- It copies only `Origin`, `cf-connecting-ip` and `User-Agent`, never `Cookie`, `Host` or `X-Forwarded-*`.
- It returns none of BA's headers.
- On a sign-in 200 it reads `body.user.id`, `body.user.name` and `body.token`, then runs `DELETE FROM __framework_auth_session WHERE token = ?`.

## Evidence

### S1 + S3 on workerd + D1 (`node run-workerd.mjs`, `logs/s1s3-workerd.log`)

```
workerd via miniflare; bundle=dist/worker.js; compatibility_date=2026-10-01; compatibility_flags=["nodejs_compat"]
PASS sign-up new email -> 200, token null, no Set-Cookie
      {"status":200,"body":{"token":null,"user":{"name":"Alice","email":"alice@example.test","emailVerified":false,...,"id":"NpqmVJ..."}},"setCookie":[]}
PASS sign-up existing email -> same status and same body shape
PASS existing-email sign-up got a different (synthetic) user.id
PASS outbox: one 'verify' mail (sign-up) + one 'existing' mail (onExistingUserSignUp)
PASS verify mail URL is built from baseURL
      "http://localhost:8787/api/auth/password/verify-email?token=<jwt>&callbackURL=%2F"
PASS sign-in before verification -> 403 EMAIL_NOT_VERIFIED
PASS sendOnSignIn re-sent a verify mail
PASS bogus verify token -> 401 INVALID_TOKEN, no Set-Cookie
PASS verify with mailed token -> 200 {status:true}, no session cookie (autoSignInAfterVerification:false)
PASS replaying the verify token -> still 200 (stateless JWT, not single-use)
PASS no BA session rows after verify
PASS sign-in after verification -> 200 with user.id and a session token
      {"status":200,"body":{"redirect":false,"token":"<32 chars>","user":{"name":"Alice",...,"emailVerified":true,"id":"NpqmVJ..."}}}
PASS BA set a cookie that the bridge stripped; BA session row deleted (1 -> 0)
      {"baSetCookie":["better-auth.session_token","better-auth.dont_remember"],"bridge":{"subject":"NpqmVJ...","displayName":"Alice","baSessionRowsBefore":1,"baSessionRowsAfter":0}}
PASS table counts after sign-in
PASS wrong password and unknown email give the same 401 body          {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
PASS forgot: same 200 body for existing and unknown email
PASS reset mail captured; URL built from baseURL                      "http://localhost:8787/api/auth/password/reset-password/<token>?callbackURL="
PASS reset with mailed token -> 200 {status:true}
PASS reset token is single-use -> 400 INVALID_TOKEN
PASS after reset: old password 401, new password 200
PASS password shorter than 12 -> 400 PASSWORD_TOO_SHORT
PASS sign-in burst from one IP: 5x 401 then 429                       [401,401,401,401,401,429,429]
PASS another IP is not limited
PASS rate-limit rows live in __framework_auth_rate_limit              [{"key":"192.0.2.99|/sign-in/email","count":5,...}]
PASS forged Origin on sign-in (rebuilt request) -> 403 INVALID_ORIGIN
PASS forged Origin on sign-up -> 403 INVALID_ORIGIN
PASS forged Origin on forgot (no cookie) -> BA does NOT reject (originCheck only runs with a Cookie header) [expected gap]
PASS raw (unbridged) forgot with forged Origin AND a Cookie header -> 403 (BA's check needs a Cookie; the bridge never forwards Cookie)
PASS raw passthrough with forged Host + Origin -> 403 INVALID_ORIGIN (trustedOrigins from baseURL, not Host)
PASS forged Host/X-Forwarded-Host: reset link still on baseURL
30/30 checks passed
```

The 429 body is `{"message":"Too many requests. Please try again later."}`, with the header `X-Retry-After` (not `Retry-After`).

### S1 + S3 on Node + PGlite (`node run-pglite.mjs`, `logs/s1s3-pglite.log`)

```
node v22.22.0; PGlite PostgreSQL 18.3; NODE_ENV=<unset>; baDefaultOriginCheck=false
... (same 30 checks) ...
30/30 checks passed
```

The pitfall run (`logs/s1s3-pglite-nodeenv-test-default-origin-check.log`) uses `NODE_ENV=test` and leaves out `advanced.disableOriginCheck:false`. It passes **26/30**:
- the forged-Origin sign-in returns 200 with a session token;
- the forged-Origin sign-up returns 200;
- the reset with a Cookie and a forged Origin is accepted.

With the explicit option, `NODE_ENV=test` passes 30/30 (`logs/s1s3-pglite-nodeenv-test.log`).

### nodejs_compat (`logs/probe-compat.log`, `logs/nocompat-*.log`)

What workerd 1.20261006.1 exposes, by compatibility date and flags:

```
2026-10-01 []                   node:crypto 76 exports (scrypt=function), node:async_hooks OK, process.getBuiltinModule OK
2026-10-01 ["nodejs_compat"]    same
2026-10-01 ["no_nodejs_compat"] same (the flag does not switch it off at this date)
2026-08-15 [] / 2026-09-01 []   same
2026-08-01 [] and earlier       ERR No such module "node:crypto" / "node:async_hooks", process undefined
2024-09-23 ["nodejs_compat"]    available
```

So Node APIs became the default between compatibility dates 2026-08-01 and 2026-08-15. The framework's `COMPATIBILITY_DATE` is 2026-10-01 (`packages/framework/src/build/build.ts`).

Why BA needs them: wrangler bundles with the `workerd` export condition. Under that condition:
- `@better-auth/utils/password` resolves to `password.node.mjs`, which has `import { scrypt, randomBytes } from "node:crypto"`;
- `@better-auth/core/async_hooks` resolves to the version that uses `process.getBuiltinModule("node:async_hooks")` or `import("node:async_hooks")`.

The wrangler bundle with BA only (`dist-min/worker-min.js`) imports `node:crypto` statically and `node:async_hooks` dynamically.
- At 2026-08-01 with no flag it fails to start: `Uncaught Error: No such module "node:crypto". imported from "dist-nocompat/worker-min.js"`.
- `wrangler deploy --dry-run` with `compatibility_flags = []` did *not* warn about this.

A bundle built **without** the `workerd`/`node` conditions (`build-browser.mjs`) passes 30/30 with no Node APIs at all. But it then uses:
- BA's `pure.index.mjs` AsyncLocalStorage *polyfill*: a single global "current store", so not safe with the concurrent requests one isolate serves;
- pure-JS scrypt, at about 1.6× the CPU.

`concurrency.mjs` (12 concurrent sign-ups and sign-ins) showed no cross-talk with either bundle, but the polyfill is unsafe by design.

**Conclusion:**
- Keep the real `node:async_hooks` and `node:crypto`.
- Set `nodejs_compat` explicitly: it documents the intent, survives a date change, and matches the plan.
- CF-REQ-003's bundle inspection must allow `node:crypto` and `node:async_hooks`. Once BA is imported from `better-auth/minimal`, they are the only `node:*` specifiers in the bundle.
- With the root `better-auth` import, the bundle also references `node:sqlite` (kysely adapter auto-detection).

### S2 offline: hash and verify cost in local workerd (`logs/s2-bench-workerd.log`)

The method:
- each figure is one request doing one hash, or one verify against a stored hash, N=20;
- wall time is measured around `dispatchFetch`, because workerd does not advance clocks during compute;
- CPU time is the `utime+stime` delta of the workerd process from `/proc` (10 ms ticks, averaged over N);
- each figure is net of a no-op request (wall about 3 ms, CPU about 2 ms).

```
bundle=dist/worker.js compatibility_date=2026-10-01 flags=["nodejs_compat"] N=20
default  hash   wall median    74.3 ms  p90    91.4 ms  cpu    72.5 ms   ok=null format=x{32}:x{128}
default  verify wall median    73.2 ms  p90    77.5 ms  cpu    71.5 ms   ok=true format=x{32}:x{128}
node     hash   wall median    73.7 ms  p90    77.1 ms  cpu    72.0 ms   ok=null format=x{32}:x{128}
node     verify wall median    73.8 ms  p90    78.6 ms  cpu    71.5 ms   ok=true format=x{32}:x{128}
noble    hash   wall median   132.2 ms  p90   151.1 ms  cpu   120.5 ms   ok=null format=x{32}:x{128}
noble    verify wall median   122.8 ms  p90   144.9 ms  cpu   110.5 ms   ok=true format=x{32}:x{128}

bundle=dist-browser/worker-min.js (BA default resolves to @noble pure JS)
default  hash   wall median   123.4 ms  p90   142.4 ms  cpu   115.0 ms
default  verify wall median   122.5 ms  p90   135.6 ms  cpu   110.0 ms
```

What the figures show:
- **The custom hasher brings no speed-up.** `default` means BA's own `hashPassword`/`verifyPassword`, and in a wrangler bundle that is already `node:crypto.scrypt`. So the custom `node` hasher (`src/hashers.js`) costs the same. Its only gain is a constant-time compare, since BA compares hex strings with `===`.
- **All three hashers share one format:** `<16-byte salt as 32 hex>:<64-byte key as 128 hex>`.
  - Parameters: scrypt N=16384, r=16, p=1, dkLen=64.
  - The salt *hex string* is the scrypt salt, and the password is NFKC-normalised.
  - `cross-verify.mjs` shows every hasher verifies every other's hash (true) and rejects a wrong password (false) (`logs/s2-cross-verify-node.log`).
- **About 75 ms CPU per auth request locally**, against Workers Paid's 30 s default; it would not fit the Free plan's 10 ms. The hashing per request is:
  - sign-up: 1 hash, deliberately also for an existing email;
  - sign-in: 1 verify, and BA also hashes for an unknown email;
  - reset: 1 hash.
- **The figure on a deployed Worker is still open**: it is the online part of S2.
- **Building an instance per request is negligible** (Node, `logs/instance-cost-node.log`):
  - `betterAuth()` takes 0.15 ms;
  - construction plus a first request takes 4.1 ms, against 3.5 ms on a reused instance;
  - so building it costs about 0.6 ms per request.

### Bundle size (`logs/wrangler-dry-run*.log`, `logs/s2-bundle-size-minimal.log`)

| Bundle | wrangler dry-run (unminified) | esbuild minified |
| --- | --- | --- |
| drizzle-d1 baseline (no BA) | — | 62.8 KiB / gzip 17.0 KiB |
| BA from `better-auth/minimal` + drizzle adapter (`worker-min`) | 1268.2 KiB / gzip 253.8 KiB | 594.9 KiB / gzip 169.6 KiB |
| same + custom hashers + @noble scrypt (`worker`) | 1280.3 KiB / gzip 257.3 KiB | — |
| BA from the root `better-auth` (first build, `logs/s2-bundle-size-root-import.log`) | 1981.9 KiB / gzip 361.3 KiB | 821.9 KiB / gzip 221.1 KiB |

The largest minified parts, with the minimal import:

| Package | Minified |
| --- | --- |
| better-auth | 166 KiB |
| @better-auth/core | 122 KiB |
| zod | 98 KiB |
| drizzle-orm | 69 KiB |
| jose | 43 KiB |
| better-call | 19 KiB |
| drizzle-adapter | 15 KiB |
| @noble/ciphers | 13 KiB |
| telemetry (bundled even with `telemetry.enabled:false`) | 9 KiB |
| @noble/hashes | 9 KiB |

The root import adds kysely (185 KiB) and the kysely adapter (23 KiB). All of these are far below the Workers limits (3 MiB on Free and 10 MiB on Paid, gzip).

## Problems found

- **P1. BA disables its origin check under `NODE_ENV=test`, or when `TEST` is truthy.**
  - `skipOriginCheck` defaults to `isTest()`, so under vitest (`createTestApp`) BA's Origin and CSRF checks are silently off.
  - Fix: always pass `advanced.disableOriginCheck: false` (shown above: 26/30 becomes 30/30).
  - `isTest` reads `process.env` when the module loads.
- **P2. `rateLimit.enabled` defaults to `NODE_ENV === "production"`.** So it is off in dev, in tests, and in a Worker without NODE_ENV. Always pass `enabled: true`.
- **P3. BA's Origin check is not a general CSRF defence.**
  - Sign-in and sign-up (`formCsrfMiddleware`) validate Origin whenever an Origin, Referer or Sec-Fetch-* header is present.
  - `request-password-reset`, `reset-password` and `send-verification-email` validate it only when the request carries a `Cookie` header, which the bridge never forwards.
  - `verify-email` is a GET, so it is never checked.
  - A sign-in with no Origin at all passes BA.
  - So the plan's extended `forgeryCheck` (Origin required on every `/api/auth/*` POST) is required, not optional.
- **P4. Verify is a GET with a stateless JWT.**
  - `/verify-email?token=` exists only as a GET. The framework's POST verify must call it server-side as a GET, as this spike does.
  - The token is an HS256 JWT signed with the BA secret. It is not stored in `__framework_auth_verification`, so it can be replayed until `expiresIn`.
  - A replay changes nothing: it answers 200 and, with `autoSignInAfterVerification:false`, creates no session.
  - Reset tokens, by contrast, are stored and single-use.
- **P5. `import { betterAuth } from "better-auth"` bundles kysely and a `node:sqlite` reference.** This comes from adapter auto-detection and adds about 227 KiB minified. Import from `better-auth/minimal`, with `better-auth/adapters/drizzle`.
- **P6. The rate limiter counts every request, not just failures.**
  - "429 after N failures" (plan §3 step 7) really means after N requests from that IP to that path in the window, successes included.
  - Each bridged request costs 1–3 extra D1 queries: a read, an increment or insert, and now and then a prune.
- **P7. The rate-limit key is `ip|path`.**
  - Without `cf-connecting-ip`, every client falls into one shared `no-trusted-ip` bucket per path, which lets anyone lock everyone out.
  - The bridge must forward `cf-connecting-ip`. Cloudflare's edge sets it, so it cannot be spoofed there.
  - `createTestApp` and `dev` must supply one, for example 127.0.0.1 or a value per test. Without it, the tests share buckets.
- **P8. `sendOnSignIn: true` sends a verification email on every refused sign-in.**
  - Only the sign-in limit (5 per 60 s per IP) bounds it, so an attacker can use up the Email Service quota (S4) from many IPs.
  - Options: `sendOnSignIn:false` plus the explicit `password/resend` route (3 per 300 s), or a per-address cap in MAIL.
- **P9. Sign-up response bodies differ in their values.**
  - The duplicate response is synthetic: a random `id`, current timestamps, and the submitted `name`/`email` echoed back.
  - The shape and status are identical.
  - The framework must answer with its own uniform 303 or JSON and never forward BA's body.
- **P10. Logging can expose an address.**
  - BA logs `Sign-up attempt for existing email: <email>` at `info`. That is hidden at the default `warn` level.
  - It also warns `Invalid password` and `User not found`, which carry no address.
  - Pass a `logger` that maps to LOG codes with no message text, or `logger: { level: "error" }`, so an address can never reach the logs.
- **P11. Constant-time compare.** BA's default `verifyPassword` compares hex with `===`. The custom `node:crypto` hasher uses `timingSafeEqual` at the same cost, so it is optional hardening, not needed for CPU.
- **P12. Miniflare 5 (the repo's 5.20261006.1-alpha) rejects v4-style options.** It needs `workers:[{config:…}]`, or `convertV4MiniflareOptions({...})` as used here. This matters for any framework test harness written against the v4 API.
- **P13. BA warns when the secret has low entropy.** It only logs. With 32 random bytes (the plan's `frameworkAuthSecret`) it stays silent.

## Recommended parameter values (PARs) and plan changes

| PAR | Value | Note |
| --- | --- | --- |
| PAR-122 better-auth | **exact `1.7.12`** (published 2026-10-20) | Or `1.7.7` if a two-week package-age rule applies. Pin exactly, because the `@better-auth/*` packages move in lock-step. BA's peer range `drizzle-orm ^0.45.2` is met by 0.45.4. |
| PAR-254 minimum password length | 12 | `minPasswordLength`; enforced (400 `PASSWORD_TOO_SHORT`). |
| PAR-255 maximum password length | 128 | `maxPasswordLength`. |
| PAR-256 verification link validity | 24 h (`emailVerification.expiresIn: 86400`) | The JWT can be replayed within this time (P4); that is harmless. |
| PAR-257 reset link validity | 1 h (`resetPasswordTokenExpiresIn: 3600`) | Single-use; verified. |
| PAR-258 sign-in rate limit | 5 per 60 s per IP (`/sign-in/email`) | Verified: 5×401, then 429. It counts all requests (P6). |
| PAR-259 sign-up/forgot/resend rate limit | 3 per 300 s per IP (`/sign-up/email`, `/request-password-reset`, `/send-verification-email`) | |
| new: verify/reset submit limit | 10 per 60 s per IP (`/verify-email`, `/reset-password`) | The tokens can't be guessed; this only caps the cost. |
| new: global default rate limit | `window 60, max 100` | BA's fallback for any other BA path. |
| new: scrypt parameters | N=16384, r=16, p=1, dkLen=64, 16-byte salt (BA's default) | About 72 ms CPU per operation in local workerd. Keep BA's default hasher, which is node:crypto on workerd. Or use the custom one, in the same format, for a constant-time compare. |
| new: BA bundle budget | about 600 KiB minified / 170 KiB gzip with `better-auth/minimal` | Optionally add a Cloudflare bundle bound like PAR-276. |
| Cloudflare settings | `compatibility_flags: ["nodejs_compat"]`, date 2026-10-01 | Node APIs are on at this date anyway (see "nodejs_compat" above). CF-REQ-003 must allow `node:crypto` and `node:async_hooks`. |
| BA options | `advanced.disableOriginCheck:false`, `rateLimit.enabled:true`, `advanced.backgroundTasks.handler = ctx.waitUntil`, `advanced.ipAddress.ipAddressHeaders:["cf-connecting-ip"]`, a custom `logger` | Fixes P1, P2, P7 and P10. `backgroundTasks` is how the sends go into `waitUntil` (plan §2). |

Plan text to adjust:
- §1 "Worker settings": the reason is `node:crypto` (scrypt) plus a real `node:async_hooks` under the `workerd` export condition, not only AsyncLocalStorage.
- §1 "CSRF and origin": BA's trustedOrigins is not a second layer for forgot, reset or verify (P3).
- §3 step 7: say "a burst of requests" rather than "a burst of wrong passwords" (P6).
- §4: the CPU risk is settled locally, at about 72 ms per operation with no custom hasher needed. Add P8 (sendOnSignIn and the email quota) to the open risks.
