# Root cause: `POST /api/auth/password/sign-up` → 403 "Error 1000: DNS points to prohibited IP" on Cloudflare stages. The compliance test browsers set `CF-Connecting-IP` themselves, and Cloudflare's edge refuses any request that already carries that header. The Worker never runs.

Author: diagnosing subagent (plan §8). Branch `claude/ba-fix-cf`, from `origin/claude/better-auth`. Evidence run: `k9cc5zjcbm5mrkc` (`validation/cloudflare/pass-auth/`). Live checks were made on one temporary stage `test-diag10250738`, which has since been removed.

## Symptom
In run `k9cc5zjcbm5mrkc`, AUTH-AC-005 (admin part), E2E-007 (cloud part), AUTH-AC-006, AUTH-AC-014 and CLI-AC-007 all failed on their first sign-up (`logs/1-full.log:491-569`):

```
POST /api/auth/password/sign-up → 403 {"type":"https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1000/","title":"Error 1000: DNS points to prohibited IP","status":403,…}
```

On the same test stage, the sign-up of MAIL-AC-006 and PWD-AC-008 (`pwd/test-stage.test.ts`) passed.

## Cause
`tests/compliance/criteria/pwd/support.ts` `requestHeaders()` set `cf-connecting-ip: <testIp()>` whenever a caller passed `{ ip }`. `createVerifiedAccount(b, a, ip)` and the other failing tests do pass it. That header is meant to give each test client its own rate-limit bucket in-process and under `dev` (DEC-0516 P7). Through Cloudflare, though, it is refused at the edge: Cloudflare's Error 1000 page lists "The request includes a `CF-Connecting-IP` header" among its causes. The passing tests sent no `ip`. So the failing request is the test client's own request, not a subrequest made by the Worker.

## Evidence
- The candidates on the framework side are ruled out by reading the code:
  - `src/auth/password/bridge.ts` `forward()` calls `auth.handler(request)` in-process and makes no `fetch`.
  - BA's `baseURL` is used only to build URLs, and `telemetry` is off.
  - The mail is sent on the test stage through the capture, which writes to D1 (`src/mail/test-stage.ts`, "Nothing is sent").
- Live, on `test-diag10250738`:
  - `GET /api/auth/me` returns 200.
  - The same request with `cf-connecting-ip: 10.1.2.3` returns 403 `error code: 1000`. With `x-forwarded-for` instead, it returns 200.
  - `POST /api/auth/password/sign-up` with the header returns 403 `error code: 1000`. Without the header it returns 400 `HTTP.INVALID_INPUT` (empty body), so the Worker answered.
- The difference between the passing and failing tests is exactly the `{ ip }` option.

## Fix (red, then green)
- **Red:** `tests/compliance/criteria/pwd/support.unit.test.ts`. A `connectedBrowser` on an https cloud origin that signs up with `{ ip }` must send no `cf-connecting-ip`. This test failed before the fix. An in-process browser still sends the header.
- **Green:** `support.ts` adds `sendsClientIp(origin)`, which is true only for `localhost`, `127.0.0.1` and `[::1]`. `requestHeaders()` sets the header only when it is true. No assertion was changed. On a cloud stage, the edge sets the client IP from the connection; the comment on `withStageSignIns` already said so.
- **Live:** `auth/sessions.test.ts` (AUTH-AC-006, all 5 tests) passed on `test-diag10250738`. This includes the password part: sign-up with `{ ip }`, then verification through the test-mail route, then sign-in and the cookie checks.

## Follow-up risk (not fixed here)
On a cloud stage, every test's sign-up now counts against the runner's real IP or IPs. PAR-259 allows 3 sign-ups per 300 s per IP on `/sign-up/email`. Several cloud test files sign up on the same test stage (sessions, login-forgery, admins, test-stage). Within 300 s, a fourth sign-up from one IP can be refused with 429. `withStageSignIns` serialises only sign-ins. If that happens, serialise sign-ups too, or space them PAR-259 apart.
