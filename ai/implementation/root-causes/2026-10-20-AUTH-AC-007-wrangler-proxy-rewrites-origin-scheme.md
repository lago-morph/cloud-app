# Root cause: AUTH-AC-007 through `dev` — wrangler's dev proxy rewrites `Origin: https://localhost:<port>` to `http://…` because Vite forwards the browser's `Host`

Author: diagnosing subagent (prompt §8 step 1; did not write the code or the tests). Diagnosis only; no code or test changed. Needs independent review (§8 step 2) before any fix.

## Symptom
`npm run compliance -- --target local --only FILES-AC-004,AUTH-AC-007` (branch `claude/implement-local-cloudflare-diag-c1` = `origin/claude/implement-local-cloudflare` `258418d`; reference app `apiKey` set with a generated dummy value via `npm run secrets -- set apiKey --target local --stage local`):

```
FAIL tests/compliance/criteria/auth/forgery.test.ts > AUTH-AC-007 through the deployed router > [AUTH-AC-007] through the deployed router: a POST with a session and a wrong Origin is rejected with AUTH.REQUEST_FORGERY
HttpCheckError: HTTP check failed: POST /api/levels/user → status 200, code none, requestId none (expected status 403 with code AUTH.REQUEST_FORGERY)
```
The no-Origin, public-origin and in-process tests passed. C-T3's DEC-PENDING-C-T3-11 recorded that the failing origin is the other scheme, `https://localhost:<dev port>`.

## Evidence
1. **Reproduced** with the command above (1 of 1 runs).
2. **Live `dev`** (Vite on `127.0.0.1:41405`, wrangler on `127.0.0.1:44991`, `FRAMEWORK_PUBLIC_ORIGIN=http://localhost:41405`), `POST /api/levels/user` with a `session_local` cookie from `/api/auth/mock-login`:

   | path | `Host` sent | `Origin` | result |
   |---|---|---|---|
   | via Vite | `localhost:41405` | `http://localhost:41405` | 200 |
   | via Vite | `localhost:41405` | `https://localhost:41405` | **200** |
   | via Vite | `localhost:41405` | `https://evil.example`, `http://localhost:1`, `HTTP://LOCALHOST:41405` | 403 `AUTH.REQUEST_FORGERY` |
   | wrangler direct | `127.0.0.1:44991` | `https://localhost:41405` | 403 `AUTH.REQUEST_FORGERY` |
   | wrangler direct | `localhost:41405` | `https://localhost:41405` | **200** |
   | wrangler direct | `localhost:41405` | `https://evil.example` | 403 |

   The acceptance depends only on the `Host` that reaches wrangler, not on Vite.
