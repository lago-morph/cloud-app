# Root cause: every auth-app sign-in fails with 503 under workerd, because its upstream calls pass `redirect: "error"`, which workerd's `fetch` rejects

Item A (the auth app), branch `v0.2.0/28-auth-app-integration` (code from `v0.2.0/25a-auth-app-upstream`, commit "review fixes to the upstream calls"). Diagnosed 2026-10-31 by the item's implementer (no separate in-process diagnoser subagent was available in this run; see "Process note").

## Symptom

`npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/auth-app` (new suite, first run): 7 of 8 tests fail. Every test that calls `/start` gets `503` instead of `302`:

```
AssertionError: expected 503 to be 302 // Object.is equality
```

The auth app Worker logs, once per request:

```
{"level":"error","component":"AUTH_APP","message":"sign-in failed: discovery failed: unreachable"}
```

The one passing test ("never redirects to an unregistered return URL") never reaches the discovery fetch. All 141 unit tests of `src/auth-app` pass, including the `/start` route tests.

## Evidence

1. Log line above (scratchpad run `int1.log`): the failure is the discovery `fetch` throwing inside `getJson` (`upstream.ts`), which maps any thrown fetch to `"<what>: unreachable"`, and `handleAuthAppRequest` maps the SignInError to 503.
2. Probe (`rc-probe/probe.mjs`, Miniflare 5.20261006.1-alpha, the repo's workerd): a Worker fetches a Node HTTP server on `127.0.0.1:<port>` with each redirect mode.
   ```
   {"mode":"default","status":200,...}
   {"mode":"follow","status":200,...}
   {"mode":"manual","status":200,...}
   {"mode":"error","error":"TypeError: Invalid redirect value, must be one of \"follow\" or \"manual\" (\"error\" won't be implemented since it does not make sense at the edge; use \"manual\" and check the response status code)."}
   node fetch: 200
   ```
3. `grep -rn 'redirect: "error"' packages apps tests`: exactly two uses, both in `packages/framework/src/auth-app/upstream.ts` (line 38 `getJson`, line 119 `revokeTokens`).
5. Direct proof of causal link 3 (the reviewer's experiment, see Review): in a throwaway worktree at `3a45312`, changing only `redirect: "error"` → `"manual"` in `upstream.ts` turned the suite from `7 failed | 1 passed` to `8 passed (8)`.
4. The unit tests inject a fake `fetch` (`fake-upstream.test-support.ts`) that builds a Node `Request`, which accepts `redirect: "error"`; one unit test even asserts `redirect === "error"`. Nothing in the unit layer runs the upstream calls under workerd.

## Causal chain

1. The PR 25a review (minor finding) asked that upstream calls not follow redirects; the fix passed `redirect: "error"` (evidence 3).
2. workerd's `fetch` throws `TypeError: Invalid redirect value …` for `redirect: "error"` before any network I/O (evidence 2, mode `error`), while `follow`/`manual`/default reach the same loopback server (evidence 2), so the network is not the cause.
3. `getJson` catches the throw and raises `SignInError("discovery failed: unreachable")`; `/start` turns it into 503 (evidence 1, code path in `upstream.ts`/`app.ts`).
4. The unit layer could not see it: Node's `Request` accepts `"error"` and the fake never runs in workerd (evidence 4). Only the integration suite runs the bundle in workerd.

## Alternatives ruled out

- **workerd cannot reach loopback / private addresses:** ruled out by evidence 2 (default, follow and manual reach `127.0.0.1`).
- **The sandbox HTTPS proxy intercepts the Worker's request:** the target is plain `http://127.0.0.1`, in `NO_PROXY`; and evidence 2 shows the same target reachable in three modes.
- **The edge server (fake Cloudflare API / pass-through) is broken:** Node `fetch` to the probe target answers 200 (evidence 2); and the failure happens before the edge server logs any request (the first request is discovery, and the Worker throws before sending it).
- **mock-oauth2-server not running:** `startMockOAuth2` waits for its discovery document to answer 200 before the suite starts; the failing request is to the edge server, not to the issuer.

## Proposed fix

In `upstream.ts`, use `redirect: "manual"` on every upstream call (the mode workerd recommends) and treat any 3xx answer as a refusal: `getJson` raises `SignInError("<what>: redirected")` for a status 300–399 (and for an opaque-redirect status 0), before reading a body; `revokeTokens` already records any non-2xx as a failed kind. The security goal of the PR 25a finding (never re-send the client secret or a bearer token to a redirect target) is kept: `manual` never follows.

Tests, red first:
- a unit reproduction whose fake `fetch` enforces workerd's rule (throws `TypeError` for `redirect: "error"`, as evidence 2) and checks that discovery, exchange, JWKS, revoke, `/user` and `/memberships` all still answer: red on the current code;
- a unit test that a 307 from the token endpoint and from `/memberships` is refused as `redirected` and that the fake's redirect target is never requested;
- the once-green unit assertion `redirect === "error"` was wrong for the platform: it becomes `redirect === "manual"` (reason `test-was-wrong`, citing this record).
- The integration suite (real workerd) goes green.

## Similar cases

Searched all of `packages`, `apps`, `tests` (evidence 3): no other `redirect: "error"`. No case outside A's owned paths.

## Verification plan

1. The new reproduction unit test fails on the current code with the workerd `TypeError` message path ("unreachable"), then passes after the fix.
2. `npx vitest run --config vitest.unit.config.ts packages/framework/src/auth-app` green.
3. `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/auth-app` green (8/8) with mock-oauth2-server running locally.

## Process note

§7a.1.8 asks for a diagnoser subagent. This run's orchestrator for item A had no in-process subagent tool; the implementer diagnosed, and an independent reviewer session (no part in the code or the diagnosis) reviews this record before any fix is committed.

## Appendix: the probe of evidence 2

A Node script; change the import path to this checkout's `node_modules/miniflare/dist/src/index.js`.

```js
import { createServer } from "node:http";
const { Miniflare } = await import("<checkout>/node_modules/miniflare/dist/src/index.js");
const server = createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, path: req.url })); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const target = `http://127.0.0.1:${server.address().port}/x`;
const script = `
export default {
  async fetch(request) {
    const mode = new URL(request.url).searchParams.get("mode");
    const init = mode === "default" ? {} : { redirect: mode };
    try {
      const r = await fetch(${JSON.stringify(target)}, init);
      return Response.json({ mode, status: r.status, body: await r.text() });
    } catch (e) {
      return Response.json({ mode, error: String(e && e.name) + ": " + String(e && e.message) });
    }
  },
};`;
const mf = new Miniflare({ workers: [{ config: { name: "probe", compatibilityDate: "2026-10-01", manifest: { mainModule: "w.js", modules: { "w.js": { type: "esm", contents: script } } } } }] });
const w = await mf.getWorker("probe");
for (const mode of ["default", "follow", "manual", "error"]) console.log(JSON.stringify(await (await w.fetch(`https://probe.example/?mode=${mode}`)).json()));
console.log("node fetch:", (await fetch(target)).status);
await mf.dispose();
server.close();
```

## Review

Independent root-cause reviewer (a separate session that wrote neither the code nor the diagnosis), 2026-10-31 08:24 UTC, posted on PR #79. No major issues.

**Verdict:** accepted-with-changes

- Reproduced once at `3a45312`: the probe output matches evidence 2; the suite gives `7 failed | 1 passed`, `expected 503 to be 302`, with `discovery failed: unreachable` logged 7 times.
- Links 1, 2 and 4 supported by the evidence. Link 3 was inferred (`getJson` swallows the exception); one experiment closed it: only `redirect: "error"` → `"manual"`, suite 8/8 green. The alternatives are excluded by the same result.
- The fix addresses the cause; `manual` keeps the PR 25a goal. The verification plan is adequate.

Changes, binding on the fixer:
- **minor**: add the experiment to Evidence (done: evidence 5).
- **minor**: in `getJson`, cancel the body before raising `redirected` on a 3xx, and check 3xx before the `!res.ok` branch; status 0 (opaqueredirect) does not occur with `manual` in workerd or Node: keep it only as a defensive branch, untested.
- **minor**: the reproduction fake mirrors workerd's rule exactly (throw `TypeError` for any `redirect` other than `undefined`, `"follow"`, `"manual"`), and a guard fails if any upstream call omits `redirect: "manual"`.
- **minor**: the changed once-green assertion (`"error"` → `"manual"`) goes to §7a.1.9 test-change review as `test-was-wrong`, citing this record.
- **minor** (process, not blocking): diagnosis by the implementer, disclosed above.
