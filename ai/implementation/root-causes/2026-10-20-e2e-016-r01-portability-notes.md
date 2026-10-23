# Root cause: E2E-016 R-01, seven component documents have no portability note

Author: diagnosing subagent (prompt §8 step 1). I wrote none of the documents or code involved. This is a diagnosis only: no document or code was changed. It needs an independent review (§8 step 2) before anyone fixes it.

Branch: `claude/implement-local-cloudflare-diag-f04`, reset to `claude/implement-local-cloudflare` `b59ec88` ("Merge F-04 architecture review (E2E-016)"). Read-only work: grep, `git log`/`git show`. No test suites and no Cloudflare calls.

## Symptom

`validation/reviews/E2E-016.md`, check 1, finding R-01 (blocking): 7 of 19 documents under `docs/components/` have no portability note: `aws.md`, `check.md`, `cli.md`, `cloudflare.md`, `compliance.md`, `local.md`, `skill.md`. E2E-016 passes only when "the review is recorded with its findings resolved" (`docs/acceptance/e2e-scenarios.md:171`).

## Short answer

The finding is correct, and the reviewer did not read the requirement too broadly. E2E-016 asks for a note in "each component document", with no exemption. The component map lists the target components (LOCAL, CF, AWS) and the tooling components (PROV, CHECK, CLI, COMPL, SKILL) as components, each with a document under `docs/components/`. PROV is a tooling component and already has a note. The seven documents were written without a `## 5. Portability note` section in commit `7e73f85`. That same commit gave one to `auth.md`, `google.md` and `provisioning.md`. E2E-016 was added later (`052b117`), and nothing checked the documents against it until F-04. **Fix: docs only. Add a short `## 5. Portability note` to each of the seven documents (text below), each by the item that owns the document. `aws.md` first needs an owner assigned by a planning subagent.**

## Evidence

E1. **The wording of the check.** `docs/acceptance/e2e-scenarios.md:163-171` (E2E-016, "Verifies: SYS-REQ-002, SYS-REQ-003, SYS-REQ-005, SYS-REQ-007"): "A review, a milestone checklist item, then confirms three things: - each component document has a portability note; …". Pass: "the scan finds nothing, and the review is recorded with its findings resolved." `ai/implementation/plan.md:397` (F-04) uses the same words: "every component doc has a portability note". `ai/prompts/implement-local-cloudflare.md` has no other wording for it.

E2. **No document defines a portability note further.** `grep -rni "portability note"` over `docs/`, `ai/implementation/plan.md` and `ai/prompts/` finds only E1's two lines, the twelve section headings, and `plan.md:58` (a mention of files.md §5). `docs/CONVENTIONS.md` (§7 "Document set") says only "`components/` | One design document per component". It defines no section template. `docs/decisions/decision-log.md` has no entry about the note. So the note's place and content come only from the existing practice (E4).

E3. **"Component document" covers targets and tooling.** `docs/architecture/component-map.md` §2 lists components under "Foundation", "Capabilities", "Targets" (LOCAL → `local.md`, CF → `cloudflare.md`, AWS → `aws.md`) and "Tooling and delivery" (PROV, CHECK, CLI, COMPL, SKILL → their `docs/components/*.md`, and DEMO → `docs/demo/demo-spec.md`). Its §1 line 7 says that adding a target "does change the few places that enumerate targets: the `./targets/<target>` subpaths (CORE-REQ-005), the `target` enumerations in the log-entry and evidence schemas, the SEC-REQ-003 storage table, and the targets COMPL-REQ-001 runs on". So the tooling components have portability content. CONVENTIONS §7 lists `demo/` ("Demo application specification") apart from `components/` ("One design document per component"), so `demo-spec.md` is an app specification, not a component document. The reviewer's count of 19 (only `docs/components/`) matches that reading.

