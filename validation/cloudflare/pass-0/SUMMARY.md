# Cloudflare pass 0 — shared resources, DEC-0334 live checks, D-02 R2 checks

- Date: 2026-10-23 (UTC). Base commit: `c512ad6` (`claude/implement-local-cloudflare`).
- Scope (owner-authorised pass 0): `setup-account --target cloudflare` once; DEC-0334 checks 1–9 and 11 (plan §5 D-RUN numbering); D-02's live R2 checks (DEC-0328, DEC-0329). No D1 database, no stage, no Worker.
- Credentials: none sent by the runner (the proxy injects the token for `api.cloudflare.com`). Account ID, workers.dev subdomain, 32-hex IDs and R2 cursors are redacted in `logs/`. The temporary R2 token's creation response stayed in the scratchpad and was deleted; its value was never printed.

## Usage (plan §1 caps)

| Measure | Before | After | Cap |
|---|---|---|---|
| D1 rows written today (GraphQL `d1AnalyticsAdaptiveGroups`, `date: 2026-10-23`) | 0 | 0 | 0 for this pass |
| D1 rows read today | 0 | 0 | — |
| D1 databases (`wrangler d1 list --json`) | 0 | 0 | 0 created |
| Cloudflare requests by this pass | — | **38** | ≤ 100 |

Request count (ledger: `logs/request-ledger.txt`): GraphQL 2; `wrangler d1 list` 2 runs counted as 2 each = 4 (untraced, 1 expected each); `setup-account` 5 (fetch trace); direct API calls with curl 22 (including one proxy 502 and one proxy 403); R2 S3 endpoint 5 (2 PUT, 2 GET, 1 DELETE). No loops, no automatic retries. One read (bucket listing after cleanup) was repeated once by hand after a proxy `502 upstream request failed`.

## setup-account (run once)

