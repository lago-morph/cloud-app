# Root causes: F-02 round 2 — the four entries of `apps/demo/FRAMEWORK-ISSUE.md`

Diagnosed on branch `claude/implement-local-cloudflare-diag-f3` (from `origin/claude/implement-local-cloudflare` at `6e19571`, "Merge F-01 demo build round 2"). Local only; no Cloudflare calls. No code, docs, demo or tests changed. Per plan §1 "Test economy", only what each entry needed was run: `npm ci --dry-run` twice (entry 1), `npm ci` and `npm run build -w packages/framework` once, then one `tsc` run and one `runPortabilityRules` run over `apps/demo` with three throwaway files (entry 3; `apps/demo/src/shared/zz-diag.ts`, `zz-diag-b.ts`, `apps/demo/src/server/zz-diag.ts`, deleted afterwards, never committed). Entries 2 and 4 needed no run: the contract and code settle them.

Summary:

| # | Entry | Class | Fix owner |
| --- | --- | --- | --- |
| 1 | Scaffolder not usable for an app inside this repository; the copied name `template` breaks `npm ci` | (b) skill gap; the scaffolder's behaviour is (c) | E-01: `skill/reference/local-development.md` |
| 2 | A test cannot make only a file delete fail | (c) expected limitation, plus a one-sentence (b) skill note so the entry is not raised again | E-01: `skill/reference/testing.md` |
| 3 | A download ticket cannot be typed in a shared response type | (b) skill gap; the rule itself is by design (CORE-REQ-005, opaque tickets) | E-01: `skill/reference/http-and-validation.md` (or `files.md`) |
| 4 | `smoke` writes evidence outside `apps/demo` | none of (a)–(c); not a builder error either: the orchestrator's F-01 brief contradicted the plan | orchestrator: F-01 brief; move the record back |

No framework defect (a). No builder misunderstanding (d): in entries 1–3 the skill was silent; in entry 4 the builder obeyed its brief.

---

## Entry 1 — the scaffolder does not fit an app inside this repository, and the name `template` breaks `npm ci`

**Classification: (b) skill gap.** The scaffolder is designed for a new app in its own directory outside the framework repository; that is (c), not a defect. The skill does not say how to start an app that lives in this repository's workspaces.

### Symptom

Copying `apps/template` to `apps/demo` unchanged and running `npm ci` at the root fails with `EUSAGE`; verbose: `must not have multiple workspaces with the same name … 'template'`.

### Evidence

1. **Reproduction.** With `apps/demo/package.json` `name` set to `template` (temporarily, restored with `git checkout`), `npm ci --ignore-scripts --dry-run --loglevel verbose` at the root prints `npm verbose loadVirtual Error: must not have multiple workspaces with the same name` and `npm error code EUSAGE`. With the committed name `demo`, the same dry run completes.
2. **Root workspace already expects `demo`.** Root `package.json` `workspaces` lists `apps/demo`; `package-lock.json` has `"apps/demo": { "version": "0.0.0" }` (line 29) and `"node_modules/demo": { "resolved": "apps/demo", "link": true }` (line 2919). These came from `9e6d808 B-01: workspace bootstrap`. So the repository was set up for a workspace named `demo`, and `npm ci` (which never rewrites the lockfile) can only succeed with that name.
3. **Scaffolder.** `skill/scripts/scaffold.mjs` copies the template, rewrites the framework dependency to `file:vendor/<tgz>` and runs `install(target)`; it never changes `name`. For a separate app that is harmless (one package, no workspace). Inside this repository it would change the dependency spec of a root workspace and run a nested install, which is why the builder did not use it.
4. **Skill.** `skill/reference/local-development.md` "Starting a new app" (lines 5–20) shows only `skill/scripts/scaffold ../my-app` (a directory outside the repository) and step 1 "Set the app's name in `src/app.ts`". `apps/template/README.md` §1 step 1 has a "framework's own repository" branch, but it is written for `apps/template` itself. Nothing says that an app copied inside the repository needs its own `package.json` `name`.

