# Root cause: FILES-AC-004 browser part — `dev`'s Vite server adds CORS allow headers for loopback origins, so an unrelated `127.0.0.1` page can use the app's tickets

Author: diagnosing subagent (prompt §8 step 1; did not write the code or the tests). Diagnosis only; no code or test changed. Needs independent review (§8 step 2) before any fix.

## Symptom
`npm run compliance -- --target local --only FILES-AC-004,AUTH-AC-007` (branch `claude/implement-local-cloudflare-diag-c1` = `origin/claude/implement-local-cloudflare` `258418d`; reference app `apiKey` set with a generated dummy value through `npm run secrets -- set apiKey --target local --stage local`):

```
[integration] › tests/compliance/criteria/files/transfers.spec.ts:123:1 › [FILES-AC-004] browser part: an upload and a download attempted from an unrelated origin are rejected by the browser
  Error: the unrelated origin's upload stored a file
    Received: {"contentType": "image/png", "name": "c-t3/ac004-origin/1fae9da2785c/foreign.png", "size": 128}
  Error: download from the unrelated origin
    -   "ok": false,  "status": null,
    +   "ok": true,   "status": 200,
```
(plus the dependent soft assertions on `up.message` / `down.message`, which are `undefined` because both transfers succeeded). The same-origin control in the same test passed. C-T3's DEC-PENDING-C-T3-6 recorded the same observation.

## Evidence
1. **Reproduced** with the command above (1 of 1 runs; C-T3 observed it earlier on 2026-10-20).
2. **`dev`'s client server** (`packages/framework/src/cli/dev/runtime.ts` lines 101–131, `startClient`) calls Vite `createServer` with `configFile: false` and a `server` block of `host`, `port`, `strictPort`, `allowedHosts: []`, `proxy` — **no `cors` key**.
3. **Vite 8.3.4's default** (`node_modules/vite/dist/node/chunks/node.js`): line 804 `const defaultAllowedOrigins = /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;`, line 25196 default server options `cors: { origin: defaultAllowedOrigins }`, line 25085 `if (cors !== false) middlewares.use(cors(...))`. That middleware is installed before the proxy (line 25098) and before plugin `configureServer` middlewares (line 25088ff), so it applies to `/api/*` and answers preflights itself.
4. **Live `dev` (reference app, Vite on 41405, wrangler on 44991)**, curl with `Host: localhost:41405`:
   ```
   OPTIONS /api/__framework/files/x via Vite, Origin http://127.0.0.1:1234, ACRM PUT, ACRH content-type
     → 204, Access-Control-Allow-Origin: http://127.0.0.1:1234, Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE, Access-Control-Allow-Headers: content-type
   same, Origin http://evil.example            → 204, no Access-Control-Allow-Origin
   same, sent to wrangler directly (44991)     → 405, no Access-Control-* headers
   PUT  /api/__framework/files/x (bad token) direct to wrangler, Origin http://127.0.0.1:1234 → 403, no Access-Control-* headers
   PUT  same via Vite                          → 403, Access-Control-Allow-Origin: http://127.0.0.1:1234, Vary: Origin
   ```
   The Worker (behind wrangler) sends no CORS headers and does not answer `OPTIONS`, as DEC-0161 "No CORS" specifies; the headers appear only at the Vite layer, and only for loopback-shaped origins — exactly Vite's default regex.