`node packages/framework/bin/prototype-framework.js setup-account --target cloudflare` from `apps/template`, with `CLOUDFLARE_API_TOKEN=placeholder`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID`, `NODE_USE_ENV_PROXY=1` (log: `logs/setup-account.log`). Exit 0, 5 requests:
`GET buckets/prototype-logs` 404 → `GET buckets/sst-state` 404 → `GET workers/subdomain` 200 → `POST buckets` ×2 200. Output: "already present: workers.dev subdomain", "created: R2 bucket prototype-logs, R2 bucket sst-state". Matches DEC-0333/DEC-0334 (3 reads, up to 6 when creating). Both buckets stay by design (plan §10.6).

## DEC-0334 live checks (plan §5 D-RUN numbering)

| # | Request | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | `GET …/r2/buckets/prototype-logs` | 200 `success: true` | 200, `success: true` (location ENAM, Standard) | pass |
| 2 | `GET …/r2/buckets/spike-pass0-never-created-q7k2` | 404, code 10006 | 404, 10006 "The specified bucket does not exist." | pass |
| 3 | `POST …/r2/buckets {"name":"prototype-logs"}` (exists) | 409, code 10004 | 409, 10004 "The bucket you tried to create already exists, and you own it." | pass (see finding F-2) |
| 4 | `GET …/workers/subdomain` | 200 with `result.subdomain` | 200, `result` = `{subdomain: <non-empty string>}` | pass |
| 5 | `GET …/r2/buckets/prototype-logs/objects?per_page=…` | `result_info.cursor`, `is_truncated` | empty bucket (`per_page=1000`): no `result_info`. With 2 objects, `per_page=1`: `result_info {cursor, is_truncated: true, per_page: 1}`; page 2 with `&cursor=…`: the other key, no `result_info` | pass (see note N-1) |
| 6 | `GET …/tokens?per_page=50&page=1` | `result_info.total_pages` | `result_info {page 1, per_page 50, total_pages 1, count 2, total_count 2}` | pass |
| 7 | `GET …/workers/scripts/<missing>/secrets` | 404, code 10007 | 404, 10007 "This Worker does not exist on your account." | pass |
| 8 | `GET …/workers/scripts/<missing>/settings` | 404, code 10007 | 404, 10007 (same message) | pass |
| 9 | `DELETE …/workers/scripts/<stage Worker>?force=true` | 200 | not run: the account has no Workers (`GET …/workers/scripts` → 0 scripts) | **deferred to pass 1** |
| 10 | generated SST program on first deploy | — | not in scope (needs D1) | waits for pass 1 |
| 11 | DEC-0335 preflight reads: `GET …/tokens/verify`, `GET …/tokens/permission_groups`, `GET …/tokens?per_page=50&page=1` | all 2xx; group "Workers R2 Storage Bucket Item Write" present | verify 200 `status: active`; permission_groups 200 (413 groups, one page, no `result_info`), the Item Write group present (scope `com.cloudflare.edge.r2.bucket`); token list 200 (check 6). Creating a token with that group scoped to one bucket also succeeded (D-02 below) | pass |

## D-02 live R2 checks

A temporary R2 token `spike-pass0-r2-check` (Item Write on `prototype-logs` only; same request shape as `createSigningToken`) was created, used through the framework's own built issuer (`createCloudflareTicketIssuer` + `s3CredentialsFromToken` from `dist/`), and deleted (200; the token list afterwards shows only the account's two pre-existing tokens). Result: `logs/d02-r2-checks.json`.

| Check | Expected | Actual | Result |
|---|---|---|---|
| DEC-0328: upload ticket for `x/../y` | URL path with every `/` as `%2F`; PUT 200; object key exactly `x/../y` | path `/prototype-logs/x%2F..%2Fy`; PUT 200; listing shows key `x/../y` (not `y`); download ticket GET 200, body identical | pass |
| DEC-0329: download ticket for `pass0 report (1).txt` | GET 200 with `Content-Disposition` = signed `response-content-disposition` (`+` for the space after `;` accepted by the signature check) | query sent as `attachment%3B+filename*%3D…`; GET 200, body identical; `Content-Disposition: attachment; filename*=UTF-8''pass0%20report%20%281%29.txt` = `downloadDisposition(name)` | pass |

Cleanup: `pass0 report (1).txt` deleted with the framework's API path (`DELETE …/objects/<encodeURIComponent(key)>` → 200). `x/../y` could not be deleted that way (F-1); it was deleted with one presigned S3 `DELETE` (204). Final listing of `prototype-logs`: empty.

## Findings and notes

- **F-1 (mismatch, sandbox):** `DELETE /accounts/<ACCOUNT>/r2/buckets/prototype-logs/objects/x%2F..%2Fy` (the exact form `deleteObjects` in `provision/cloudflare/objects.ts` sends) was refused with **HTTP 403, plain text "request rejected: path contains traversal sequence"**. The body is not Cloudflare's JSON envelope, so it is most likely the sandbox's agent proxy (not confirmed). The same `%2F..%2F` path to the R2 S3 endpoint was accepted. Effect: in this sandbox, `remove` / leftover cleanup cannot delete an object whose name has a `.`/`..` segment through the API; `deleteObjects` would report it as stuck. Not fixed (runner); for a D-03/D-02 follow-up (e.g. delete such keys through S3, or record the limitation).
- **F-2 (message mismatch, minor):** Cloudflare's 409 (code 10004) on creating an existing bucket says "already exists, and you own it". `createBucket` in `provision/cloudflare/account.ts` maps every 409 to "already exists but belongs to another account". In the normal flow a 409 follows a 404 read, so it would appear only in a race, where the message would be wrong. DEC-0270's "409 = foreign" reading is therefore not confirmed by this answer; the 403 foreign reading stays unverifiable with one account (DEC-0334 item 1).
- **N-1:** R2 object listing omits `result_info` entirely on an empty bucket and on the last page (rather than `is_truncated: false`); `permission_groups` has no `result_info`. `listObjectKeys` treats a missing `result_info` as the last page, so it works as written.
- **N-2:** the download name for a key with `/` (e.g. `x/../y`) is `filename*=UTF-8''x%2F..%2Fy`, as DEC-0329 specifies; browsers sanitise it.
- **N-3:** one proxy `502 upstream request failed` on a read; repeated once by hand, then 200.

## Resources now on the account

- R2 buckets: `prototype-logs` (empty), `sst-state` (empty) — created by `setup-account`, stay by design.
- Workers: none. D1 databases: none. API tokens: the account's two pre-existing tokens only (temporary token deleted). Test objects: none.
- Nothing else billable was created.
