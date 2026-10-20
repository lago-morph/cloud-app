# Framework issues

Suspected framework defects found while building this app. Each entry is reproducible; none was worked around. While an entry is open, the requirements it blocks are unfinished and the app is not done.

## 1. Cloud targets cannot be verified: AWS is not built, and Cloudflare runs were out of scope for this build

- **Status:** open
- **Task attempted:** DEMO-REQ-010 / DEMO-AC-010: "The smoke test passes on local, Cloudflare, and AWS from one commit with no source changes"; the cloud column of DEMO-AC-001..009 and DEMO-AC-008 on cloud.
- **Contract or reference consulted:** `skill/SKILL.md` (intro: "running on Cloudflare is not yet verified, and the AWS target is not built yet"; hard rule 4; "Done means"); `skill/reference/testing.md`, "The smoke test".
- **Minimal reproduction:** `npx prototype-framework smoke --target aws --stage test-1` (no AWS target exists). Cloudflare: `npx prototype-framework deploy --target cloudflare --stage test-1` was not run, because this build was restricted to local work with no cloud calls.
- **Observed code or diagnostic:** none run; the skill states the AWS target is not available in this phase.
- **Expected:** a deployable AWS target and a Cloudflare test stage on which `smoke` can run.
- **Workaround not taken:** claiming cloud support from the local smoke run, or simulating a cloud.
- **Blocked requirements:** DEMO-REQ-010 (cloud parts), the cloud column of DEMO-AC-001..009. Local: `verify` passes and `smoke --target local` passed (8/8).

## 2. Ticket wire form on cloud stages is undocumented, so the smoke test's direct upload/download is unverified there

- **Status:** open
- **Task attempted:** DEMO-AC-003 in the smoke test: upload a 20 MB JPEG and check it downloads byte-identical. Tests may not import `/client`, so they cannot use `uploadFile` / `downloadUrl`; they must send the ticket's request themselves.
- **Contract or reference consulted:** `skill/reference/files.md` ("Return the ticket to the browser… Its contents are not yours to read or build"; "Testing"); `skill/reference/testing.md`, "The smoke test"; `skill/examples/tests.md` (`WireUploadTicket`, described only as "the in-process upload ticket's wire form").
- **Minimal reproduction:** in a test, `POST /api/photos/<id>/download-ticket` → `{"ticket":{"url":"/api/__framework/fi…"}}` in-process and on local `dev`. Nothing documents the form on Cloudflare/AWS (absolute storage URL? extra headers? does `TestApp.request` accept an absolute URL on a connected stage?).
- **Observed code or diagnostic:** in-process and `smoke --target local`: works with `{ url, method?, headers? }` sent through `t.request`. Cloud: unknown.
- **Expected:** a documented, test-usable way to perform an upload and download from a ticket on every target (for example a `/testing` helper).
- **Workaround not taken:** reading the framework source to learn the cloud ticket form. The smoke test sends absolute URLs with `fetch` and same-origin ones through `t.request`, a guess that is unverified on any cloud.
- **Blocked requirements:** cloud verification of DEMO-AC-003 (together with entry 1).

## 3. `id()` columns refuse non-UUID values with 400 `SQL.INVALID_VALUE`, which the references do not say

- **Status:** open (documentation; not blocking)
- **Task attempted:** DEMO-REQ-001: `GET /api/posts/:id` for an unknown ID.
- **Contract or reference consulted:** `skill/reference/http-and-validation.md`, "Validating input": "Path parameters … are not validated for you; an ID that matches no row your caller may see is `HTTP.NOT_FOUND`"; `skill/reference/sql-and-migrations.md`, "Tables" (`id()`: "text from `newId()`"; "A value that breaks its column's rule is refused … with 400 `SQL.INVALID_VALUE`").
- **Minimal reproduction:** `api.get("/posts/:id", async (c) => c.json(await c.var.sql.select({ id: posts.id }).from(posts).where(eq(posts.id, c.req.param("id")))))`, then in a test `await t.request("/api/posts/no-such-post")`; run `npx prototype-framework verify`.
- **Observed code or diagnostic:** `expected '{"error":{"code":"SQL.INVALID_VALUE",…' to be …` (status 400, on both sqlite and postgres).
- **Expected:** either the reference states that `id()` values must be UUIDs (so routes validate path IDs with `z.uuid()`), or a malformed ID in a `where` simply matches no row.
- **Workaround not taken:** none needed beyond ordinary input validation: the app checks path IDs with `z.uuid()` and answers `HTTP.NOT_FOUND`.
- **Blocked requirements:** none.

## 4. Disposing an `as()` test app disposes the shared app

- **Status:** open (documentation; not blocking)
- **Task attempted:** DEMO-AC-005 in the smoke test: a second session of the same login (`base.as(mockUsers.user(id))`), disposed after use.
- **Contract or reference consulted:** `skill/reference/testing.md`, "In-process tests" (`t.as(...)` "shares storage with `t`"; "`await t.dispose()` after each test … disposes every test app the test opened").
- **Minimal reproduction:** `const a = base.as(mockUsers.user("x")); await a.dispose(); await base.request("/api/site");` under `npx prototype-framework verify`.
- **Observed code or diagnostic:** `this test app was disposed` (on the next request through `base` / another view).
- **Expected:** the reference says whether disposing a view ends only that view or the shared app.
- **Workaround not taken:** none; the test simply does not dispose the extra view (it is ended with `base`).
- **Blocked requirements:** none.

## 5. `smoke` writes its evidence outside the app directory in this repository

- **Status:** open (not blocking)
- **Task attempted:** running `npx prototype-framework smoke --target local` in `apps/demo` while restricted to `apps/demo/**`.
- **Contract or reference consulted:** `skill/reference/testing.md`, "What runs your tests" ("writes an evidence record to `validation/<target>/<runId>.json`", location not stated).
- **Minimal reproduction:** `cd apps/demo && npx prototype-framework smoke --target local`.
- **Observed code or diagnostic:** `smoke: evidence: validation/local/3nkk7am5tw9ehoh.json`, created at the repository root (`validation/local/3nkk7am5tw9ehoh.json` and `validation/local/3nkk7am5tw9ehoh/`), not under `apps/demo/`.
- **Expected:** the reference names where the record is written relative to the app.
- **Workaround not taken:** none; the record was moved out of the repository rather than committed outside `apps/demo`.
- **Blocked requirements:** none (the local run's result is in `BUILD-RECORD.md`).
