# Framework issues

Suspected framework defects found while building this app. Each entry is reproducible; none was worked around. While an entry is open, the requirements it blocks are unfinished and the app is not done.

None of the entries below blocks a requirement. They are open because the skill or framework should change, not because the demo is unfinished.

## 1. The scaffolder cannot be used for an app inside the framework repository, and copying the template breaks `npm ci`

- **Status:** open (not blocking)
- **Task attempted:** Start `apps/demo` from the template ("Starting a new app").
- **Contract or reference consulted:** `skill/reference/local-development.md`, "Starting a new app"; `skill/templates/README.md`; `apps/template/README.md` §1 step 1.
- **Minimal reproduction:** `skill/scripts/scaffold.mjs` rewrites the framework dependency to `file:vendor/<tarball>` and runs `npm install` inside the target. In this repository `apps/demo` is a root workspace, so that would add a nested install and change the dependency spec. Copying `apps/template` instead (keeping the exact pin, as the template README describes for the framework repository) and running `npm ci` at the repository root fails.
- **Observed code or diagnostic:** `npm ci` → `npm error code EUSAGE … can only install with an existing package-lock.json`; with `--loglevel verbose`: `loadVirtual Error: must not have multiple workspaces with the same name … package 'template' has conflicts in … apps/template … apps/demo`.
- **Expected:** The skill says how to start an app that lives inside the framework repository's workspaces, including that `package.json` `name` must change (it is not one of the pinned versions).
- **Workaround not taken:** Did not edit the root `package.json` or `package-lock.json`, or install the framework from a tarball. Changed only `apps/demo/package.json` `name` to `demo`, which the skill does not forbid.
- **Blocked requirements:** none.

## 2. A test cannot make only a file deletion fail after files have been stored

- **Status:** open (not blocking)
- **Task attempted:** DEMO-AC-003, "In a local test, a simulated file-deletion failure produces a `warn` log entry."
- **Contract or reference consulted:** `skill/reference/testing.md`, "In-process tests" (`unavailable`); `skill/reference/files.md`, "Testing".
- **Minimal reproduction:** `createTestApp(app, { unavailable: ["files"] })` makes every file operation fail from the start, so no photo can be uploaded or finalized in that test app, and `t.as(...)` shares the same setting. There is no option to fail `files.delete` alone, or to turn a capability off after setup.
- **Observed code or diagnostic:** In `tests/photos.test.ts` the failure is reached only through the cleanup's `files.list` of the post's prefix, on a post with no photos: the response is 204 and one `photos` `warn` entry reads `photo cleanup failed for deleted post <id>: FILES.UNAVAILABLE`. A post with stored photos whose deletion fails cannot be built in-process.
- **Expected:** A way to simulate the failure of one operation (or to make a capability unavailable after setup), so the test can store photos and then have their deletion fail.
- **Workaround not taken:** Did not wrap or mock `FilesService`, inject a fake into app code, or add a test-only route.
- **Blocked requirements:** none. DEMO-AC-003's failure clause is tested, but only for the prefix-cleanup path.

## 3. A download ticket cannot be described in a shared response type

- **Status:** open (not blocking)
- **Task attempted:** DEMO-REQ-003, returning each photo of a post with a fresh download ticket in a type shared by server and browser.
- **Contract or reference consulted:** `skill/reference/http-and-validation.md`, "Where code goes" (shared code may import only `zod`) and "Adding a route" step 1; `skill/reference/files.md`, "Server operations" ("its contents are not yours to read or build").
- **Minimal reproduction:** In `src/shared/types.ts`, `interface Photo { ticket: { url: string; expiresAt: number } }`, then on the server `const p: Photo = { …, ticket: await c.var.files.createDownloadTicket(name) }`; run `npx tsc -p tsconfig.json`.
- **Observed code or diagnostic:** `error TS2739: Type 'DownloadTicket' is missing the following properties from type 'PhotoTicket': url, expiresAt`.
- **Expected:** A documented way to put tickets in shared response types. The examples only type tickets inline in browser code (`{ ticket: DownloadTicket }`).
- **Workaround not taken:** No cast or `any`. The shared types take the ticket type as a parameter (`Photo<Ticket>`); the server uses `Awaited<ReturnType<FilesService["createDownloadTicket"]>>` and the browser uses `DownloadTicket` from `/client`.
- **Blocked requirements:** none.

## 4. `smoke` writes its evidence record outside the app directory

- **Status:** open (not blocking)
- **Task attempted:** Run the local smoke test (DEMO-REQ-010) and keep its evidence with the app.
- **Contract or reference consulted:** `skill/reference/testing.md`, "What runs your tests" (the evidence record goes to `validation/<target>/<runId>.json` at the top of the git repository).
- **Minimal reproduction:** In `apps/demo`, with `dev` running: `npm -w apps/demo run smoke -- --target local`.
- **Observed code or diagnostic:** `smoke: evidence: validation/local/3qs2wf6eexh09jl.json`, plus `validation/local/3qs2wf6eexh09jl/raw/`, written at the repository root. That is outside `apps/demo/`, the only place this build may change.
- **Expected:** A way to keep an app's evidence inside the app directory when the app is not its own repository.
- **Workaround not taken:** Did not change the smoke command. I moved the generated record unchanged to `apps/demo/validation-evidence/` and committed it there, so the root `validation/` is untouched.
- **Blocked requirements:** none.
