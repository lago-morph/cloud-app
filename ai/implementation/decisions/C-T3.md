# C-T3 decisions (FILES and AUTH compliance criteria, E2E-009)

Test-case author for plan item C-T3. Owns `tests/compliance/criteria/{files,auth}/` and `tests/compliance/e2e/E2E-009*`. Written from `docs/components/{files,auth}.md`, the contracts, `apps/reference/ROUTES.md`, and the cited decisions, not from the implementation. Taken under the owner's instruction "Do not stop and ask me questions. Make an assumption and continue"; open for owner review.

### DEC-PENDING-C-T3-1 — Browser transfers use the published `<package>/client`, bundled and added to a page of the app's origin
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-003, FILES-AC-004 (browser part), FILES-AC-006 (browser part); `tests/compliance/criteria/files/browser.ts`

FILES-AC-003 needs `uploadFile` and `downloadUrl` called with tickets the test chooses (another name's, another content type's, an expired one), and needs `ApiError.status`, which the reference page's status text does not show. The reference page exposes no helpers. So the test bundles the installed package's `./client` entry (what an app imports) with esbuild into an IIFE (`window.fw`) and adds it to the reference app's own page with `page.addScriptTag`. The page is on the target's origin (`dev`, or the stage), so the browser treats the transfers exactly as an app's. Tickets are requested by a logged-in Node client from the reference app's ticket routes, as app server code would hand them out, and passed into the page unchanged. esbuild is not declared in `tests/compliance/package.json` (C-T3 does not own it); it resolves from the root `node_modules` (framework dependency, PAR-119). If a cloud stage's page ever sends a Content-Security-Policy that blocks inline scripts, the injection fails visibly; Playwright's `bypassCSP` would then be the fix (not set now, since `dev` sends none). Not a missing route: the scenario-level flow through the app's own page is E2E-009.

### DEC-PENDING-C-T3-2 — Ticket fields are read only through the documented ticket shape
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-003, FILES-AC-005, E2E-009

Where a criterion is about what a ticket permits, the tests read `url`, `method`, `headers` and `expiresAt`, the shape files.md §2 "Shared runtime shape" documents (DEC-0160). App code never does; the type inspection (FILES-AC-004) checks that app-facing types expose none of these.

### DEC-PENDING-C-T3-3 — "A ticket for one name cannot write another": the ticket's URL edited to name another file is refused
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-003

The test uploads with an upload ticket for `…/one.txt` (it writes that name and nothing else), then rewrites the ticket URL wherever it carries the name — plainly, percent-encoded, or inside a base64url JSON segment (a signed token) — to `…/two.txt`, sends each rewritten URL with the ticket's method and headers from the page, and expects each to be refused, `two.txt` absent and `one.txt` unchanged. It requires at least one rewrite to be possible, so the clause cannot pass vacuously.

### DEC-PENDING-C-T3-4 — "An upload with a different content type is rejected": a raw `fetch` from the page
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-003

`uploadFile` always sends the ticket's content type, so the mismatched upload is a plain `fetch` `PUT` to the ticket URL with `Content-Type: image/png` from the app's page. It passes when the request does not succeed (a refused status, or a network/CORS error on a cloud) and nothing is stored; a control upload with the ticket's own type then works.

### DEC-PENDING-C-T3-5 — FILES-AC-003's expired-ticket clause waits for a real expiry (PAR-233)
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-003; `expired-ticket.spec.ts`

No contract option or reference route issues a shorter-lived ticket, and the expiry is checked by storage (R2 on Cloudflare), so the clock cannot be moved. The test uses the ticket once (control), waits until its `expiresAt` plus 30 s (bounded: the lifetime must not exceed PAR-233 + 1 min; test timeout PAR-233 + 5 min), and asserts the clause as written: `FILES.TRANSFER_FAILED`, a numeric status ≥ 400, `rejected by storage (HTTP n)`, no storage error body in the message, nothing written. It is in its own spec file so the wait overlaps the other specs. On Cloudflare it is expected to fail (DEC-0101); it is not skipped or weakened. A test-only short ticket lifetime would make the run 15 minutes shorter; that would be a framework change (not requested).