3. **Vite forwards `Host` and `Origin` unchanged**: `dev`'s proxy is `{ target: apiTarget, changeOrigin: false }` (`packages/framework/src/cli/dev/runtime.ts` line 129). Minimal Vite with the same options in front of a plain Node echo server (scratchpad `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/repro-origin/vite-proxy.mjs`, `echo.mjs`): `Host: localhost:47100`, `Origin: https://localhost:47100` arrive at the echo server as `host: localhost:47100`, `origin: https://localhost:47100`.
4. **wrangler 4.149.0's ProxyWorker rewrites the header** (`node_modules/wrangler/wrangler-dist/ProxyWorker.js`): `processQueue` (lines 117–131) sets `outerUrl = new URL(request.url)` (host = the incoming `Host`), `innerUrl = urlFromParts(userWorkerInnerUrlOverrides ?? {}, request.url)` and calls `rewriteUrlRelatedHeaders(headers, outerUrl, innerUrl)`. That function (line 300) rewrites every header whose value contains `from.host`, via `rewriteUrlInHeaderValue` (line 24): each `https?://host…` whose `new URL(origin).host === from.host` is replaced by `to.origin + rest`. The scheme is not compared, and `to.origin` is the inner URL's origin (`http:`), so `https://localhost:41405` becomes `http://localhost:41405`. The pre-check `value.includes(from.host)` is case-sensitive, which is why `HTTP://LOCALHOST:41405` is not rewritten (evidence 2). The generated `apps/reference/.framework/local/wrangler.jsonc` has no routes, so there are no inner-URL overrides.
5. **Minimal reproduction of the rewrite** (scratchpad `repro-origin/worker.js`: a Worker that echoes `request.url`, `Origin`, `Referer`, `Host`; run with the repo's `wrangler dev --local`, port 47120):
   ```
   Host=localhost:47130 Origin=https://localhost:47130   -> origin "http://localhost:47130"   (rewritten)
   Host=localhost:47130 Origin=https://localhost:47130/x -> origin "http://localhost:47130/x" (rewritten)
   Host=localhost:47130 Origin=HTTP://LOCALHOST:47130    -> unchanged
   Host=localhost:47130 Origin=http://localhost:1        -> unchanged
   Host=127.0.0.1:47120 Origin=https://localhost:47130   -> unchanged
   ```
   (`Referer` is rewritten the same way.) Through the full chain: Vite with `changeOrigin: false` → wrangler → Worker sees `origin: http://localhost:47104` for a sent `https://localhost:47104`; Vite with `changeOrigin: true` → Worker sees `host: 127.0.0.1:47120`, `origin: https://localhost:47103` (unchanged).
6. **The Worker's check is correct**: `packages/framework/src/auth/runtime.ts` lines 125–133 compare `c.req.header("origin")` with `originOf(c)` = `new URL(FRAMEWORK_PUBLIC_ORIGIN).origin`; it rejects `https://localhost:41405` when that header reaches it unmodified (evidence 2, wrangler direct with wrangler's own `Host`), and the in-process tests pass.
7. **Spec**: AUTH-REQ-007: rejected "unless its `Origin` header equals the deployment's public origin"; AUTH-AC-007: "… rejected when `Origin` is missing or wrong … both directly and through the deployed router." `https://localhost:<port>` is not equal to `http://localhost:<port>`, so the test's expectation is right.

## Causal chain
1. `dev`'s Vite proxy uses `changeOrigin: false`, so wrangler receives the browser's `Host: localhost:<dev port>` (evidence 3).
2. wrangler's ProxyWorker takes the outer URL's host from that `Host` and rewrites every header URL with that host to the inner origin, ignoring the scheme (evidence 4, 5).
3. `Origin: https://localhost:<dev port>` therefore reaches the Worker as `http://localhost:<dev port>`, equal to `FRAMEWORK_PUBLIC_ORIGIN` (evidence 5).
4. The Worker's forgery check passes and the route answers 200 → the test's "wrong Origin" assertion fails for the other-scheme origin (symptom; evidence 2 shows 200 exactly when `Host` = `localhost:<dev port>`).

## Alternatives ruled out
- **Vite rewrites or drops `Origin`**: echo backend shows it unchanged (evidence 3).
- **The Worker's comparison is lax** (e.g. compares hosts): the same header sent to wrangler with wrangler's own `Host` is rejected (evidence 2), and the code is a strict string comparison (evidence 6).
- **Other wrong origins are affected**: only URLs whose host equals the incoming `Host` (case-sensitively) are rewritten; evil, other-port and upper-case origins are still rejected through `dev` (evidence 2). The test's loop stops at its first failure (the other-scheme origin, 4th in its list), so the remaining origins were not exercised by the run; the rewrite rule (evidence 4) cannot map them to the public origin.
- **Test error**: see evidence 7.

## Proposed fix
`packages/framework/src/cli/dev/runtime.ts` (`startClient`): proxy `/api` with `changeOrigin: true`, so wrangler receives `Host: 127.0.0.1:<worker port>`; then the ProxyWorker only rewrites URLs naming the Worker's own loopback address, which a browser never sends as `Origin` for the app. Vite's host check still runs on the browser's `Host` before the proxy (LOCAL-REQ-004 unchanged). Nothing in the Worker derives anything from `Host` / `request.url` except query parameters (`auth/runtime.ts` line 174; public origin comes from `FRAMEWORK_PUBLIC_ORIGIN`), and response-header rewriting then only touches URLs with the Worker's own host. Red-green: first a test through a running `dev` (e.g. alongside `packages/framework/test/integration/http/dev-paths.test.ts`) posting with a session and `Origin: https://localhost:<port>` expecting 403 `AUTH.REQUEST_FORGERY`. No change to `tests/compliance/`.

