# Root causes: F-02 round 1 — the five entries of `apps/demo/FRAMEWORK-ISSUE.md`

Diagnosed on branch `claude/implement-local-cloudflare-diag-f1` (from `origin/claude/implement-local-cloudflare` at `e150079`, "Merge F-01 demo build (round 1)"). Local only; no Cloudflare calls. No code, docs, demo or tests changed. Per plan §1 "Test economy" rule 8, each failure was reproduced once; the reproductions used a throwaway test file (`apps/template/tests/zz-diag-f02.test.ts`, deleted afterwards, never committed) run with `npx vitest run` in `apps/template`, after `npm ci` and `npm run build -w packages/framework`.

Summary:

| # | Entry | Class | Fix owner |
| --- | --- | --- | --- |
| 1 | AWS not built; no cloud runs, so cloud smoke blocked | (c) expected limitation of this phase | none in code; record `not-run` / `blocked`; close the entry |
| 2 | Cloud ticket wire form undocumented for tests | (b) skill gap (cloud verification itself is (c)) | E-01 path set: `skill/reference/testing.md`, `skill/reference/files.md`, `skill/examples/tests.md` caption |
| 3 | `id()` columns refuse non-UUID values in comparisons | (b) skill gap | E-01: `skill/reference/sql-and-migrations.md`, `skill/reference/http-and-validation.md` |
| 4 | Disposing an `as()` view disposes the shared in-process app | (b) contract/skill gap | B-16 path set: `docs/contracts/ts/testing.d.ts`; E-01: `skill/reference/testing.md` |
| 5 | `smoke` evidence goes to the repository-root `validation/` | (b) skill gap, behaviour is as designed; plus a plan path-set gap | E-01: `skill/reference/testing.md`; plan F-01 "Owns" |

None is a framework defect (a). None is a builder misunderstanding (d): in each case the builder read the skill correctly and the skill was silent or the phase forbade the run.

---

## Entry 1 — AWS target not built and no cloud runs allowed, so cloud smoke is blocked (DEMO-REQ-010)

**Classification: (c) expected limitation of this phase. Not a defect.**

### Symptom

`apps/demo/FRAMEWORK-ISSUE.md` entry 1: DEMO-REQ-010 / DEMO-AC-010 ("The smoke test passes on local, Cloudflare, and AWS from one commit with no source changes", `docs/demo/demo-spec.md` line 85) and the cloud column of DEMO-AC-001..009 cannot be shown.

### Evidence

