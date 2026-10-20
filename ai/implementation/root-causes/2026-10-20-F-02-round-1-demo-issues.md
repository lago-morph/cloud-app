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
3. **Repository practice.** Evidence of this repository's runs is committed at the root, e.g. `validation/local/2au29i3yycjzbas.json` (`git log`: `c249f1e E-RUN: local run …`). Plan F-03 (line 394): "evidence committed". So the demo's smoke record belongs in `validation/local/` at the root and should have been committed, not removed. For a standalone app in its own repository, the repository root is the app directory, so the record lands in `<app>/validation/`.
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
