# Root cause: PWD-AC-008 sign-in burst never reaches 429 on Cloudflare. The test client's requests reached Cloudflare from two IP addresses: Node's `fetch` alternates between two connections, and the sandbox's egress proxy gives each connection its own public IP. Better Auth's limiter worked; it counted two buckets of 3 and 4.

**Archived 2026-10-25** to branch `archive/implement-local-cloudflare` (same paths; `ai/ARCHIVE.md`, then `ARCHIVE-INDEX.md` there): the evidence run `k9cc5zjcbm5mrkc` (record and `raw/`) and its runner folder `validation/cloudflare/pass-auth/`, superseded by `pass-auth-2/` (`wxnforn019mo5ic`).

Author: diagnosing subagent (plan §8). Branch `claude/ba-fix-cf`, from `origin/claude/better-auth`. Evidence run: `k9cc5zjcbm5mrkc` (`validation/cloudflare/pass-auth/`). Live checks were made on one temporary stage `test-diag10250738`, which has since been removed.

## Symptom
In `pwd/test-stage.test.ts`, the test "[PWD-AC-008] a sign-in burst from one client gets 429 AUTH.RATE_LIMITED within PAR-258" failed (`logs/1-full.log:630`) with `6 sign-ins within 60 s reach the limit (answers: 400 AUTH.LOGIN_FAILED ×6)`. Locally, the same limit gives 429.

## Cause
PWD-REQ-006 counts per client IP, which BA reads from `cf-connecting-ip` (key `ip|/sign-in/email`, P7). The test sends its sign-ins one after another through `connectTestStage`'s `fetch`, but the requests do not share one IP:
1. **Two connections.** Node's `fetch` (undici, default pool) uses two sockets for strictly sequential requests to one origin, in the order 0 1 0 1 …. This reproduces offline against a local server.
2. **One IP per connection.** Behind the cloud sandbox's egress proxy, each connection can leave from a different address in one /24. With `curl`, 12 new connections showed 7 addresses.

So Cloudflare saw the burst as two clients, each below `max` 5. The candidates in the brief do not explain it:
- **The rebuilt Request:** the bridge copies `ctx.clientIp`, and the rows below hold real client IPs.
- **The per-request instance:** state is in D1, not memory.
- **The storage:** D1 rows are written and incremented correctly.
- **`NODE_ENV`:** `rateLimit.enabled: true` is forced (P2).
- **The failed sign-up:** sign-in buckets are independent of it.

## Evidence
All measured live on `test-diag10250738`; no IP addresses are recorded here.
- **A plain Node burst splits.** 7 wrong-password sign-ins through the proxy (`fetch`, one process) all answered 400. The table `__framework_auth_rate_limit` then had **2 distinct keys** for `/sign-in/email`, with counts **4 and 3** (sum 7). A second burst gave 2 new keys, again 4 and 3.
- **The same burst on one connection gives 429.** With an undici `EnvHttpProxyAgent({ connections: 1 })`, the answers were 400 ×5, then 429 ×2. Without it, but with a GET interleaved after each POST (so the POSTs keep one socket), one key reached count 5.
- **In the test, the global dispatcher is not enough.** Installing a one-connection global dispatcher in `holdStageSignIns` still gave 4/3. The reason: `connectRunStage()` imports the framework's testing entry. That entry loads Wrangler, which calls `setGlobalDispatcher(new EnvHttpProxyAgent(...))` when proxy variables are set (`wrangler-dist/cli.js`, "Proxy environment variables detected"), and so replaces any earlier dispatcher. A diagnostic test showed that the dispatcher changed across `connectRunStage()`.
- **Why local passes.** The client IP is the header the test sets, or 127.0.0.1. The number of connections does not matter there.

## Fix (red, then green)
- **Red:** `tests/compliance/harness/one-connection.unit.test.ts`. Six sequential POSTs to a local server must arrive on one socket. With a no-op stub, the sockets were `[0, 1, 0, 1, 0, 1]`.
- **Green:**
  - `tests/compliance/harness/one-connection.ts` adds `oneConnectionDispatcher()`. It returns an undici `Agent` with `connections: 1`, or an `EnvHttpProxyAgent` with `connections: 1` when a proxy is set. It is passed per request (`dispatcher` in the fetch init), not set globally, so Wrangler cannot replace it.
  - In `pwd/support.ts`, each browser on a non-local origin gets its own dispatcher. `connectedBrowser` passes it through `TestApp.request`, whose init `connectTestStage` hands to `fetch`. `httpBrowser` passes it through `createClient({ fetch })`.
  - `undici@7.29.1` is now an exact dev dependency of `tests/compliance`. It is the version Wrangler and Miniflare already bring.
  - `support.unit.test.ts` checks that one cloud browser reuses one dispatcher, and that the in-process browser uses none.
  - The framework is unchanged, and no assertion was weakened.
- **Live:** on `test-diag10250738`, `pwd/test-stage.test.ts` passed all 4 tests: MAIL-AC-006; PWD-AC-008 sign-up → verify → sign-in → `/api/auth/me`; forgot/reset; and the burst, which now answers 429 `AUTH.RATE_LIMITED`.

## Limits
One connection keeps one IP only for as long as it stays open. A burst is fast, so it does. If the proxy rotates the address within a connection, the fix will not hold.
