# Spec: `persona-review-panel`

- **ID**: SKILL-SPEC-bce6acbdce
- **Source retrospective**: ../2026-10-19-3.md

## Intent

Run an independent, multi-persona review of a set of specification and design documents, let the personas challenge each other's findings, have a chair consolidate them into a short list of recommendations with verdicts, apply the accepted ones through file-owning editors, and close with a cross-file consistency pass. The owner of these documents does not read most of them and relies on the panel to find what a single reviewer misses; in the source session the panel found that the planned Cloudflare stop step (deleting the Worker) would also delete the app's secrets, a defect that had passed the author and an earlier single reviewer.

## Trigger

**Direct:**
- "review panel"
- "have a team of agents review the docs"
- "persona review"
- "argue it out and fix what makes sense"

**Proactive:** offer it when a large documentation set (more than about 15 files of spec, design or contracts) has just been written or restructured, and the owner has said they will not review all of it.

**Do not trigger:**
- for a single-file review;
- for code review (use a code-review skill);
- when the owner asked for review only, with no fixes. Then run phases 1–3 and stop before phase 4.

## Inputs

- **Document root:** for example `docs/`, and the files to read first (README, conventions, system spec, component map, decision log).
- **Owner ground rules**, stated as authoritative in every brief. In the source session:
  - the target scale: one or a few users, downtime is fine;
  - only identified requirements and contracts are binding;
  - owner-origin decisions may not be changed without the owner;
  - removed or not-adopted items must not be reintroduced;
  - forbidden topics (queues, webhooks).
- **An optional earlier document for a gap check:** give its absolute path, title and revision line.
- **The mechanical checker,** if one exists (for example `tools/check-docs.py`), so personas skip what it already covers.

## Outputs

- `panel.json`: the findings, the debate responses, and the chair's recommendations. Each recommendation has an ID, a verdict (`apply`, `reject` or `owner-decision`), a rationale, concrete changes, and `touchesOwnerDecision`.
- Edited documents, committed on the feature branch.
- One decision-log entry summarizing the applied changes (DEC-0077 in the source session).
- A short message to the owner listing the `owner-decision` items, each with the options and a recommendation.

## Workflow

1. **Scout inline.** List the files and decide which file groups the editors will own. Each group is a set of documents with no overlap, and each group keeps a design document together with its own contract files.
2. **Write the shared preamble** used in every persona brief: read-only, the files to read first, the owner ground rules, at most 12 findings, each with file references and a concrete recommendation.
3. **Choose personas.** Default set:
   - security
   - AI usability (can an implementing agent act on this?)
   - debugging and operability
   - **simplicity**, which argues the owner's side against over-engineering and is weighted heavily by the chair
   - portability
   - implementability
   - testability
   - gap check against the earlier document
4. **Phase "Review".** Run all personas in parallel, read-only. Brief the gap persona with the **exact absolute path, the title and the revision line** of the earlier document. Tell it which nearby files it must not use. Require every gap finding to cite line numbers in that document.
5. **Phase "Debate".** Each persona receives every other persona's findings and answers each one with agree, disagree or refine, plus a reason. It may add new findings.
6. **Phase "Chair".** One agent merges duplicates and gives each recommendation a verdict. Anything that would change an owner-origin decision gets `owner-decision`, never `apply`. Write `panel.json`.
7. **Phase "Apply".** Run one editor per file group, in parallel. **Each editor works in its own git worktree on its own branch.** Give every editor a "shared names" block: every new ID, route, type name and error code being introduced anywhere, so parallel editors use identical strings. Editors validate any JSON or YAML they edit and do not commit to the feature branch.
8. **Merge the editors' branches** into the feature branch only after each editor has finished.
9. **Phase "Check".** One read-only agent reads all the changed files together and lists cross-file inconsistencies: references to removed IDs, export lists missing new types, tables out of date. Run the mechanical checker as well.
10. **Fix the inconsistencies** with one agent. A single editor avoids new collisions.
11. **Run the mechanical checker again,** add the summary decision-log entry, commit and push.
12. **Report to the owner:** counts of findings, debate responses and recommendations (applied, rejected, owner-decision). For each owner-decision item give the options and a recommendation, then wait.
13. **If the workflow dies** (container restart, accidental stop), resume it with `resumeFromRunId`. Read `journal.jsonl` first to see which agents finished.

## Concrete examples

### Example 1: The source session's panel

- **Input:** 45 files under `docs/`, and the gap target `ai/spec/after_codex_review/Dual-Cloud_Prototyping_Framework___Specification.md` ("Revision 2").
- **Review and debate:** eight personas, 82 findings, 364 debate responses, which added 15 more findings.
- **Chair:** 38 recommendations. 33 were `apply`, 1 was `reject`, and 4 were `owner-decision` (R-1 to R-4). R-1 said that stopping the app by deleting the Worker loses its secrets.
- **Apply:** eight editors applied the 33.
- **Check:** found 22 cross-file problems caused by the parallel edits, for example `GOOGLE-AC-004` was retired but still listed as a milestone item, and `index.d.ts` was missing `ColumnBuilder` and `AtomicResults`. One agent fixed all 22.
- **Owner decisions:**
  - R-1: turn the `workers.dev` route off and on (DEC-0078)
  - R-2: restart the old app after a failed migration (DEC-0079)
  - R-3: add `framework.users` (DEC-0080)
  - R-4: identify test stages by the `test-` prefix (DEC-0081)

### Example 2: Recovery after a container restart

The workflow was killed when five of the eight reviews had finished. The owner then reported that the gap reviewer used the wrong file. The journal showed that the gap reviewer had not started yet.

The fix:
- tighten the gap persona's brief (exact path, title and revision, the files it must not use, line citations required);
- resume with `resumeFromRunId`.

The finished reviews came back from cache. Only implementability, gap, debate and chair ran again.

## Anti-patterns

- **Editors sharing one checkout while the orchestrator commits.** In the source session, the stop hook forced a commit (`7407ad2`) that captured another agent's half-finished edits. Use worktrees.
- **No shared-names block.** Parallel editors invent different names for the same new thing, which leads to the 22-problem consistency pass. The block shrinks it; the check pass is still required.
- **A gap reviewer briefed with a vague file reference.** A wrong file cannot be detected afterwards. Require line citations.
- **The chair applying owner-origin changes.** Those are always `owner-decision`.
- **Recommending removed or forbidden features again.** State the removed list in the preamble.
- **Skipping the simplicity persona.** It was the only remedy for over-engineering that worked in the source session.

## Acceptance criteria

- [ ] Every recommendation in `panel.json` has a verdict, and every one that touches an owner-origin decision is `owner-decision`.
- [ ] No two editors changed the same file, and each editor's work arrived as a separate branch.
- [ ] After the Check and Fix phases, the mechanical checker reports no new flags.
- [ ] The owner receives a list of decisions, each with options and a recommendation, and no owner-decision item was applied.
- [ ] A rerun after a simulated kill reuses finished agents from cache.

## Files this skill creates / modifies

- `<scratchpad>/panel.json`: findings, debate and recommendations.
- `docs/**`: the edited documents.
- `docs/decisions/decision-log.md`: one summary entry for the applied panel changes.