### Cause chain

The demo must live in this repository as the workspace `apps/demo` (evidence 2) → the scaffolder targets separate apps (evidence 3), so the builder copied the template by hand → the copy keeps `name: "template"`, a second workspace with that name → npm refuses to load the workspace tree (evidence 1) → the skill does not mention this case (evidence 4), so the builder found the fix by diagnosis and raised the gap.

### Proposed fix (smallest)

- `skill/reference/local-development.md`, "Starting a new app", one short paragraph after the scaffold block: "Inside the framework repository (an app folder already listed in the root `workspaces`, such as `apps/demo`), do not run the scaffolder: copy `apps/template` without `node_modules`, `dist`, `.framework`, `.wrangler`, `.logs` and `.dev.vars`, set `package.json` `name` to the folder name (every workspace needs its own name; the root `package-lock.json` already lists it), then run `npm ci` and `npm run build -w packages/framework` at the repository root."
- No scaffolder change: it is not used for this case, and renaming packages in separate apps fixes nothing (§3).

### Builder's workaround

**Keep** `apps/demo/package.json` `name: "demo"`. It is what the lockfile requires (evidence 2) and is not a pinned version.

### Verification

`tests/skill` (size budgets, links); the next F-01 build copies the template and runs `npm ci` without raising this entry.

---

## Entry 2 — a test cannot make only a file deletion fail after files are stored

**Classification: (c) expected limitation, not a defect**, with a one-sentence (b) skill note so a fresh builder does not raise it again. A per-operation fault-injection hook is **not** warranted.

### Symptom

`createTestApp(app, { unavailable: ["files"] })` fails every files operation from creation, so the test cannot upload and finalize a photo and then have only its deletion fail. The demo's test covers the failure through a post with no photos.

### Evidence

1. **Contract.** `docs/contracts/ts/testing.d.ts` line 40–41: `unavailable` — "every operation of each one named throws its `*.UNAVAILABLE` code". Decision log line 1490 (B-16): `files` → "a store whose every operation rejects (`FILES.UNAVAILABLE`)"; line 1268: how to simulate is B-16's choice, "the simplest way". `TestApp` (lines 54–90) has no database or storage access and no way to change options after creation. So the builder's reading is correct: there is no per-operation failure.
2. **Requirements.** No FILES, CORE, COMPL or TEST requirement asks for per-operation fault injection (`grep -n "simulat\|fault\|inject"` over `docs/spec/system-spec.md`, `docs/components/files.md`, `core.md`, `compliance.md`, `docs/acceptance/e2e-scenarios.md`: no such requirement). The only consumer is DEMO-AC-003 (`docs/demo/demo-spec.md` line 78): "In a local test, a simulated file-deletion failure produces a `warn` log entry", with line 72 saying that clause is verified by local tests. It asks for *a* simulated failure, not one after stored photos.
3. **The demo's code has one failure path.** `apps/demo/src/server/routes/posts.ts` `removePhotoFiles` (lines 44–57) wraps the per-photo `files.delete`, the prefix `files.list` and its `files.delete` calls in one `try/catch` that writes the `warn`. Any files failure during cleanup, from any of those calls, reaches the same catch and the same log line. The test (`apps/demo/tests/photos.test.ts` lines 74–83) asserts 204, the post is gone (404), and exactly one `photos` `warn` with `FILES.UNAVAILABLE`. That is the failure clause of DEMO-AC-003 and DEMO-REQ-003 ("the failure is logged and the post is still deleted").
4. **Skill.** `skill/reference/testing.md` line 15 and `skill/reference/files.md` line 54 describe `unavailable` correctly but do not say it applies from creation for the whole test app, or how to test a cleanup failure with it.

### Cause chain

`unavailable` is per capability and fixed at creation, by design (evidence 1) → a test cannot have stored files and then a failing delete → the builder expected per-operation injection; the criterion only needs a simulated deletion failure, which the existing option provides through the same catch (evidence 2–3) → the skill does not say so (evidence 4), so the builder raised it.