Simulated fix (wrangler of the live `dev` called with `Host: 127.0.0.1:44991`, what `changeOrigin: true` sends): `https://evil.example`, `null`, `http://localhost:41405.evil.example`, `https://localhost:41405`, `http://localhost:1`, `http://localhost:41405/`, `HTTP://LOCALHOST:41405`, no Origin → all 403; `http://localhost:41405` → 200; `GET /api/auth/login?returnTo=/x` → 302 `Location: /x` (relative, unaffected).

## Verification plan
1. New red test fails before the change, passes after.
2. `npm run compliance -- --target local --only AUTH-AC-007` passes (all four tests).
3. Regression: compliance on `local` for AUTH-AC-006/-009, HTTP-AC-001, FILES-AC-003/-004/-006, E2E-009 and `npm run smoke` against `dev` still pass (cookies, login redirects, transfers through the changed proxy); `npm run verify` passes.

## Review

**Verdict: ACCEPTED.** Reviewer: independent subagent (prompt §8 step 2). It did not diagnose this failure or write the code or tests, and it changed no code or tests. Reviewed on branch `claude/implement-local-cloudflare-rc-c1-review` (base `be0cfe6`), Vite 8.3.4, wrangler 4.149.0.

**Reproduction.** The same compliance command failed `[AUTH-AC-007] through the deployed router: … wrong Origin …` with `status 200, code none` (expected 403). The other 3 AUTH-AC-007 tests passed.

**Links checked against the source.**
- Link 1: `runtime.ts` line 129 uses `changeOrigin: false`. Vite's http-proxy sets `outgoing.headers.host` only when `changeOrigin` is true (`node.js` line 18988). Vite rewrites `Origin` only for WebSocket upgrades with `rewriteWsOrigin` (`rewriteOriginHeader`, lines 19899–19910, hooked on `proxyReqWs` only), so the HTTP `Origin` passes through unchanged. Confirmed.
- Link 2: in wrangler's `ProxyWorker.js` `processQueue`, `outerUrl = new URL(request.url)` and `innerUrl = urlFromParts(overrides ?? {}, request.url)`. `rewriteUrlRelatedHeaders(headers, outerUrl, innerUrl)` then calls `rewriteUrlInHeaderValue`. That function compares only `url.host`, never the scheme, and substitutes `to.origin`, which is `http:`. The pre-filter `value.includes(from.host)` is case-sensitive. Confirmed exactly as described.
- Links 3–4: `auth/runtime.ts` line 130 compares the received `origin` header strictly against `new URL(FRAMEWORK_PUBLIC_ORIGIN).origin`. Since the header arrives already rewritten, the 200 follows.

**Alternatives.** I agree they are ruled out. Vite does not touch the HTTP `Origin` (code above). The Worker's comparison is strict (code and in-process tests). The test is right, because AUTH-REQ-007 requires equality with the public origin. A Worker-side fix cannot work, because the Worker never sees the original header.

**Fix addresses the cause.** With `changeOrigin: true`, `Host` and therefore `outerUrl` become `127.0.0.1:<worker port>`. The rewrite then fires only for header URLs naming the Worker's own loopback address. Experiment against `dev` running both proposed changes, patched into the gitignored `dist/` only (source untouched, rebuilt afterwards):
- The compliance `forgery.test.ts` passes 4/4.
- With a real session cookie: `Origin` `http://localhost:<port>` gets 200. `https://localhost:<port>`, `HTTP://LOCALHOST:<port>`, `http://localhost:1`, `http://127.0.0.1:<worker port>`, `https://127.0.0.1:<worker port>`, `https://evil.example`, `null` and a missing `Origin` all get 403 `AUTH.REQUEST_FORGERY`. The `https://127.0.0.1:<worker>` value would be rewritten to `http://127.0.0.1:<worker>`, which still is not the public origin, so the residual rewrite cannot produce an accept.