1. Reproduction, in `apps/demo`: `npx prototype-framework smoke --target aws --stage test-1` prints `smoke: --target must be one of: local, cloudflare` and exits 2. Cause: `packages/framework/src/cli/args.ts` line 13, `export const TARGETS: readonly Target[] = ["local", "cloudflare"];`, and `smoke.ts` `parseSmokeOptions` (lines 127–139) refuses any other target as a usage error.
2. Scope: prompt `ai/prompts/implement-local-cloudflare.md` §4 "Do not build: the AWS adapters, the AWS target, or AWS provisioning; placeholder AWS code that pretends to work." So the refusal is required, not a gap.
3. Plan §8.2 (detail "AWS phase not started") lists "DEMO-AC-010 (AWS)" and "The AWS run of every criterion whose Where says cloud (each cloud criterion is recorded for `aws` as not-run)". F-EV (plan line 400) judges "DEMO-AC-001…-011 (local + Cloudflare; AWS parts not-run)".
4. Cloudflare: the demo's Cloudflare deploy and smoke are plan item **F-03** (plan line 394), not F-01. F-01's task (plan lines 383–388) is local only: "passes `verify`". F-03 is a cloud item under §1 "Cloud usage limits", and DEC-0317 (decision-log line 2459; plan §1 line 27) stops all D1 use on Cloudflare until the daily limit resets. A demo stage needs D1 (the demo's SQL tables), so F-03 is held by DEC-0317 today. `validation/` has no `cloudflare/` directory at this commit: no Cloudflare run has been recorded for any item.
5. The skill already tells the builder this: `skill/SKILL.md` line 8, "In this phase only local runs are verified: running on Cloudflare is not yet verified, and the AWS target is not built yet"; `skill/reference/deploying.md` line 7, "The AWS target is not available yet."

### Cause chain

Phase scope (prompt §4) → no `aws` target in `TARGETS` (evidence 1) → `smoke --target aws` is a usage error → DEMO-AC-010's AWS clause cannot run. Separately: Cloudflare runs belong to F-03 (evidence 4) and DEC-0317 holds every D1-dependent cloud run → no Cloudflare smoke for the demo yet. The builder could not have done either part.

### Proposed fix

No code or skill change. How it is recorded:

- **AWS:** DEMO-AC-010 (AWS clause) and the AWS run of DEMO-AC-001..009: `not-run`, detail **"AWS phase not started"** (plan §8.2).
- **Cloudflare:** DEMO-AC-010 (Cloudflare clause) and the cloud column of DEMO-AC-001..009 are F-03's to run. While DEC-0317 holds: `blocked`, detail **"D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset"** (plan §1; driver `--blocked`, DEC-0261). Once D1 is available, F-03 runs them.
- **The entry:** mark entry 1 closed as "phase limitation, not a framework issue" (by the F-02 fixer or the next F-01 build). Optional skill clarification (E-01's `skill/SKILL.md`, hard rule 7 or "Done means"): a cloud that cannot be reached in this phase (AWS not built, cloud runs not allowed) is listed as unfinished in the build record, not raised as a framework issue. Without it, a fresh F-01 builder following hard rule 6 ("a capability that is missing for the task") will raise the same entry again, and the F-02 loop ("repeat until no entry remains open") would never end.

### Verification

None in code. F-EV confirms the AWS `not-run` rows; F-03 produces the Cloudflare rows (or the `blocked` rows while DEC-0317 holds).

---

## Entry 2 — Cloud upload-ticket wire form undocumented, so smoke upload/download is unverified on a cloud

**Classification: (b) skill/documentation gap.** The framework's wire form is designed and target-neutral; the skill never tells a test author what it is outside the in-process case, nor how to send it on a connected stage. Running it on a cloud is (c) (entry 1).

### Symptom

DEMO-AC-003 (20 MB JPEG uploads and downloads byte-identical) must be in the smoke test on a deployed stage (demo-spec line 72). Tests may not import `/client` (`skill/SKILL.md` hard rule 1: "`/testing` in tests"), so they cannot use `uploadFile` / `downloadUrl`. The builder guessed: absolute ticket URLs through global `fetch`, relative ones through `t.request` (`apps/demo/tests/smoke/smoke.test.ts` lines 36–39).

### Evidence

1. **Design (the form exists and is the same on every target).** `docs/components/files.md` line 69: "Both kinds of ticket are plain JSON with `url` and `expiresAt` (milliseconds). An upload ticket also holds `method` (`PUT`) and `headers` (always `Content-Type`). The browser helpers read only these fields, so they behave the same on every target." Line 79: the local ticket URL is the relative path `/api/__framework/files/<token>`. Line 90: on Cloudflare "A ticket URL is path-style, `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`" (SigV4 query-signed, line 91: signs `content-type;host` for uploads, `host` plus `response-content-disposition` for downloads; no other header is needed).
2. **Skill (what the builder could read).** `skill/reference/files.md` line 24: "Return the ticket to the browser as JSON … Its contents are not yours to read or build." Line 54 ("Testing") covers only `createTestApp`: "tickets point to a local framework route". `skill/examples/tests.md` lines 95–106 define `WireUploadTicket { url; method; headers }` captioned "The in-process upload ticket's wire form (files.md §2)" and send it through `t.request`. `skill/reference/testing.md` "The smoke test" (lines 31–38) says "one write-then-read per capability your app depends on" but nothing about files. The template's smoke test (`apps/template/tests/smoke/smoke.test.ts`) has no file transfer (`grep ticket` finds nothing), so no example shows a ticketed transfer on a stage.
3. **Connected test app.** `packages/framework/src/testing/connect.ts` `send` (lines 87–99) resolves `new URL(path, c.origin)`, so an absolute URL is accepted, but `request` (lines 139–153) adds the stage's session cookie, `Origin` and the smoke User-Agent to that request. Sending a storage URL through `t.request` would therefore send the app's session cookie to storage. Nothing in `testing.d.ts` (lines 55–61) says whether `request` takes absolute URLs. So the builder's split (relative → `t.request`, absolute → plain `fetch`) is the correct choice, but it is not documented anywhere it could have read.
4. **Proxy.** `fetch` from the smoke process reaches R2 only through the sandbox proxy when the process starts with `NODE_USE_ENV_PROXY=1` (`skill/reference/deploying.md` line 5; `smoke-cloud.ts` lines 5, 24–25 check it for the command). That covers the test's `fetch` as well, since Vitest runs in the same process (`smoke.ts` `runSmokeTests` uses `startVitest` in-process).
5. **No cloud evidence exists** to observe the form live: no `validation/cloudflare/` at this commit; FILES-AC-003 on Cloudflare is D-RUN's, held by DEC-0317.

### Cause chain

Ticket form designed target-neutral (evidence 1) → the skill describes only the in-process form and forbids reading tickets in app code (evidence 2) → no smoke example transfers a file (evidence 2) → `TestApp.request`'s handling of absolute URLs is unspecified, and it would leak the session cookie to storage (evidence 3) → the builder could only guess how a smoke test performs DEMO-AC-003 on a cloud.

### Proposed fix (E-01 path set; documentation only)

- `skill/reference/testing.md`, "The smoke test": add one paragraph for apps that use files: the ticket a route returns is JSON `{ url, method?, headers?, expiresAt }` on every target; `url` is a same-origin path locally and in-process, and an absolute signed storage URL on a cloud. Send a same-origin `url` through `t.request(url, { method, headers, body })`; send an absolute one with plain `fetch(url, { method, headers, body })`, never through `t.request` (it would add the stage's session cookie). Behind a proxy, `smoke` already needs `NODE_USE_ENV_PROXY=1`.
- `skill/reference/files.md`, "Testing": point to that paragraph, and qualify line 24 ("not yours to read or build") as applying to app code, not tests.
- `skill/examples/tests.md`: the caption of `WireUploadTicket` (line 95) says the same form holds on every target. The example code itself is copied from the reference app and stays unchanged (its source would change only if a reference/template test changes).
- Optional, larger alternative (needs a decision draft and a `testing.d.ts` change, B-16 owner): a `/testing` helper (`transfer(ticket, body?)`) so tests never touch the form. Not required to close the entry.

Cloud confirmation of the form remains F-03 / D-RUN (FILES-AC-003 on Cloudflare); record DEMO-AC-003 cloud as in entry 1.

### Verification

The skill tests (`tests/skill`, plan §1 Test economy rule 2), typecheck and lint. A fresh F-01 builder then writes the smoke upload from the skill alone; F-03 runs it on Cloudflare.

---

## Entry 3 — `id()` columns reject non-UUID path IDs with 400 `SQL.INVALID_VALUE`

**Classification: (b) skill gap.** The behaviour is designed; the skill does not say it, and one sentence of it points the other way.

### Symptom

`GET /api/posts/:id` with `eq(posts.id, c.req.param("id"))` and an ID like `no-such-post` answers 400 `SQL.INVALID_VALUE` instead of matching no row.

### Evidence

1. **Reproduction** (throwaway test, template schema, route `api.get("/notes/:id", … .where(eq(notes.id, c.req.param("id"))))`):
   ```
   E3 non-uuid: 400 {"error":{"code":"SQL.INVALID_VALUE","message":"notes.id: a string of length 12 is not an ID made by newId() (lowercase UUID v4)","requestId":"ced021ab-…"}}
   E3 uuid: 200 []
   ```
2. **Code.** `packages/framework/src/sql/values.ts` lines 45–47: for `id` and `ref`, a value that does not match `UUID_V4` (line 65, lowercase v4) raises `SQL.INVALID_VALUE`. The check runs in each column's Drizzle encoder, so it applies to comparisons as well as writes.
3. **Design.** `docs/components/sql.md` line 81: "Each column's rule runs where Drizzle binds a value for that column, so a value that breaks it raises `SQL.INVALID_VALUE` while the query is built … **for writes and for comparisons alike**." The decision log (line 1039) gives the reason: identical results on every dialect instead of an error on one and an empty result on the other. Line 1724 (SQL-AC-004): "`id()` values must be UUID v4 text (`not-a-uuid` → `SQL.INVALID_VALUE`)". Same on both dialects (builder saw it on sqlite and postgres).
4. **Skill.** `skill/reference/sql-and-migrations.md` line 13: `id()` is "text from `newId()`" (no UUID); line 26: "A value that breaks its column's rule is refused before the database with 400 `SQL.INVALID_VALUE`" (reads as writes; comparisons not mentioned). `skill/reference/http-and-validation.md` line 47: "Path parameters … are not validated for you; an ID that matches no row your caller may see is `HTTP.NOT_FOUND`", which suggests passing the raw parameter to `eq` gives 404. The template's `files.ts` validates body IDs with `z.uuid()` (line 12–13) but has no path-parameter route, so no example shows the pattern.

### Cause chain

Designed rule: ID values are UUID v4 and checked in comparisons (evidence 2–3) → the skill states neither the UUID form nor the comparison scope, and the HTTP reference implies an unmatched path ID is 404 (evidence 4) → a route passing a raw path parameter to `eq` answers 400 `SQL.INVALID_VALUE` for any non-UUID ID.

### Proposed fix (E-01 path set; documentation only)

- `skill/reference/sql-and-migrations.md`, "Tables": `id()` and `ref()` values are lowercase UUID v4 text (as `newId()` makes); the rule also applies to values you compare (`eq(notes.id, value)`), so a malformed value is 400 `SQL.INVALID_VALUE`, not "no row".
- `skill/reference/http-and-validation.md`, "Validating input" line 47: check a path ID with `z.uuid()` (`z.uuid().safeParse(c.req.param("id"))`) before querying, and answer `HTTP.NOT_FOUND` when it fails, as for an ID that matches no row.

No framework change: the cross-dialect rule is deliberate.

### Verification

`tests/skill`, typecheck, lint.

---

## Entry 4 — Disposing an `as()` test app disposes the shared app

**Classification: (b) contract/skill gap.** The in-process behaviour is a recorded design decision; neither the contract nor the skill states it, and it differs from the connected-stage behaviour.

### Symptom

`const a = base.as(mockUsers.user("x")); await a.dispose(); await base.request(…)` throws `this test app was disposed`.

### Evidence

1. **Reproduction** (throwaway test):
   ```
   E4 base after view dispose: Error: this test app was disposed
   E4 new view after dispose: Error: this test app was disposed
   ```
2. **Code (in-process).** `packages/framework/src/testing/test-app.ts`: every view shares one `Shared` object; `as(next)` returns `testApp(shared, next)` (lines 173–176); each view's `dispose` is `() => shared.dispose()` (line 200), which sets `shared.disposed = true` and closes PGlite and the platform proxy (lines 275–280); `request` throws when `shared.disposed` (line 159).
3. **Code (connected stage).** `packages/framework/src/testing/connect.ts`: `as` makes a new `connectedApp` with its own jar and its own `disposed` flag (lines 121–124, 155); its `dispose` only logs that view out (lines 163–170). So disposing a view there leaves `base` usable. The two implementations of the same `TestApp` differ.
4. **Design.** DEC-0193 (decision-log line 1494): "`dispose()` closes PGlite and the platform proxy; later requests reject." It does not say which views are affected. Contract `docs/contracts/ts/testing.d.ts` line 63–67: `as` "shares storage with the original"; line 80: `dispose` "Discards all state created by this test app. On a connected stage it only logs out". Neither says that disposing a view ends the original and its other views in-process.
5. **Skill.** `skill/reference/testing.md` line 17 (`as` "shares storage with `t`") and line 19 ("an `afterEach` that disposes every test app the test opened"). The examples dispose all views at the end (`skill/examples/tests.md` lines 34, 210–211, 274), which is safe either way, so they never show the effect.

### Cause chain

One shared in-process app behind every view (evidence 2), by design (evidence 4) → a view's `dispose` ends the shared app → later requests through any view throw. The contract and skill describe sharing storage but not shared disposal (evidence 4–5), and the connected implementation behaves differently (evidence 3), so a smoke test that disposes a view mid-test passes on a stage and fails under `verify`.

### Proposed fix

- `docs/contracts/ts/testing.d.ts` (B-16 path set): on `dispose`, "In-process, the original and every test app made from it with `as` share one app: disposing any of them disposes all. On a connected stage it only logs that test app out."
- `skill/reference/testing.md`, "In-process tests" (E-01): the same sentence after the `as` bullet: dispose views only at the end of the test (as the examples do).
- Not proposed: changing `test-app.ts` so a view's `dispose` is a no-op. That would change DEC-0193 behaviour and needs a decision; the documented behaviour is sufficient for the demo, which already disposes extra views with `base`.

### Verification

`tests/skill`, typecheck, lint (documentation only; the contract file is type-checked).

---

## Entry 5 — `smoke` writes its evidence to the repository-root `validation/` folder

**Classification: (b) skill gap.** The location is as designed; the skill does not name it. The builder's removal of the record also exposed a plan path-set gap (F-01 owns only `apps/demo/**`).

### Symptom

`cd apps/demo && npx prototype-framework smoke --target local` printed `smoke: evidence: validation/local/3nkk7am5tw9ehoh.json`, created at the repository root. The builder moved the record out of the repository (`apps/demo/BUILD-RECORD.md`, "Results").

### Evidence

1. **Code.** `packages/framework/src/cli/commands/smoke.ts`: header comment lines 16–17, "the record goes to `validation/<target>/<runId>.json` in the repository holding the app"; `smokeBinding` (lines 327–330) sets `root` to `git rev-parse --show-toplevel` run in the app directory; `evidence/writer.ts` lines 88 and 110–111 write to `join(root, "validation", target)`. The printed path is relative to that root (smoke.ts line 261). Unit test `smoke.unit.test.ts` lines 40–47, 85, 102 assert the root is the repository's.
2. **Design.** DEC-0275 (decision-log line 2123): "The record goes through `src/evidence` to `validation/<target>/<runId>.json` **in the git repository that holds the app**." `docs/components/cli.md` §2 "Repository layout" (line 61): `validation/` at the repository root holds "Evidence records". Plan line 240 (C-02): "the evidence writer in `FW/src/evidence/` (shared with `smoke`)": `smoke` and the compliance driver write to the same tree.
3. **Repository practice.** Evidence of this repository's runs is committed at the root, e.g. `validation/local/2au29i3yycjzbas.json` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md) (`git log`: `c249f1e E-RUN: local run …`). Plan F-03 (line 394): "evidence committed". So the demo's smoke record belongs in `validation/local/` at the root and should have been committed, not removed. For a standalone app in its own repository, the repository root is the app directory, so the record lands in `<app>/validation/`.
4. **Skill.** `skill/reference/testing.md` line 8 and `skill/reference/deploying.md` line 35 say only "`validation/<target>/<runId>.json`" / "under `validation/cloudflare/`", not relative to what.
5. **Plan.** F-01 "Owns: `apps/demo/**`" (plan line 386). The record is outside that set, so the builder, correctly keeping to its paths, could not commit it.

### Cause chain

Designed location is the git repository root (evidence 1–2) → in this monorepo that is outside `apps/demo` → the skill does not name the location (evidence 4) and F-01's path set excludes `validation/` (evidence 5) → the builder saw an unexpected write outside its paths and removed it, so the demo's local smoke run has no committed evidence record.

### Proposed fix

- `skill/reference/testing.md` line 8 (E-01): "writes an evidence record to `validation/<target>/<runId>.json` at the top of the git repository that holds the app (the app directory when the app is its own repository); commit it with the run's commit." Same qualifier in `skill/reference/deploying.md` line 35.
- `ai/implementation/plan.md` F-01 "Owns" (orchestrator): add "the `validation/local/<runId>.json` and `validation/local/<runId>/` that its own `smoke --target local` run writes", so the next builder commits the record instead of deleting it. F-03 already commits its evidence.
- No framework change.
- The demo's local smoke result for round 1 exists only in `BUILD-RECORD.md`; the next F-01 build (or F-03's local smoke) produces a committed record.

### Verification

`tests/skill`, typecheck, lint; the next F-01 build's commit contains `validation/local/<runId>.json` for its smoke run.

---

## Review

Independent root-cause review (prompt §8 step 2), branch `claude/implement-local-cloudflare-rc-f1-review` from `origin/claude/implement-local-cloudflare`. The reviewer did not diagnose these entries or write the framework, skill or demo. Local only; no Cloudflare calls. One throwaway unit test (`packages/framework/src/testing/zz-rc-review.unit.test.ts`, deleted, never committed) was run once with `npx vitest run` in `packages/framework` after `npm ci`. Nothing else was changed.

| # | Verdict | Change to the record |
| --- | --- | --- |
| 1 | ACCEPTED | The skill clarification becomes required |
| 2 | **REJECTED** | A framework defect (a) in `connect.ts` was missed; re-diagnose (§8 step 1) |
| 3 | ACCEPTED | — |
| 4 | ACCEPTED | — |
| 5 | ACCEPTED | — |

### Entry 1 — ACCEPTED, with one change

Evidence checked: `args.ts` `TARGETS` is `["local", "cloudflare"]`; prompt §4 "Do not build: the AWS adapters, the AWS target, or AWS provisioning"; plan §8.2 (line 410, detail "AWS phase not started"; line 413 lists "DEMO-AC-010 (AWS)"); plan F-EV (line 400) "AWS parts not-run"; DEC-0317 (decision-log line 2459) is `accepted`, not superseded, and holds every D1-dependent Cloudflare run; `validation/` holds only `local/` and `invalidations.md`. The recording is right:

- AWS: DEMO-AC-010 (AWS clause) and the AWS run of every cloud DEMO criterion are `not-run`, detail exactly "AWS phase not started".
- Cloudflare: F-03's, not F-01's. While DEC-0317 holds, `blocked` with detail exactly "D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset" (driver `--blocked`, DEC-0261). They must not be recorded `not-run`: they are blocked by an owner direction, not out of phase scope.

Change: the `skill/SKILL.md` clarification is **required**, not optional. Prompt §9 F says every `FRAMEWORK-ISSUE.md` entry is a defect to fix in the framework or the skill and the build repeats "until none remain". Without the clarification a fresh builder following hard rule 6 raises the same entry again, so the loop cannot end. Fix requirement (E-01): `skill/SKILL.md` ("Done means" or hard rule 6/7) states that a target this phase cannot reach (AWS not built; Cloudflare runs not part of the build) is listed as unfinished in the build record and is not a framework issue. Verification: `tests/skill`, and the next F-01 build raises no such entry.

### Entry 2 — REJECTED: there is a framework defect (a) in `connect.ts`

The record notices that `TestApp.request` on a connected stage "would send the app's session cookie to storage" and treats it as a documentation gap. It is a framework defect: the connected test app sends the stage's credentials to any host the caller names.

**Reproduction** (throwaway unit test using `connectWith` with a recording `fetch`; stage `https://app-test-x.sub.workers.dev`, target `cloudflare`, mock-login sets `fw_session=SECRET`; any other host answers with `Set-Cookie: storage=evil`). Calls through `base.as(mockUsers.user("u1"))`:

```
PUT https://acct.r2.cloudflarestorage.com/bucket/key?...  cookie: "fw_session=SECRET"                origin: "https://app-test-x.sub.workers.dev"
GET https://other.example/p   (from "//other.example/p")  cookie: "fw_session=SECRET; storage=evil"  origin: null
GET https://app-test-x.sub.workers.dev/api/hello          cookie: "fw_session=SECRET; storage=evil"  origin: null
```

**Cause** (`packages/framework/src/testing/connect.ts`):

1. `send` (line 92) builds `new URL(path, c.origin)`. An absolute URL, or a protocol-relative one like `//other.example/p`, replaces the stage origin, so the request goes to that host.
2. `request` (lines 149–151) adds the jar's cookies (the stage session cookie) whatever the URL's host. `send` (line 91) also adds the stage's `Origin`.
3. `storeCookies` (line 153) puts the foreign host's `Set-Cookie` into the same jar, and every later request sends it to the stage. A third-party host can therefore plant cookies on the app's session.

**Why this is a defect, not only a documentation gap:** `docs/contracts/ts/testing.d.ts` lines 57–61 define `request(path)` as "Sends a request to the app's API". Sending to another host breaks that contract. A test session cookie on a `test-` stage is still a credential: a mock-login session of any level, including `admin`, on a reachable stage. A cookie jar that sends credentials to any host and accepts cookies from any host is the defect, whatever the skill says. The in-process `createTestApp` (`test-app.ts` lines 158–169) routes any URL, absolute or not, to the in-process app and never leaves the process. So the two `TestApp` implementations disagree here too, and an absolute URL that "works" in-process silently goes to a third party on a stage.

**Revised classification:** (a) framework defect in `FW/src/testing/connect.ts` plus contract imprecision in `testing.d.ts` (both B-16's path set, plan line 186), together with the (b) skill gap the record already describes. The cloud verification of the ticket form remains (c) (entry 1).

**Fix requirements** (red-green, prompt §8 step 3):

1. Red: a test in `packages/framework/src/testing/connect.unit.test.ts` that calls `request` on a connected app logged in through `as(user)` with (i) an absolute URL on another origin, (ii) a protocol-relative `//host/path`, and asserts that it rejects, that the fake `fetch` saw no such request, and that no cookie or `Origin` reached the other host. It also asserts that a `Set-Cookie` from a non-stage response never enters the jar (moot once (i)–(ii) are refused, but the test pins it).
2. Green, `connect.ts`: `request` (and the `send` it uses) refuses any `path` whose resolved origin is not the stage origin, before sending anything. The error names the URL and says to send requests to other hosts, such as signed storage URLs, with plain `fetch`, never through the test app. An absolute URL on the stage's own origin may be accepted. `connectWith`'s probe and the login/logout paths keep working unchanged.
3. Same check in `test-app.ts` `request` (refuse a URL whose origin is not `TEST_APP_ORIGIN`), so in-process and connected runs fail the same way. Otherwise a test passes under `verify` and fails on a stage. Unit test in `test-app.unit.test.ts`.
4. `testing.d.ts` `request` doc: "`path` is a path on the app's origin (or a URL on that origin); any other origin is refused. Send requests to other hosts with `fetch`."
5. The skill changes the record proposes still apply, with this rule. In `skill/reference/testing.md`, same-origin ticket `url` → `t.request`, absolute storage `url` → plain `fetch`, which `t.request` refuses. The demo's current split (`apps/demo/tests/smoke/smoke.test.ts` lines 36–39) already does this and stays valid.
6. Not a fix: documenting "do not pass absolute URLs" alone. The cookie jar must stay on the stage origin regardless of the caller.

Verification: the new unit tests fail before and pass after. Then the framework's `testing` unit tests, typecheck and lint, and `tests/skill` for the skill edits (plan §1 Test economy: only the affected tests).

The rest of entry 2 holds: files.md lines 69/79/90–91 describe the form, the skill covers only the in-process form, and the proxy note is right. The re-diagnosis needs to add the defect above and its fix. The documentation part can be carried over unchanged.

### Entry 3 — ACCEPTED

Checked: `sql/values.ts` lines 45–47 and the `UUID_V4` regex (lowercase v4) raise `SQL.INVALID_VALUE` in the encoder. `docs/components/sql.md` line 81 says "for writes and for comparisons alike". `skill/reference/sql-and-migrations.md` line 13 ("text from `newId()`") and `http-and-validation.md` line 47 (an unmatched path ID is `HTTP.NOT_FOUND`) are silent or misleading. The behaviour is deliberate: identical cross-dialect results. Alternative ruled out: a framework change would contradict sql.md. Fix as proposed: both skill pages, documentation only, with `z.uuid().safeParse` and then `HTTP.NOT_FOUND`.

### Entry 4 — ACCEPTED

Checked: `test-app.ts` gives every view one `Shared`, and each view's `dispose` is `() => shared.dispose()` (line 200). `connect.ts` gives each view its own `disposed` flag and jar (lines 121–124, 163–170). The `testing.d.ts` `dispose` doc does not say which views end. Fix as proposed (contract sentence in `testing.d.ts`, B-16; matching sentence in `skill/reference/testing.md`, E-01). Changing DEC-0193 behaviour is rightly not proposed without a decision. Note for the fixer: the entry-2 fix touches the same contract interface, so make both contract edits in one change.

### Entry 5 — ACCEPTED

Checked: `smoke.ts` `repo` (lines 327–330) uses `git rev-parse --show-toplevel` from the app directory. DEC-0275 says "in the git repository that holds the app". `skill/reference/testing.md` line 8 and `deploying.md` line 35 do not say where the record goes relative to the app. Plan F-01 "Owns: `apps/demo/**`" excludes `validation/`. Fix as proposed: both skill pages, and the plan's F-01 "Owns" extended to its own `validation/local/<runId>.json` and `<runId>/` (orchestrator).

---

## Entry 2 (revised) — the test apps send stage credentials to any host the caller names

Re-diagnosis after the review's rejection (prompt §8 step 1), by a diagnosing subagent that did not write the framework, on branch `claude/implement-local-cloudflare-diag-f2` from `origin/claude/implement-local-cloudflare` at `12a9d8c`. Local only; no Cloudflare calls. No code, contract, skill or demo changed. One throwaway unit test (`packages/framework/src/testing/zz-diag-f2.unit.test.ts`, deleted, never committed) was run with `npx vitest run` in `packages/framework` after `npm ci`. The original entry 2 above is kept; its documentation findings (its evidence 1, 2, 4 and 5) still hold and are carried into this entry.

**Classification: (a) framework defect** in `FW/src/testing/connect.ts` and `FW/src/testing/test-app.ts`, plus contract imprecision in `docs/contracts/ts/testing.d.ts` (all B-16's path set), together with the (b) skill gap of the original entry. Cloud verification of the ticket form stays (c) (entry 1).

### Symptom

`TestApp.request(path)` accepts an absolute URL (`https://other.host/...`) or a protocol-relative one (`//other.host/...`). On a connected stage it sends that request to the other host with the stage's session cookie, the stage's `Origin` and the smoke User-Agent, and it stores the other host's `Set-Cookie` in the jar it sends to the stage. In-process, it silently routes the same URL into the app.

### Evidence

1. **Reproduction, connected** (`connectWith` with a recording `fetch`; target `cloudflare`, stage `test-x`, base URL `https://app-test-x.sub.workers.dev`; mock-login answers `Set-Cookie: __Host-session=SECRET; Path=/; Secure; HttpOnly`; any other origin answers 200 with `Set-Cookie: storage=evil; Path=/`). Calls through `base.as(mockUsers.admin("a1"))`: a `PUT` to an R2-style signed URL, then `request("//other.example/p")`, then `request("/api/hello")`. Recorded requests, verbatim:
   ```
   SEEN GET https://app-test-x.sub.workers.dev/api/auth/me cookie=null origin=null ua="prototype-framework-smoke/0.1.0"
   SEEN POST https://app-test-x.sub.workers.dev/api/auth/mock-login cookie=null origin="https://app-test-x.sub.workers.dev" ua="prototype-framework-smoke/0.1.0"
   SEEN PUT https://acct.r2.cloudflarestorage.com/bucket/key?X-Amz-Signature=x cookie="__Host-session=SECRET" origin="https://app-test-x.sub.workers.dev" ua="prototype-framework-smoke/0.1.0"
   SEEN GET https://other.example/p cookie="__Host-session=SECRET; storage=evil" origin=null ua="prototype-framework-smoke/0.1.0"
   SEEN GET https://app-test-x.sub.workers.dev/api/hello cookie="__Host-session=SECRET; storage=evil" origin=null ua="prototype-framework-smoke/0.1.0"
   ```
   Line 3: an admin session cookie and the stage `Origin` went to storage. Line 4: a protocol-relative path left the stage, carrying the session and the cookie storage planted. Line 5: the planted cookie is now sent to the stage. This matches the reviewer's independent reproduction.
2. **Reproduction, in-process** (`createTestApp` over a one-route app, run from an empty temporary directory; `t.as(mockUsers.admin("a1")).request("https://acct.r2.cloudflarestorage.com/api/echo")`, the route echoing `c.req.url` and `c.var.user`):
   ```
   INPROC 200 {"url":"https://acct.r2.cloudflarestorage.com/api/echo","user":{"level":"admin","id":"a1","displayName":null}}
   ```
   Nothing leaves the process, but the app answers, as the admin, a request addressed to storage. A test that passes an absolute URL therefore "works" under `verify` and talks to a third party on a stage.
3. **Code path, connected** (`packages/framework/src/testing/connect.ts`):
   - `request` (line 151) adds `cookieHeader(jar)` to every request without looking at the target.
   - `send` (line 91) adds `Origin: c.origin` to every state-changing request; line 92 builds `new URL(path, c.origin)`. By WHATWG URL resolution an absolute URL or a `//host` reference replaces the base's origin, so the request goes to that host.
   - `request` (line 153) calls `storeCookies(jar, res)` on every response, so another host's `Set-Cookie` enters the jar and is sent to the stage on every later request.
   - The login (`logIn`), logout (`dispose`) and probe (`connectWith`) use fixed relative paths and are not affected.
4. **Code path, in-process** (`packages/framework/src/testing/test-app.ts`): `request` builds `new Request(new URL(path, TEST_APP_ORIGIN), …)` (line 165) and hands it to the in-process Hono app (`shared.fetch`), which routes on the path alone; the fixed identity from `as` applies (line 170). There is no origin check.
5. **Contract and design.** `docs/contracts/ts/testing.d.ts` `request`: "Sends a request to the app's API". A request to storage is not one. `docs/components/auth.md` line 37: on cloud targets the session cookie is "Secure and host-only" (`__Host-session`, line 74), so a browser never sends it to another host; the connected test app's jar has no host scoping at all, which breaks the rule the cookie's own attributes express. `docs/components/files.md` §2 lines 69 and 90: a cloud ticket `url` is an absolute R2 URL, `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`, so following a ticket is exactly the case that triggers the defect; storage needs no cookie (SigV4 query signing, line 91).
6. **Current exposure.** The demo's smoke test sends absolute ticket URLs with plain `fetch` (`apps/demo/tests/smoke/smoke.test.ts` `send`, lines 36–39), so no leak happens today. Its `^https?:\/\/` test would still route a `//host` URL through `t.request`; after the fix that becomes a clear error instead of a leak. The skill documents neither rule (original entry, evidence 2).

### Cause chain

`send` resolves the caller's string against the stage origin with `new URL`, which lets an absolute or protocol-relative URL replace the origin (evidence 3; observed in evidence 1) → `request` and `send` add the stage's session cookie and `Origin` without checking the target origin (evidence 3; evidence 1 lines 3–4) → the credential reaches the other host, and `storeCookies` keeps that host's `Set-Cookie` in the stage jar (evidence 1 line 5). In-process the same URL is routed into the app (evidence 2, 4), so the two `TestApp` implementations disagree and nothing under `verify` reveals the problem. The contract says only "the app's API" without saying what happens to other URLs, and the skill is silent (evidence 5–6), so a test author who follows an upload ticket with `t.request` on a cloud stage triggers it.

### Impact

- An app smoke test that follows a cloud upload or download ticket through `t.request` sends the stage's session cookie (any mock-login level, including `admin`; sessions are stateless and stay valid until expiry, auth.md line 37) and the stage `Origin` to R2, or to whatever host a ticket or response names. Anyone who can read that host's request logs can replay the session against the stage until it expires.
- Any host reached that way can plant cookies that the test app then sends to the stage, which can change what later stage requests do.
- The same test passes in-process and behaves differently on a stage, defeating the point of `verify` before `smoke`.
- Scope: test stages (`test-` prefix, enforced by `connectWith`) and the local `dev` server; other stages are refused. A test session is still a credential on a reachable stage.

### Alternatives ruled out

- **The recording `fetch` exaggerates.** Node's `fetch` (undici) has no cookie jar and sends an explicitly set `Cookie` header as given; `connect.ts` relies on exactly this to authenticate against the stage, and local `smoke` runs pass that way. It also sends to whatever URL it is given; `redirect: "manual"` only stops redirects. So the real `fetch` sends what the recorder saw.
- **Documentation-only fix** (the original entry). Rejected by the review and here: the jar must stay on the stage origin whatever the caller does, and the contract already says "the app's API".
- **Scoping cookies per host instead of refusing** (no cookie or `Origin` to other hosts, a per-host jar). This would make `request` a general HTTP client on a stage, while in-process it cannot reach other hosts at all (it routes into the app), so the two implementations would still disagree. Refusing gives the same loud result on both.
- **Blocking only strings that start with `https?://`.** Misses `//host/path` (evidence 1 line 4) and other forms that `new URL` resolves to another origin. The check must compare the resolved URL's origin.

### Proposed fix

Red-green (prompt §8 step 3). B-16 path set for code and contract; E-01 for the skill.

1. **Red, connected** (`packages/framework/src/testing/connect.unit.test.ts`): on an app from `as(user)`, `request` with (i) an absolute URL on another origin (an R2-style signed `PUT`), (ii) `//other.example/p`, (iii) `http://` to the stage's host when the stage is `https` (a different origin). Each rejects with the error below; the fake `fetch` saw no request to any other origin; no cookie or `Origin` reached another host; a later `request("/api/…")` sends only the stage's cookies. And (iv) an absolute URL on the stage's own origin is accepted.
2. **Red, in-process** (`packages/framework/src/testing/test-app.unit.test.ts`): `request` with (i) and (ii) rejects with the same error and the app receives no request; a URL on `TEST_APP_ORIGIN` is accepted.
3. **Green, `connect.ts`:** `request` resolves `new URL(path, c.origin)` and, when its `origin` is not `c.origin`, throws before logging in, before sending and before touching the jar. Put the same check in `send`, so no caller of `send` can reach another host. Error text (one helper shared with `test-app.ts`): `request("<path>"): <origin> is not the app's origin (<app origin>); the test app sends requests only to the app. Send requests to other hosts, such as a cloud upload or download ticket's url, with fetch.`
4. **Green, `test-app.ts`:** the same check in `request` against `TEST_APP_ORIGIN`, before building the `Request`. `loginWithStub` passes a same-origin path and is unaffected.
5. **Contract, `docs/contracts/ts/testing.d.ts` `request`:** add "`path` is a path on the app's origin, or a URL on that origin; a URL on any other origin is refused before anything is sent, on both test apps. Send requests to other hosts, such as a cloud ticket's `url`, with `fetch`." Make this edit in the same change as entry 4's `dispose` sentence (review note on entry 4).
6. **Skill (E-01),** the original entry's documentation fix with this rule. `skill/reference/testing.md` "The smoke test": the ticket a route returns is JSON `{ url, method?, headers?, expiresAt }` on every target; locally and in-process `url` is a same-origin path, sent with `t.request(url, { method, headers, body })`; on a cloud it is an absolute signed storage URL, sent with plain `fetch(url, { method: ticket.method ?? "GET", headers: ticket.headers, body })` and no cookie, because `t.request` refuses it. Show the choice as `ticket.url.startsWith("/") && !ticket.url.startsWith("//") ? t.request(…) : fetch(…)`. Behind a proxy, `smoke` already needs `NODE_USE_ENV_PROXY=1`. `skill/reference/files.md` "Testing" points to that paragraph and qualifies line 24 ("not yours to read or build") as applying to app code; the `skill/examples/tests.md` `WireUploadTicket` caption says the form is the same on every target.
7. The demo's smoke `send` (`apps/demo/tests/smoke/smoke.test.ts` lines 36–39) stays valid; the next F-01 build may adopt the skill's test. Not a fix requirement on F-01.

### Verification

The new unit tests in `connect.unit.test.ts` and `test-app.unit.test.ts` fail before the change (the request reaches the other origin, as in evidence 1–2) and pass after. Then the framework's `src/testing` unit tests, typecheck and lint (the contract file is type-checked), and `tests/skill` for the skill edits (plan §1 Test economy: only the affected tests). Cloud confirmation of the ticket form remains F-03 / D-RUN, recorded as in entry 1.

## Review (entry 2 revised)

Independent review (prompt §8 step 2) by a subagent that did not diagnose the failure, write the framework, or write the earlier review. Branch `claude/implement-local-cloudflare-rc-f2-review` from `origin/claude/implement-local-cloudflare`. Local only; nothing changed except this section.

**Verdict: ACCEPTED**, with the additions below made part of the fix.

### Links checked

- **Evidence 3 (connected code path)** holds against `connect.ts` as it stands: `request` adds `cookieHeader(jar)` (line 151) and calls `storeCookies` on every response (line 153); `send` adds `Origin` (line 91) and resolves `new URL(path, c.origin)` (line 92) with no origin check. Login, logout and probe use fixed relative paths.
- **Evidence 1** reproduced once with a minimal script (Node 22 `--experimental-strip-types` importing `connect.ts` directly; recording `fetch`; stage `https://app-test-x.sub.workers.dev`; `as(admin)`; every call `PUT` with `redirect: "follow"`):
  ```
  PUT https://other.example/a cookie=__Host-session=SECRET origin=https://app-test-x.sub.workers.dev redirect=manual
  PUT http://app-test-x.sub.workers.dev/b cookie=__Host-session=SECRET; evil=1 origin=https://app-test-x.sub.workers.dev redirect=manual
  PUT https://other.example/c cookie=__Host-session=SECRET; evil=1 ...      <- path "/\other.example/c"
  PUT https://app-test-x.sub.workers.dev/redir ... redirect=manual           -> 302 returned, not followed
  PUT https://app-test-x.sub.workers.dev/same ...                            <- "HTTPS://APP-TEST-X.sub.workers.dev:443/same"
  ```
  This confirms the record and adds two cases it does not name: `http:` to the stage's own host sends the session cookie in cleartext (the record's red test (iii) covers it), and `/\other.example/c` leaves the stage, because WHATWG URL parsing treats `\` as `/` for `http(s)`.
- **Evidence 4 (in-process)** holds: `test-app.ts` builds `new Request(new URL(path, TEST_APP_ORIGIN), …)` with no check, and `TEST_APP_ORIGIN` is `http://localhost:8787`.
- **Evidence 5** citations check out: `testing.d.ts` `request` says "Sends a request to the app's API"; auth.md line 37 (Secure and host-only on cloud, stateless sessions) and the `__Host-session` paragraph; files.md §2 lines 69 (ticket JSON), 90 (absolute R2 URL), 91 (SigV4 query signing, no cookie needed).
- **Evidence 6** holds: the demo's `send` (smoke.test.ts lines 36–39) uses `/^https?:\/\//`, so `//host` and `/\host` tickets would go through `t.request`.
- **Alternatives** are adequately ruled out. Per-host cookie scoping would leave the two `TestApp` implementations disagreeing; a prefix test misses `//host` and `/\host`; refusing on the resolved origin is the right cut.

### Redirects

- Connected: `send` spreads `init` first and then sets `redirect: "manual"`, so a caller's `redirect: "follow"` is overridden (confirmed above: the 302 is returned, nothing follows it). A stage redirect to another host therefore never carries the jar. No change needed; the red test should keep asserting this (a `redirect: "follow"` request to a stage route answering 302 to another host reaches no other host).
- In-process: `shared.fetch` is the app's own handler; nothing follows redirects.
- Plain `fetch` for tickets (the skill's route) follows redirects by default, but it carries no cookie or `Origin` from the test app, only the ticket's own headers (`Content-Type`), so a storage redirect leaks nothing.

### Same-origin requests

The fix compares `URL.origin`, which normalizes case and default ports (`HTTPS://HOST:443/x` resolves to the stage origin above), so relative paths and absolute same-origin URLs are unaffected. Login, logout, the probe and `loginWithStub` use same-origin paths and are unaffected.

### Fix requirements (in addition to the record's proposed fix)

1. **The check compares the resolved URL, not the string**: refuse unless `new URL(path, appOrigin)` has `origin === appOrigin` **and** `protocol` equal to the app's protocol. The protocol check closes `blob:https://<stage>/x`, whose `origin` equals the stage origin (it fails in `fetch` without network traffic today, but it is not "the app's API" and should get the same clear error on both test apps).
2. **Red tests add `"/\\other.example/p"`** (backslash form) on both test apps, and on the connected app a `redirect: "follow"` request to a same-origin route answering 302 to another host, asserting no request reached another origin. The in-process test also covers the `https://localhost:8787` scheme mismatch.
3. **The skill's discriminator must not misroute the backslash form**: use `/^\/(?![\/\\])/.test(ticket.url) ? t.request(…) : fetch(…)` (or equivalent) instead of `startsWith("/") && !startsWith("//")`. With the fix a misrouted URL is refused loudly rather than leaked, so this is a correctness requirement for the example, not a security one.
4. Everything else in the record's "Proposed fix" and "Verification" stands as written (check in both `request` and `send`, thrown before login, before sending and before touching the jar; shared error text; contract sentence in `testing.d.ts` together with entry 4's `dispose` sentence; skill E-01 edits; demo not a fix requirement on F-01).

---

## Fix (1, 3, 4, 5)

Branch `claude/implement-local-cloudflare-fix-f1` from `origin/claude/implement-local-cloudflare`. Documentation only; local only; no Cloudflare calls. Entry 2 is not touched here (re-diagnosis, separate fix). No example changed, so every example stays byte-identical to its source.

| # | Change |
| --- | --- |
| 1 | `skill/SKILL.md`: new hard rule 8 — a target this phase cannot reach (AWS not built; Cloudflare runs paused) is not a framework issue; no `FRAMEWORK-ISSUE.md` entry; the builder lists the affected requirements and checks as unfinished in the build record (`not-run`, "AWS phase not started"; `blocked` with the stated reason for paused Cloudflare runs). "Done means" points to it. |
| 3 | `skill/reference/sql-and-migrations.md`: `id()` / `ref()` values are lowercase UUID v4 text; the column rule applies to comparisons as well as writes (`eq(notes.id, "no-such-note")` is 400 `SQL.INVALID_VALUE`); validate request IDs with `z.uuid()`. `skill/reference/http-and-validation.md`: check a path ID with `z.uuid().safeParse(c.req.param("id"))` before querying and answer `HTTP.NOT_FOUND` when it fails. |
| 4 | `docs/contracts/ts/testing.d.ts`: `dispose` doc comment only (no type change): in-process, the original and its `as` test apps share one app, so disposing any disposes all; on a connected stage it only logs that test app out. Decision DEC-0409 (decision log, `Item: fix-f1`). `skill/reference/testing.md`: the same rule after the `as` bullet; dispose only at the end of the test. The entry-2 fix edits the `request` comment of the same interface, on different lines. |
| 5 | `skill/reference/testing.md` and `skill/reference/deploying.md`: the evidence record goes to `validation/<target>/` at the top of the git repository that holds the app (the app directory when the app is its own repository) and is committed with the run's commit. `ai/implementation/plan.md` F-01 "Owns": adds the `validation/local/<runId>.json` and `validation/local/<runId>/` that its own `smoke --target local` run writes. |

Red-green: these are documentation-only changes, so there is no failing test to write first (plan §1 "Test economy" rule 2). Checks: typecheck, lint, `tests/skill`. Sizes after the change: `SKILL.md` 7,068 bytes (PAR-070 8,000); `testing.md` 5,840, `deploying.md` 6,490, `sql-and-migrations.md` 9,277, `http-and-validation.md` 9,208 (PAR-071 12,000).

---

## Fix (entry 2)

Fixing subagent (prompt §8 step 3), which did not write the framework, diagnose or review. Branch `claude/implement-local-cloudflare-fix-f2` from `origin/claude/implement-local-cloudflare` at `65b52f0`. Local only; no Cloudflare calls.

### Change

- `packages/framework/src/testing/connect.ts`: new exported `appUrl(path, appOrigin)` resolves `new URL(path, appOrigin)` and throws unless the result's `origin` **and** `protocol` equal the app's (review requirement 1). Error text: `request("<path>"): <origin> is not the app's origin (<app origin>); the test app sends requests only to the app. Send requests to other hosts, such as a cloud upload or download ticket's url, with fetch.` (for a same-origin URL of another protocol, such as `blob:`, `<origin>` reads `a blob: URL`). `request` calls it before logging in, sending or touching the jar; `send` uses it to build the URL, so login, logout and the probe go through the same check. `redirect: "manual"` is unchanged.
- `packages/framework/src/testing/test-app.ts`: `request` calls `appUrl(path, TEST_APP_ORIGIN)` before building the `Request` (shared helper and text). `loginWithStub` passes same-origin paths and is unaffected.
- `docs/contracts/ts/testing.d.ts` `request` doc comment: the record's sentence, naming `//host`, `/\host`, another protocol and `blob:`. No type change. Entry 4's `dispose` sentence is fix-f1's (merged before this fix's rebase); both comments are kept.
- `skill/reference/testing.md` "The smoke test": `t.request` sends only to the app; the ticket JSON `{ url, method?, headers?, expiresAt }`; same-origin path via `t.request`, cloud absolute signed URL via plain `fetch` with no cookie; discriminator `/^\/(?![\/\\])/.test(ticket.url)` (review requirement 3); `NODE_USE_ENV_PROXY=1` behind a proxy. The record's `skill/reference/files.md` "Testing" pointer and `skill/examples/tests.md` `WireUploadTicket` caption edits were not in this fix's assignment, and fix-f1 did not make them (it left entry 2 alone): they remain open. Rebased on `origin/claude/implement-local-cloudflare` at `45433f6`; fix-f1's `testing.md` and `testing.d.ts` edits merged without conflict, and the two "Fix" sections of this record are both kept.

### Red, then green

Tests added: `connect.unit.test.ts` "refuses URLs on any other origin before sending" — as `admin` on a `https` stage: R2-style signed `PUT`, `//other.example/p`, `/\other.example/p`, `http:` on the stage host, `blob:https://<stage>/x` (each: rejects with the error, no new request sent, no request to another origin, a later `/api/…` sends only `fw_session=s1`); refusal before mock-login; `redirect: "follow"` to a stage route answering 302 to another host reaches no other host; absolute same-origin URLs (including `HTTPS://…:443`) accepted with the session. `test-app.unit.test.ts`: other host, `//host`, `/\host`, `https://localhost:8787`, `blob:http://localhost:8787/…` rejected; a refused `POST //other.example/api/notes` inserts nothing (next same-origin POST counts 1); `http://localhost:8787` and `HTTP://LOCALHOST:8787` accepted.

- Red (fix reverted, `npx vitest run --config vitest.unit.config.ts packages/framework/src/testing`): `7 failed | 39 passed (46)` — the five connected refusal cases, refusal-before-login, and the in-process case, each `promise resolved "Response { status: 200 … }" instead of rejecting` (the request reached the other origin, or the app answered it). The redirect and same-origin-accept tests passed before the fix, as the review predicted (they guard behaviour that must not change).
- Green: `46 passed (46)`.

### Checks (plan §1 Test economy)

- `vitest related` on `connect.ts`, `test-app.ts`: 13 files, 135 passed.
- `npm run build -w packages/framework`, `npm run typecheck`, `npm run lint`: pass.
- `packages/framework/test/integration/local` and `tests/skill`: before the rebase 34 passed, 1 failed (`[SKILL-AC-004]` demo overlap in `skill/examples/configuration.md` and `secrets.md`, files not touched here; fixed upstream by fix-e4); after the rebase 35 passed. `src/testing` unit tests 46 passed, typecheck and lint pass after the rebase.
- Compliance, `--target local` (evidence written under the scratchpad, not `validation/`): FILES-AC-001 passed; CORE-AC-002 and SEC-AC-001 passed after setting the reference app's local test secret (`npm run secrets -- set apiKey --target local --stage local`, gitignored `.dev.vars`; first run was `blocked` on it); SKILL-AC-004 failed before the rebase for the reason above; after the rebase SKILL-AC-004 and FILES-AC-001 passed.

### Remaining documentation (e-05)

Branch `claude/implement-local-cloudflare-e-05` from `origin/claude/implement-local-cloudflare`. Documentation only; local only; no Cloudflare calls. Closes the two edits left open above.

- `skill/reference/files.md`: the server-operations bullet now says the ticket's contents are not app code's to read or build, and that tests may read it. "Testing" adds that the ticket is the same JSON `{ url, method?, headers?, expiresAt }` on every target, and only `url` differs (a path on the app locally and in-process, an absolute signed storage URL on a cloud). A test sends a path with `t.request` and an absolute storage URL with plain `fetch`, never through `t.request` or another test helper, because the test app refuses other origins. It points to "The smoke test" in `testing.md`.
- `skill/examples/tests.md`: the `WireUploadTicket` caption is a doc comment inside the block copied from `apps/template/tests/app.test.ts`, so changing it would break SKILL-AC-004's byte-identity. The caption sentence in the page's "What it shows" prose says the same thing instead: the form is the same on every target, and a cloud URL is sent with plain `fetch`, never a test helper. The copied block is unchanged.
- Checks (plan §1 Test economy rule 2): `npm run typecheck` (after `npm run build -w packages/framework`), `npm run lint`, `npx vitest run tests/skill` (31 passed). Sizes: `files.md` 6,702 bytes (PAR-071 12,000), `examples/tests.md` 12,287 bytes (PAR-072 20,000).