### Why no test-only hook

Prompt §3: build the smallest thing that meets the requirement; the owner rejects machinery for critical systems. A per-operation or switchable fault hook would be a new `TestAppOptions` contract surface (B-16) and FILES adapter plumbing that no requirement asks for (evidence 2), to test a branch that shares one catch with the branch already tested (evidence 3).

### Proposed fix

- `skill/reference/testing.md`, "In-process tests", after the options list, one sentence: "`unavailable` holds for the whole test app from creation; there is no per-operation failure. To test that a failed cleanup is logged and the request still succeeds, make the capability unavailable and run the request that cleans up, keeping one `try/catch` around the whole cleanup so every failure takes that path."
- No framework or contract change. Close the entry.

### Builder's workaround

Not a workaround; the demo's test stays as it is.

### Verification

`tests/skill`; the next F-01 build does not raise this entry.

---

## Entry 3 — a download ticket cannot be described in a shared response type

**Classification: (b) skill gap.** The behaviour is by design: shared code may import nothing from the framework (CORE-REQ-005), and tickets are opaque.

### Symptom

A shared `interface Photo { ticket: { url: string; expiresAt: number } }` does not accept the server's ticket: `TS2739`.

### Evidence

1. **Reproduction (throwaway files, `npx tsc -p tsconfig.json --noEmit` in `apps/demo`).** Shared `PhotoA { ticket: { url: string; expiresAt: number } }`, server `const p: PhotoA = { id: "x", ticket: await files.createDownloadTicket("n") }`:
   ```
   src/server/zz-diag.ts(4,32): error TS2739: Type 'DownloadTicket' is missing the following properties from type '{ readonly url: string; readonly expiresAt: number; }': url, expiresAt
   ```
2. **Reproduction (portability rules, `runPortabilityRules("apps/demo")` from `packages/framework/dist/check/public.js`).** Shared `import type { DownloadTicket } from "@lago-morph/prototype-framework/client"`:
   ```
   prototype-framework/allowed-imports  src/shared/zz-diag-b.ts  Import of "@lago-morph/prototype-framework/client": shared code may import nothing from the framework (CORE-REQ-005), not "@lago-morph/prototype-framework/client".
   ```
3. **Design.** `docs/contracts/ts/files.d.ts` lines 27–35: tickets are branded opaque types; "Its contents are not part of the contract." `docs/components/check.md` line 14 and line 72 (`allowed-imports`): shared code imports only `zod` and shared code, type-only imports included. `DownloadTicket` is exported from `.` (`docs/contracts/ts/index.d.ts` line 25) and from `./client` (`client.d.ts` line 11).
4. **Skill.** `skill/reference/http-and-validation.md` "Where code goes" (line 11: shared imports `zod` and shared code only) and "Adding a route" step 1 (line 19: "Declare the response type once in `src/shared/types.ts`"). `skill/reference/files.md` line 24: return the ticket as JSON; contents are not yours. The only typed example (`skill/examples/files-tickets.md` lines 100, 129) types tickets inline in browser code (`api<{ ticket: DownloadTicket }>`), not in a shared type. No page combines the three rules for a response that contains a ticket.

### Cause chain

Step 1 says every response type lives in shared code (evidence 4) → shared code cannot name the ticket type (evidence 2–3) → a structural stand-in does not match the opaque brand (evidence 1) → the skill shows no pattern, so the builder invented one (a type parameter) and raised the gap.

### Proposed fix

- `skill/reference/http-and-validation.md`, "Adding a route" step 1, one sentence (or the same sentence in `files.md` "Server operations"): "A response that contains a ticket: shared code cannot name ticket types, so give the shared type a parameter (`interface Photo<T> { readonly ticket: T }`) and use `Photo<DownloadTicket>`, importing `type DownloadTicket` from `@lago-morph/prototype-framework` on the server and from `@lago-morph/prototype-framework/client` in the browser."
- No framework or contract change. Allowing shared code to import framework types would change CORE-REQ-005 (owner-approved) for a one-line typing convenience; not the smallest fix.

