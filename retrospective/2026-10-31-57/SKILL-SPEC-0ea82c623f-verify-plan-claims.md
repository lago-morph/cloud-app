# Spec: `verify-plan-claims`

- **ID**: SKILL-SPEC-0ea82c623f
- **Source retrospective**: ../2026-10-31-57.md

## Intent

Before a plan, spec or addendum is merged, extended or handed to an implementing session, check every statement it makes about the repository as it is today (paths, IDs, what a test, scenario, workflow, decision or parameter currently says or does) against the repository itself, by fanning numbered claim lists out to parallel read-only subagents that each answer TRUE, FALSE or PARTLY with file:line evidence, and then correct the document from the verdicts. In the v0.2.0 plan merge, four such agents found about 25 wrong statements in two plans that had already been through two independent reviews and an owner review: E2E-008 described as a live owner sign-in when it is an automated check-login scenario, E2E-013 credited with capability-error coverage it does not have, deep-link permission IDs said to be looked up at run time when they are hard-coded, a README said to come from a release it postdates, and nonexistent PAR numbers inside a range marked superseded.

## Trigger

- **Direct:**
  - "make sure this is a valid delta from the current version";
  - "check the plan against the code";
  - "is this plan still accurate?";
  - "merge X into Y and make it consistent".
- **Proactive:**
  - a plan written in an earlier session is about to be merged, extended or handed to an implementing session;
  - a plan cites more than about 10 repository facts (paths, IDs, "today it does X").
- **Negative:**
  - a plan with no claims about current state (pure future design);
  - a document checked in this session with no repository changes since.

## Inputs

- The document or documents to check (paths).
- The baseline to check against: usually `main`, or a release version. Confirm it first, for example from the `version` fields in `packages/*/package.json`. A repository without tags can't be checked with `git describe`.
- The index of the spec (`docs/README.md`). The agents use it to find documents; they don't read everything.

## Outputs

- Per-agent verdict lists, kept in the orchestrator's context only. They are short by construction.
- The corrected document, with each correction placed where the plan already covers the fact.
- A list of points the verdicts expose that need a decision, given to the owner as standalone questions (context, options, effect of each). These are never silently decided.

## Workflow

1. **Extract the claims.** Read the document and list every statement about the present:
   - every backticked path;
   - every ID or ID range (DEC, PAR, REQ, AC, E2E);
   - every "today", "currently", "as in v0.1.1", "already", and every description of what an existing file, test, workflow or decision does.

   Skip statements about the future design.
2. **Group the claims** by area, so that each group sends one agent to the same files:
   - code and setup;
   - spec IDs (decision log, parameters, requirements);
   - e2e scenarios and the compliance harness;
   - test infrastructure and CI.

   Four groups of 12–16 claims each worked well.
3. **Brief one read-only agent per group, all in one message, so they run in parallel.** Each brief:
   - names the repository path and the baseline;
   - says "Do NOT edit any file", plus any hard reading limits (here: nothing under `retrospective/`);
   - numbers each claim and states it plainly as the document asserts it, so the agent can refute it;
   - asks for TRUE / FALSE / PARTLY with one line of evidence (file:line or command output). For FALSE or PARTLY, it asks what is true instead;
   - asks for a concise numbered reply matching the list, with no file dumps.
4. **While the agents run, do the structural work that doesn't depend on them:** section moves, renumbering, the assembly scaffolding. Do it in the scratchpad, never over the target file.
5. **Apply the verdicts.** For each FALSE or PARTLY:
   1. Find where the document already covers that fact. Correct it there.
   2. Before adding a new statement, grep the document for the fact's subject. If another section owns it, don't add it a second time.
   3. Never add detail the verdict didn't establish: no guesses about future names, no "or deploy" extensions.
6. **Turn the verdicts into decisions where needed.** A verdict that shows the plan relying on something that doesn't exist, or a choice nobody made, goes to the owner as a question with the evidence. Example: zone groups whose only users are being removed.
7. **Final read.** Grep for every `§` reference and every ID touched, and read the changed sections once more against each other. Then commit.

## Concrete examples

### Example 1: E2E-008 in the testing addendum

- **The claim as written:** "E2E-008: the live owner sign-in becomes `Cloud (milestone)`."
- **The brief stated it as:** "E2E-008 is a live owner sign-in / provider certification. Give its Where line."
- **The verdict:** PARTLY. E2E-008 is "Real login provider check (automated)": `check-login` over HTTP on `prodcheck`, every cloud run, with no owner step (`docs/acceptance/e2e-scenarios.md:92-98`).
- **The correction, in place in §7.1:** "E2E-008 (today 'Real login provider check (automated)': `check-login` on `prodcheck` on every cloud run) becomes two parts: the owner's live sign-in, `Cloud (milestone)`, and an automated `prodcheck` part …".
- **A knock-on correction in §6.1:** COMPL-REQ-006's milestone list gains the live parts of E2E-007 and E2E-008.

### Example 2: deep-link permission IDs

- **The claim:** "The deep link is generated as in v0.1.1, with group IDs looked up from `/tokens/permission_groups`."
- **The verdict:** FALSE as stated. The IDs are hard-coded in `provision/cloudflare/permissions.ts:43-58`, after being read once on 2026-10-26 (comment at line 19). The only run-time lookup is in `r2-token.ts:76`, for the signing credential.
- **The correction, in §5.1:** "…from the group IDs recorded in `provision/cloudflare/permissions.ts` (read once from `/tokens/permission_groups`, not at run time); the IDs of the new groups are in §2.1b."

### Example 3: a verdict that becomes an owner question

The agent's list of `setup-account` steps included `subdomain`. The temptation was to add "the workers.dev subdomain" to the admin app's account setup. A grep showed §5.1 already gives that job to the bootstrap, so nothing was added.

The zone-group finding went the other way. Zone Read was used only by email code being removed, so it became a question to the owner, and the owner chose to drop it.

## Anti-patterns

- **Trusting an earlier "review against the repository".** The addendum had one, and still misdescribed E2E-008, E2E-013, `prodcheck.ts` and three decisions.
- **One agent for everything.** One agent can't read four areas at once, and its context fills with file dumps.
- **Asking open questions ("check the e2e section").** These return essays. State each claim so it can be refuted.
- **Writing a partial file over the target while the agents run.** It truncated a 336-line plan in this session.
- **Adding the verdict's facts as new statements, without finding the section that already owns them.** That is how the subdomain contradiction was introduced.
- **Deciding what a verdict exposes, instead of asking.**

## Acceptance criteria

- [ ] Every current-state claim in the document was in exactly one agent's list.
- [ ] Every FALSE or PARTLY verdict resulted in a correction in place, or an explicit owner question.
- [ ] No correction added a statement that another section contradicts. Checked by grepping each corrected subject.
- [ ] No correction carries detail beyond what its verdict established.
- [ ] The agents edited nothing; `git status` was clean apart from the orchestrator's own edits.

## Files this skill creates / modifies

- The checked document(s): corrections in place.
- No other files. Verdicts stay in the orchestrator's context, and decisions go to the owner.