5. **Minimal reproduction without the framework** (scratchpad `/tmp/claude-0/-home-user-cloud-app/b6482c07-38ed-5065-a51e-6194e2f52fc3/scratchpad/repro-origin/`): `echo.mjs` (plain Node server echoing request and headers, no CORS) behind `vite-proxy.mjs` (Vite with `dev`'s exact `server` options). Preflight via Vite from `http://127.0.0.1:1234` → 204 with `Access-Control-Allow-Origin: http://127.0.0.1:1234`; the echo server itself answers the same `OPTIONS` with `200 application/json` and no CORS headers. So Vite, not the backend, produces the headers.
6. **Experiment toggling only `cors`** (`browser-cors.mjs`, Chromium via the repo's Playwright): page at `http://127.0.0.1:47101`, `fetch(PUT, Content-Type: image/png)` to `http://localhost:<vite>/api/__framework/files/x`:
   ```
   47100 default cors {"ok":true,"status":200,...}       ← request reached the backend
   47102 cors:false   {"error":"TypeError: Failed to fetch"}
   ```
   and curl of the `cors: false` instance's preflight: the `OPTIONS` is proxied to the backend and returns no `Access-Control-*` headers.
7. **Spec**: files.md §2 Local: "Tickets point to a same-origin framework route … There is no cross-origin traffic"; "The route sends no CORS headers, so other origins cannot use it." FILES-AC-004: "A transfer attempted from an unrelated origin is rejected by the browser." HTTP-REQ-004 / DEC-0006: one origin, no CORS. `http://127.0.0.1:<port>` is a different origin from `http://localhost:<dev port>` (scheme/host/port tuple), so it is an unrelated origin.

## Causal chain
1. `startClient` leaves `server.cors` unset → Vite uses its default `{ origin: defaultAllowedOrigins }` (evidence 2, 3).
2. Vite's CORS middleware runs for every request, including `/api/*` before the proxy, and reflects any origin matching the loopback regex in `Access-Control-Allow-Origin`, answering preflights itself with `PUT` and the requested headers allowed (evidence 3, 4, 5).
3. The test's unrelated page is `http://127.0.0.1:<port>` (DEC-PENDING-C-T3-6), which matches the regex → Chromium's preflight for the `PUT` (Content-Type `image/png`) succeeds and the actual `PUT`/`GET` responses carry `Access-Control-Allow-Origin` for that origin (evidence 4).
4. Chromium therefore lets the cross-origin upload through (the Worker stores it: `stored` is the file) and exposes the download response (`ok: true, status: 200`) → the test's soft assertions fail (symptom). With `cors: false` the same browser request fails with `TypeError: Failed to fetch` (evidence 6), so this link is necessary and sufficient.

## Alternatives ruled out
- **The Worker / local transfer route sends CORS headers**: direct requests to wrangler get no `Access-Control-*` headers on `OPTIONS` (405) or `PUT` (403) (evidence 4).
- **wrangler's dev proxy adds them**: same direct-to-wrangler requests (which pass through wrangler's ProxyWorker) show none (evidence 4).
- **The test is wrong** (127.0.0.1 is not "unrelated", or the `<base href>` trick is invalid): the origins differ by host; a browser would equally let any other local dev server or local page on a loopback origin use the tickets; the spec says other origins cannot use the route. The same-origin control passes, so the ticket mechanics are fine.
- **Host check would block it**: the browser sends `Host: localhost:<dev port>` for a request to that URL regardless of the page's origin, so `isAllowedHost` passes it; it is not designed to check `Origin`.

## Proposed fix
`packages/framework/src/cli/dev/runtime.ts` (`startClient`): set `server.cors: false`, so Vite adds no CORS headers and forwards `OPTIONS` to the Worker (which answers 405 without CORS headers). Pair with a test that reproduces the failure first (red-green), e.g. in `packages/framework/test/integration/http/dev-paths.test.ts` or a `startClient` options unit test: a preflight / `PUT` to `/api/__framework/files/x` through `dev` with `Origin: http://127.0.0.1:<other port>` gets no `Access-Control-Allow-Origin`. Optionally note the setting in docs/components/cli.md's `dev` paragraph ("Vite … with no CORS headers"). No test change in `tests/compliance/`.

## Verification plan
1. New red test fails before the change, passes after.
2. `npm run compliance -- --target local --only FILES-AC-004` passes (upload: `FILES.TRANSFER_FAILED`, status null, `no response: network or cross-origin blocked`, nothing stored; download: `TypeError`), and the same-origin control still passes.
3. FILES-AC-003, FILES-AC-006 and E2E-009 (same-origin transfers through `dev`) still pass; `npm run verify` passes.

## Review

**Verdict: ACCEPTED.** Reviewer: independent subagent (prompt §8 step 2). It did not diagnose this failure or write the code or tests, and it changed no code or tests. Reviewed on branch `claude/implement-local-cloudflare-rc-c1-review` (base `be0cfe6`), Vite 8.3.4, wrangler 4.149.0.

**Reproduction.** `npm run compliance -- --target local --only FILES-AC-004,AUTH-AC-007` (dummy `apiKey` set through `npm run secrets`) failed FILES-AC-004's browser part with the same output as the Symptom: the foreign upload was stored and the download returned `ok: true`.

**Links checked against the source.**
- Link 1: `startClient` (`runtime.ts` lines 121–130) sets no `cors`. Vite's defaults (`node.js` line 25196) are `cors: { origin: defaultAllowedOrigins }`, and line 804 has the loopback regex. Confirmed.
- Link 2: at `node.js` 25084–25085, the `cors` middleware is installed right after `rejectInvalidRequestMiddleware`. That is before `hostValidationMiddleware`, before the plugin `configureServer` middlewares (including `dev`'s host check) and before `proxyMiddleware` (25098–25101). So it handles `/api/*` and answers preflights itself. Confirmed.
- Links 3–4: the diagnosis's live curl results and its cors-only toggle experiment isolate the Vite layer. My own experiment repeated the result with the fix in place (below).

**Alternatives.** I agree they are ruled out. The Worker route (`files/local/route.ts`) states and implements "no CORS headers". The headers are absent when requests go straight to wrangler. The test's unrelated origin `http://127.0.0.1:<port>` differs from `http://localhost:<dev port>` by host, so it is a different origin, and the spec (files.md §2 Local, FILES-AC-004, DEC-0006) forbids it from using the route.

**Fix addresses the cause.** `cors: false` makes Vite skip that middleware (`if (cors !== false)`), so the layer that adds the headers is removed. Nothing is masked in the test.

**Side effects checked.** `server.cors` is read only at line 25085 and, for `vite preview`, at line 35633. I ran `dev` with `cors: false` and `changeOrigin: true`, patched into the gitignored `dist/` only; the source was not changed, and I rebuilt afterwards. Results:
- **Same-origin traffic.** All 9 compliance browser specs pass, including FILES-AC-004's browser part, FILES-AC-003 (4 tests plus expired-ticket), FILES-AC-006, HTTP-AC-004 (no preflight, same-origin) and E2E-009 (20 MB and 100 MB photos). A curl ticket upload followed by a read-back returns 200 with the stored bytes. CORS does not apply to same-origin requests, so nothing `dev` needs is affected.
- **HMR.** Vite's WebSocket `shouldHandle` checks `allowedHosts` and the HMR token, not `cors`. In Chromium, `ws://localhost:<port>/?token=…` connected and the console showed `[vite] connected.`
- **Preflight from `http://127.0.0.1:1234`.** It now gets the Worker's `405` with no `Access-Control-*` headers. A `PUT` with a bad token gets `403` with no `Access-Control-*` or `Vary` headers.
- **Host check.** `Host: evil.example:<port>` still gets 403 on `/` and on `/api/*`.
- **Side benefit.** With the default `cors`, a preflight was answered before the host check ran. With `cors: false`, every request reaches the host check.

**Verification plan.** Adequate. It has a red-green `dev`-level test, the compliance rerun and same-origin regressions. The red test should also check that `OPTIONS` is no longer answered by Vite, for example that the status is not 204 and there is no `Access-Control-Allow-*` header.