### Builder's workaround

**Keep** the type parameter: it is type-safe, uses no cast, and is the pattern proposed above. One simplification is open to a later build, not required: `apps/demo/src/server/posts.ts` line 6 derives `Ticket` as `Awaited<ReturnType<FilesService["createDownloadTicket"]>>`; `type DownloadTicket` imported from `@lago-morph/prototype-framework` is the same type and is exported for this (evidence 3).

### Verification

`tests/skill` (including example type checks if the sentence carries code); the next F-01 build does not raise this entry.

---

## Entry 4 — `smoke` writes its evidence outside `apps/demo`

**Classification: not a framework or skill defect, and not a builder misunderstanding.** The round-1 fix (entry 5, commit `ce28784`) documented the location in the skill and gave F-01 ownership of the record in the plan. The builder raised it again because the orchestrator's F-01 brief said "Work only in `apps/demo/**`", which contradicts the plan. It is an orchestration-brief gap.

### Why the builder still raised it

1. **Skill was fixed before this build.** `skill/reference/testing.md` line 8: the record goes to `validation/<target>/<runId>.json` "at the top of the git repository that holds the app (the app directory when the app is its own repository; commit the record with the run's commit)"; same in `deploying.md` line 35. Added by `ce28784` at 16:04; the round-2 build started at `a53852d`, 16:45. The builder cites this sentence in its entry, so it read and understood it.
2. **Plan was fixed too.** `ai/implementation/plan.md` F-01 "Owns": "`apps/demo/**`, plus the `validation/local/<runId>.json` and `validation/local/<runId>/` that its own `smoke --target local` run writes (commit them with the run's commit)" (same commit).
3. **The brief overrode both.** The F-01 round-2 brief (the first message of the builder's transcript, `subagents/agent-a14eed1a62a9010e4.jsonl` in this session) says under "Rules": "Work only in `apps/demo/**`." The builder's entry quotes exactly that constraint ("outside `apps/demo/`, the only place this build may change"). The brief did not carry the plan's added ownership. The builder obeyed the stricter instruction and, per hard rule 6, raised the conflict instead of writing outside its paths.
4. **Behaviour is as designed.** `packages/framework/src/cli/commands/smoke.ts` line 328 takes the root from `git rev-parse --show-toplevel` in the app directory; DEC-0275 "in the git repository that holds the app" (round-1 entry 5, evidence 1–2).

### The workaround must not stay

The record was moved to `apps/demo/validation-evidence/local-3qs2wf6eexh09jl.json` and `…/local-3qs2wf6eexh09jl/raw/` (commit `d96be11`). Evidence is read only from `validation/<target>/*.json` at the repository root: `tests/compliance/tools/records.ts` lines 9–14 (`join(root, "validation", target)`), used by the traceability and release report. In `apps/demo/validation-evidence/` the record is invisible to the report and to F-EV, and its file name no longer matches `<runId>.json`.

### Proposed fix

- **Orchestrator:** move the record back unchanged: `git mv apps/demo/validation-evidence/local-3qs2wf6eexh09jl.json validation/local/3qs2wf6eexh09jl.json` and `git mv apps/demo/validation-evidence/local-3qs2wf6eexh09jl validation/local/3qs2wf6eexh09jl`, remove `apps/demo/validation-evidence/`, and change the "Results" row of `apps/demo/BUILD-RECORD.md` to point at `validation/local/3qs2wf6eexh09jl.json`. The record names its run commit (`2778ee9`), so committing it later is valid.
- **Orchestrator:** the next F-01 brief states the plan's "Owns" verbatim: "Work only in `apps/demo/**`, plus the `validation/local/<runId>.json` and `validation/local/<runId>/` your own `smoke --target local` run writes; commit them."
- No framework, skill or plan change. Close the entry.

### Verification

`validation/local/3qs2wf6eexh09jl.json` exists at the root and the compliance report tooling lists it; the next F-01 build commits its smoke record under `validation/local/` and raises no such entry.