**Side effects checked.**
- **LOCAL-AC-004 Host check.** `hostValidationMiddleware` and `dev`'s `configureServer` host-check middleware are installed before `proxyMiddleware` (`node.js` 25087–25101). They read the incoming request's `Host`; `changeOrigin` changes only the outgoing proxy request. Live, `Host: evil.example:<port>` got 403 on `/api/levels/user` and on `/`. The proxy has no `ws: true`, so `/api` upgrades are not proxied in either setting.
- **Public origin the framework sees.** `originOf` uses `FRAMEWORK_PUBLIC_ORIGIN`, not `Host`. The only use of `c.req.url` is `searchParams` in the callback (`auth/runtime.ts` line 174). The Worker's `request.url` / `MF-Original-URL` host changes to `127.0.0.1:<worker port>`, but nothing reads its host.
- **Login, callback and cookies.** `callbackUrl` is built from the public origin. `GET /api/auth/login?returnTo=/x` returned 302 `Location: /x` with `session_local=…; Path=/; HttpOnly; SameSite=Lax` and no `Domain`. With no `Domain`, wrangler's Set-Cookie `Domain=` rewrite has nothing to change, and the browser scopes the cookie to `localhost:<port>`. `/api/auth/me` returned the session user, and logout returned 204 and cleared the cookie. Response-header rewriting is a no-op both before and after the change, because `innerUrl` and `outerUrl` share a host when there are no overrides.
- **Local file-transfer route.** Tickets are relative paths (`files/local/tickets.ts` lines 43 and 48). The ticket upload and read-back worked by curl, and all FILES and E2E-009 browser specs passed through the changed proxy.
- **Worker logs.** Entries carry method and the route path (`log/request.ts` line 12, `http/errors.ts`), not host or URL. After the run, no entry in `apps/reference/.logs/` contained the Worker's `127.0.0.1:<port>`.
- **Other compliance tests run against this `dev`.** Of the auth/http/files/log vitest criteria, 42 passed. 3 failed for unrelated reasons: FILES-AC-005 is a Cloud-only criterion that the harness does not select for `local`, and the 2 LOG-AC-004 tests raise `PREREQUISITE MISSING` for D-T2 hooks.
- **Not run by this review.** `npm run smoke` and the full `npm run verify`.

**Verification plan.** Adequate. Its regression list, especially `npm run smoke` against `dev` and `npm run verify`, should be run by the fixer and evaluator. The red-green test should post through a running `dev`, not straight to wrangler.

## Fix

Fixing subagent (prompt §8 step 3), branch `claude/implement-local-cloudflare-fix-c1` from `origin/claude/implement-local-cloudflare`. Commit `69ae283`.

- **Change.** `packages/framework/src/cli/dev/runtime.ts` (`startClient`): the `/api` proxy uses `changeOrigin: true`, so wrangler receives `Host: 127.0.0.1:<worker port>`. Vite's host check still reads the browser's `Host` before the proxy. docs/components/cli.md's `dev` paragraph records this.
- **Red.** New unit test `packages/framework/src/cli/dev/runtime.unit.test.ts` `[AUTH-AC-007] proxies /api with the Worker's own Host…` checks the proxy entry passed to Vite's `createServer`. Before the change it failed with `- "changeOrigin": true / + "changeOrigin": false`.
- **Green.** After the change it passes. `npm run verify` passes.
- **Compliance (informational, evidence not committed).** The same run as the FILES-AC-004 record: AUTH-AC-007 passed all 4 tests, including `through the deployed router: … wrong Origin`. LOCAL-AC-004, FILES-AC-003, FILES-AC-004, FILES-AC-006 and E2E-009 also passed. HTTP-AC-004 is Cloud-only and was ignored.
- **Smoke.** The template's `smoke --target local` passed 4/4 through the changed proxy, covering health, the public read, the note write/read with the mock session, and the status write/read. The first attempt's `SEC.MISSING` health failure was a local secret that had not been set. It was resolved by setting a dummy `apiKey`.