E4. **How the twelve compliant documents phrase it.** Each has `## 5. Portability note` directly after `## 4. Acceptance criteria`. In `sql.md` it comes before `## 6. Open questions`, and in `google.md` and `migrations.md` before a trailing "Retired IDs" line. Each note is one to three sentences. Each says what a new target or provider would change, and that the app-facing contract does not change. Examples:
- `provisioning.md:121-123` (a tooling component): "The neutral declaration does not change for a new target. Only a new provisioner is added, implementing the per-target operations (§2), and it may use a different infrastructure tool (DEC-0019)."
- `core.md:93-95`: "A new target adds one adapter per capability, a `./targets/<target>` subpath (CORE-REQ-005), and its identifier to the target enumerations listed in the component map (§1). …"
- `http.md:83-85`: "A new target needs only a way to route `/api` to the runtime and serve static files from the same origin."
- `google.md:79-81`: "Another provider, such as GitHub, is a sibling adapter behind the same interface …; this one does not change."

E5. **The seven documents end at §4.** `grep -n "^## "` on each gives `1. Requirements`, `2. Design`, `3. Uses`, `4. Acceptance criteria` and nothing after: `aws.md:65`, `check.md:92`, `cli.md:101`, `cloudflare.md:64`, `compliance.md:73`, `local.md:56`, `skill.md:100` (the reviewer's line numbers are correct). None of them has a portability section elsewhere.

E6. **History: the notes were never written, and the check came later.** `git log -S "Portability note" -- docs/components` finds only `5dd6502` (CORE … LOG) and `7e73f85` ("docs: add AUTH, GOOGLE, target, PROV, CHECK, CLI, COMPL, SKILL designs"). `git show 7e73f85` adds ten documents with only three `## 5. Portability note` headings (auth, google, provisioning). The other seven documents of that commit are exactly R-01's seven. E2E-016's line "each component document has a portability note" was added in `052b117` (`git log -S "portability note" -- docs/acceptance/e2e-scenarios.md`), and `7e73f85` is an ancestor of `052b117` (`git merge-base --is-ancestor`). So the scenario was written over documents that already lacked notes, and it made no exemption for them.

E7. **No item has had the note in its task.** `plan.md` items B-14, B-16, B-17, C-02, D-01 and E-01 own the six documents (`plan.md:172,186,193,242,301,363`). None of their Task or Exit lines mentions a portability note. The only check is F-04 (`plan.md:396-397`), the first place the gap could be found.

E8. **Ownership of `aws.md`.** `grep -n "aws.md" ai/implementation/plan.md` finds only `plan.md:353` (D-EV excludes `aws.md` criteria). No item's "Owns" line names `docs/components/aws.md`. `plan.md:13`: "an item edits only the paths in its 'Owns' line … Needing to edit anything else = stop and return an open question". The scope rules ban AWS *code*: `plan.md:15` "nothing AWS (no adapters, target, provisioning, or placeholder code that pretends to work)", and prompt §4 "Do not build: the AWS adapters, the AWS target, or AWS provisioning; placeholder AWS code that pretends to work". A portability note is informative design text (CONVENTIONS §1), builds nothing and describes no behaviour that does not exist. Prompt §1: when the plan needs to change, "have a planning subagent revise it". The orchestrator does not edit documents.

## Chain (cause → symptom), with evidence for each link

1. Commit `7e73f85` wrote seven component documents without the `## 5. Portability note` section that the other twelve have (E5, E6).
2. E2E-016 was written afterwards. It requires the note in "each component document", with no exemption (E1, E6), and "component document" includes target and tooling documents (E3; PROV already complies, E4).
3. No plan item had the note in its task, and nothing checked for it before F-04 (E7).
4. F-04's reviewer found seven documents without the section, so E2E-016 check 1 failed (symptom).

## Alternatives ruled out

- **The reviewer read the requirement too broadly** (only capability documents need a note). Ruled out. E2E-016 says "each component document". The component map defines targets and tooling as components with documents (E3). PROV, a tooling component written in the same commit, has a note (E4, E6). Component-map §1 names the places outside the capabilities that a new target changes, so the tooling and target documents have something real to say (E3). Exempting them would weaken the check, which prompt §8 forbids ("Never skip, delete or weaken a test to get a pass").
- **The demo specification also needs a note.** Not required. CONVENTIONS §7 separates `demo/` (an app specification) from `components/` (design documents per component) (E3). The demo is an app that may not see the target at all. The reviewer did not count it either. If the reviewer for §8 step 2 disagrees, a one-line note in `demo-spec.md` would be needed as well; E2E-015 owns that document's inputs.
- **A note exists under another heading.** Ruled out by E5: no section after §4, and no "portab…" section heading in any of the seven.

## Proposed fix (docs only)

Append `## 5. Portability note` after §4's table in each document, in the style of E4. The text is grounded in each document's own content. These are proposals: the owning item may tighten the wording, but each note must state what a new target changes in that component and what stays the same.

| Doc | Owner | Proposed note |
| --- | --- | --- |
| `docs/components/aws.md` | **Unassigned.** A planning subagent must add it to an item's Owns line (E8). Editing it is in scope: it is docs only, with no AWS code. | "This component is where AWS names belong: the Lambda and CloudFront runtime shape, the stage's resources and the per-target operations of PROV §2. App source and app-facing contracts do not change for it (SYS-REQ-001, SYS-REQ-003). Another target is a sibling component of the same shape plus one adapter per capability, and touches only the shared places the component map lists (§1); this component does not change." |
| `docs/components/cloudflare.md` | D-01 (`plan.md:301`) | "This component is where Cloudflare names belong: the Worker, D1, R2, Worker secrets and the `workers.dev` origin stay here and in each capability's Cloudflare adapter, never in app-facing contracts. A new target is a sibling component with its own runtime shape, stage resources and PROV §2 per-target operations, plus the shared places the component map lists (§1); this component does not change. LOCAL runs this component's stage runtime (DEC-0039), so a change here is also a change to LOCAL." |
| `docs/components/local.md` | B-16 (`plan.md:186`) | "LOCAL reuses the Cloudflare adapters and stage runtime (DEC-0039), with only the local differences listed in §2, so app code cannot tell it from a cloud target. A new cloud target does not change LOCAL. Replacing Wrangler as the local runtime would change only this component and the local parts of FILES and LOG; the Postgres harness stays, because it checks the dialect of the other targets (LOCAL-REQ-003)." |
| `docs/components/check.md` | B-14 (`plan.md:172`) | "The rules name no target: they enforce one portable surface (CORE-REQ-005's subpaths, SQL-REQ-002's subset). A new target adds its platform SDK, driver and Hono adapter packages to `allowed-imports`' rejected packages; target subpaths are already limited to generated entry points. The migration checker compares the two supported dialects; a target with a third dialect would add one history and one database to it (CHECK-REQ-004)." |
| `docs/components/cli.md` | B-17 (`plan.md:193`) | "The command table (CLI-REQ-001) does not change for a new target: `--target <t>` selects it, and the cloud commands call PROV's, MIG's and SEC's per-target operations. A new target adds only its value to `--target` and that wiring. `verify`, `dev`, `generate-migration` and `reset-local` are local and offline, so they do not change." |
| `docs/components/compliance.md` | C-02 (`plan.md:242`) | "The suite is one set of tests for every target (COMPL-REQ-001); only the criteria's Where columns differ between targets. A new target adds its value to the driver's `--target` and to the evidence schema's `target` enumeration (component map §1), and its leftover check uses that target's `listStageResources` (PROV §2). The tests do not change." |
| `docs/components/skill.md` | E-01 (`plan.md:363`) | "The skill teaches only the public exports and target-neutral rules. Only the owner tasks and troubleshooting have steps for each cloud (SKILL-REQ-006, §2 Troubleshooting). A new target adds its steps there and in the template README; the router, the other references, the examples and the template's code do not change." |

Grounding for the notes: `aws.md:3,40-59`; `cloudflare.md:104-132`; `local.md:185-192` (DEC-0039, shared `src/targets/cloudflare/stage.ts`), LOCAL-REQ-003; `check.md:18` and `src/check/rules/allowed-imports.ts:20-28` (the `DENIED_PACKAGES` and `HONO_PLATFORM` lists name Cloudflare, AWS and other platforms), `core.md:39` (target subpaths: "Generated entry points only"), `check.md:84`; `cli.md:14-26,85-95`; `compliance.md:12,59,65` (driver `--target <local|cloudflare|aws>`, leftover check via `listStageResources`); `skill.md:63-90` (Troubleshooting "per cloud", template README billable list).

Ownership note: `cloudflare.md` and `aws.md` are milestone-sensitive. COMPL-REQ-006 says a milestone item "MUST be run again after … a change to PROV, MIG, CF, AWS, or adapter code". I read "code" as covering the whole list, so a docs-only note does not invalidate milestone records. The fixer should record that reading in its decision draft, so that nobody adds an invalidation entry to `validation/invalidations.md` for it by mistake. This is an interpretation for the §8 reviewer to confirm, not a proven fact.

## Verification

- Documentation-only item (plan §1 Test economy rule 2): typecheck, lint and `tests/skill`. `tests/skill` covers skill references, not `docs/`. It is still the required gate, and `skill.md` changes.
- Mechanical check, to be re-run by the fixer and F-04's re-review: `for f in docs/components/*.md; do grep -q '^## 5. Portability note' "$f" || echo "$f"; done` prints nothing (today it prints exactly the seven files).
- An independent reviewer re-runs E2E-016 check 1 and records the resolution in `validation/reviews/E2E-016.md`.
- Affected criteria: E2E-016 (review part, milestone). No test or AC result changes.

## Evidence files

All cited by path and line above. Commands: `git log -S "Portability note" -- docs/components`, `git show 7e73f85 --stat`, `git log -S "portability note" -- docs/acceptance/e2e-scenarios.md`, `git merge-base --is-ancestor 7e73f85 052b117`, `grep -n "^## " docs/components/*.md`.

## Review

Reviewer: independent root-cause reviewer (prompt §8 step 2). I did not diagnose this failure or write any of the documents or code involved. Read-only review at `78e8c7a`; no Cloudflare calls; no test suites (a docs finding has nothing to reproduce beyond the grep).

**Verdict: agree-with-changes.** The cause, the chain and the docs-only fix are right. Four of the seven proposed note texts need corrections before they are written, and one citation is wrong.

### What I checked independently

- **Symptom.** `for f in docs/components/*.md; do grep -q '^## 5. Portability note' "$f" || echo "$f"; done` prints exactly `aws, check, cli, cloudflare, compliance, local, skill`; 12 of 19 documents have the heading. Confirmed.
- **Requirement.** `docs/acceptance/e2e-scenarios.md:163-171` says "each component document has a portability note" with no exemption. `docs/architecture/component-map.md:34-50` lists LOCAL, CF, AWS, PROV, CHECK, CLI, COMPL and SKILL as components with documents under `docs/components/`, and `:7` names the target-enumerating places outside the capabilities. The reviewer did not read the requirement too broadly. Confirmed.
- **Chain.** The ownership lines (`plan.md:172,186,193,242,301,363`) and the absence of any owner for `aws.md` (`plan.md` mentions it only at `:353`) are as stated. No item's Task names the note; F-04 (`plan.md:396-397`) is the first check. Links 1-4 hold.
- **DEMO.** `component-map.md:51` does list DEMO as a component whose document is `docs/demo/demo-spec.md`, so the "not a component document" argument is weaker than the record says. I still accept leaving `demo-spec.md` out for R-01: the F-04 reviewer scoped check 1 to `docs/components/`, the demo is an app specification that is an E2E-015 input (editing it mid F-02 changes that scenario's inputs), and its portability is already enforced by CHECK and E2E-002. **Required:** F-04's re-review must state this scope ruling in `validation/reviews/E2E-016.md`, so the question is decided on the record rather than found again.
- **COMPL-REQ-006 reading** (`docs/components/compliance.md:42`: "after a change to PROV, MIG, CF, AWS, or adapter code"). I agree that "code" qualifies the whole list, so a docs-only note invalidates no milestone record. It is also moot in practice: `validation/invalidations.md` has no entries, `validation/` holds no milestone evidence record (only local automated runs), and the one milestone item touched, E2E-016 (review part), is re-recorded by the re-review anyway. **No `validation/invalidations.md` entry** is needed. The fixer records the reading in its decision draft, as proposed.

### Note texts against each document's content

- **aws.md: accurate.** Lambda/CloudFront shape (`aws.md:3,12`), stage resources (`:22-31`), PROV §2 operations (`:49-59`). SYS-REQ-001/-003 (`docs/spec/system-spec.md:31-46`) say what the note says. The owner must still be assigned by a planning subagent (agree; scope rules ban AWS *code*, not design text).
- **cloudflare.md: accurate.** The LOCAL sentence is correct, but cite its real basis: `local.md:41` (DEC-0039) and `local.md:48` (both Workers run `src/targets/cloudflare/stage.ts`). Optional: add that this sharing must not make the abstractions Cloudflare-centric (SYS-REQ-002), since that is the portability risk this document carries.
- **local.md: needs changes.**
  1. Wrong citation: the record cites `local.md:185-192`, but the file has 63 lines. The DEC-0039 text is `local.md:41-44` and the shared stage runtime is `local.md:48`.
  2. Drop "Replacing Wrangler as the local runtime would change only this component and the local parts of FILES and LOG". Nothing in the document supports it. Wrangler's emulation (`getPlatformProxy`) is also used by the migration checker (`check.md:84`), `dev`'s migration step (`cli.md:93`), local SQL drivers (`sql.md:85`) and `createTestApp` (`local.md:50`).
  3. Replace "so app code cannot tell it from a cloud target" with "the app source is the same as on a cloud target (SYS-REQ-001)". The mock, non-Secure cookies and same-origin transfers are visible differences (`local.md:41-44`, LOCAL-REQ-004).
- **check.md: needs a change.** "The rules name no target" is false for `allowed-imports`. Its package list names `@cloudflare/`, `wrangler`, `miniflare`, `@aws-sdk/`, `sst`, `@pulumi/` and others (`packages/framework/src/check/rules/allowed-imports.ts:21-27`), and `HONO_PLATFORM` names `cloudflare-workers` and `aws-lambda` (`:30`). Reword the opening sentence to "The rules enforce one target-neutral surface (CORE-REQ-005's subpaths, SQL-REQ-002's subset); only `allowed-imports`' list of rejected platform packages and Hono platform modules names platforms." The rest is accurate.
- **cli.md: needs a change.** "the cloud commands call PROV's, MIG's and SEC's per-target operations" is inaccurate. The per-target operations, including `setSecret` and `createDatabase`/`copyDatabase`/`dropDatabase`, are PROV §2's (`cli.md:89`: "through PROV's `setSecret`"; `aws.md:49-59`, `cloudflare.md:57-66`). Say "PROV's per-target operations (PROV §2)". Also, `build` is not target-free: its generated entry imports `<package>/targets/<target>` (`local.md:46`). Say that a new target adds its `--target` value and its build and deploy wiring. The `verify`/`dev`/`generate-migration`/`reset-local` sentence is accurate.
- **compliance.md: needs a change.** "only the criteria's Where columns differ between targets" misstates COMPL-REQ-001 (`compliance.md:12`). Where columns belong to criteria, and per-target expectations exist where a criterion states them. Suggested: "The suite is one set of tests for every target (COMPL-REQ-001): the Where columns select the criteria that apply, and per-target expectations exist only where a criterion states them." Also add that a new target brings its own `prodcheck` stage and values file (COMPL-REQ-005, `compliance.md:61`) and its own component's criteria. Change "The tests do not change" to "Existing tests do not change". The `--target` and evidence-schema enumeration and the `listStageResources` leftover check are accurate (`:59,65`).
- **skill.md: accurate.** Troubleshooting is per cloud (`skill.md:83`), owner tasks per SKILL-REQ-006, and the template README lists AWS-specific billing (`:95`). Optional: name the template README's billable-resources list explicitly.

### Required changes before the fix

1. Rewrite the local, check, cli and compliance notes as above, and correct the `local.md` citation.
2. A planning subagent assigns `docs/components/aws.md` to an item's Owns line before the fix (as the record says).
3. F-04's re-review records the DEMO scope ruling.

Other parts stand: docs only; gate per plan §1 Test economy rule 2 (typecheck, lint, `tests/skill`); mechanical grep check; no invalidation entry; affected item E2E-016 (review part) only.