### DEC-PENDING-C-T3-6 — FILES-AC-004 browser part: a `127.0.0.1` page is the unrelated origin, against `dev`
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-004; B-EV flag F6

Per F6 the browser part runs against `dev` (the driver's local target), not a harness. The unrelated origin is a page served by the test at `http://127.0.0.1:<port>` with `<base href="<app origin>/">`, so relative (local) ticket URLs target the app's storage cross-origin; on a cloud the ticket URLs are absolute anyway. A same-origin control precedes it. Outcomes are soft assertions, so the evidence shows the upload and the download result together.
Observed on `dev` (informational, 2026-10-20): the upload from `http://127.0.0.1:<port>` **succeeds**. `dev`'s HTTP server answers the preflight for `/api/__framework/files/*` with `Access-Control-Allow-Origin: <the requesting loopback origin>` (it does so for `http://127.0.0.1:1234`, not for `http://evil.example`), i.e. any page on a loopback origin, such as another local dev server, can use the app's tickets. This is the dev-server path F6 asked to check; the test reports it as a failure. Origin of the header (Vite's default `server.cors`, which allows loopback origins) is for a diagnoser to confirm.

### DEC-PENDING-C-T3-7 — FILES-AC-006: server part in-process; browser part through a cutting proxy against `dev`
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-006

Server part: a running `dev` cannot be given unreachable storage, so the reference app runs in-process with `createTestApp(…, { unavailable: ["files"] })` and every `/api/files/*` route (put, get, head, delete, list, both ticket kinds) must answer 503 `FILES.UNAVAILABLE`. Browser part: the page on `dev` is opened in a context whose proxy is a small forwarding HTTP proxy run by the test (`bypass: "<-loopback>"`, since Chromium never proxies loopback otherwise); it drops the connection of every upload `PUT` to the ticket's path after 2 MiB, and the upload is throttled to 4 MiB/s (CDP) so the cut lands mid-body. Chromium retries a reset request a few times; each attempt is cut. Expected: `FILES.TRANSFER_FAILED`, status null, `interrupted after n bytes` with 0 < n < 16 MiB, nothing stored. Both parts are Local only (Where), so the driver selects them only on `local`.

### DEC-PENDING-C-T3-8 — FILES-AC-005: the stage's storage as a stranger finds it
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-005 (Cloud)

The storage address comes from a ticket URL with its query string (where a signed URL carries its signature) removed. Unsigned `GET` of the file, of a sibling name, of the storage root and of the first path segment (bucket, path-style), and an unsigned `PUT`, must each get a 4xx without the file's bytes or name in the body, and the file must be unchanged. Cloud only: locally the signature is part of the path, so the test is not meaningful there and the driver does not select it.

### DEC-PENDING-C-T3-9 — FILES-AC-004 type inspection walks the published declarations, and the contracts
Origin: ai-proposed · Status: accepted · Affects: FILES-AC-004

The TypeScript checker walks the FILES exports (and `Services.files`) of the package's `exports` `types` files for `.` and `./client`, and of `docs/contracts/ts/{index,client}.d.ts` (bundler resolution, since the contracts use extensionless imports), collecting member, parameter, type and string-literal names; none may match the storage/signing/credential vocabulary, and `UploadTicket` / `DownloadTicket` must have no property besides the brand. A non-vacuity check requires the walk to have reached `createUploadTicket`, `createDownloadTicket`, `contentType`, `onProgress` and `nextCursor`. B-T3 inspects the sources; this inspects what an app installs.

### DEC-PENDING-C-T3-10 — AUTH-AC-006: per-target cookie names; the transaction cookie and the "Locally" clauses in-process
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-006

"As specified" is AUTH-REQ-006 plus auth.md §2: names `session_local` / `login_local` locally and `__Host-session` / `__Host-login` on cloud targets; HttpOnly, SameSite=Lax, Path=/, no Domain, cloud also Secure; lifetime PAR-250 (session) and PAR-251 (transaction) from Max-Age or Expires (±60 s). These are the per-target expectations the criterion states, so the tests branch on the target for them. A `test-` stage and local `dev` have no real login provider, so their `/api/auth/login` sets the session directly (DEC-0171) and no transaction cookie: on the target the test checks every cookie the login flow sets. The transaction cookie itself is checked with the stub login provider, which exists only in-process (`createTestApp(…, { stubLoginProvider: true })`), together with the "Locally, expired and future-dated" clauses (fake `Date`, as B-T3 did). Those in-process tests are registered only when the target is `local` (not skipped elsewhere), so a cloud run neither runs nor records them. Consequence for evaluators: on a cloud test stage the transaction-cookie attributes are not observed; that is only possible on a stage with a real provider (prodcheck: not-run, Google login mocked).

### DEC-PENDING-C-T3-11 — AUTH-AC-007: missing and wrong Origin through the deployed router with raw HTTP; directly in-process
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-007; DEC-0230

Through the deployed router (`dev` locally, the stage on a cloud): a POST with a session and no `Origin` (also `/api/auth/logout`, which must leave the session intact), with wrong origins (`https://evil.example`, `null`, a look-alike host, the same host with the other scheme, another port, a trailing slash), and with the public origin (the base URL's origin). Directly: in-process (local only), wrong and correct origins.
Observed on `dev` (informational, 2026-10-20): `Origin: https://localhost:<dev port>` (other scheme) is **accepted** through `dev` but refused by the worker when sent to it directly, so `dev`'s front server appears to rewrite or drop `Origin` before the forgery check. The test reports this as a failure; a diagnoser should confirm the mechanism.

### DEC-PENDING-C-T3-12 — AUTH-AC-009: only the test-stage part
Origin: ai-proposed · Status: accepted · Affects: AUTH-AC-009

On the target (local or `test-` stage): chosen level, ID used as given (including characters a derived ID never has) and display name appear in `/api/auth/me`, `c.var.user` and the guards; a fixed default ID per level; `anonymous` logs out. The production 404 is not-run (Google login mocked, plan §8.1). "Production bundles contain no mock module" is a bundle inspection (CORE-AC-006 build part, B-T4) and is not checked or tagged here.

### DEC-PENDING-C-T3-13 — E2E-009: BMP photos through the reference app's page; request and source checks
Origin: ai-proposed · Status: accepted · Affects: E2E-009

The photos are uncompressed 24-bit BMPs of at least 20 MB and 100 MB (decimal), generated on disk for the run and removed afterwards (one item per size the scenario names). Upload through `file-input` + `upload` until `upload-status` is `Uploaded.`; view: the item's `preview` reaches the photo's natural dimensions; download: the item's `download` link, observed through Playwright's `download` event, saved and compared by size and SHA-256. "Requests only to the app's API and through framework helpers": every page request is a ticket URL the app's ticket routes returned, a same-origin `/api/*` request outside `/api/__framework/`, or a same-origin GET loading the page or its client code; each photo went to storage by exactly one PUT to an upload-ticket URL, and `/api/files/content` was never called. "No storage or CORS settings": the reference app's code and configuration files (excluding tests, generated migrations and the version overlays) contain none of the storage/CORS vocabulary.

### DEC-PENDING-C-T3-14 — No missing reference routes
Origin: ai-proposed · Status: accepted · Affects: C-01 `apps/reference/ROUTES.md`

Every route these tests use is in ROUTES.md (`/files/*`, `/levels/*`, `/ref/me`, the framework's `/api/auth/*`). Not needed but would help: a way to issue a short-lived ticket on test stages (DEC-PENDING-C-T3-5).

## Parameter changes

None.
