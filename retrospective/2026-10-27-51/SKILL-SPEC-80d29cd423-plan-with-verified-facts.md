# Spec: `plan-with-verified-facts`

- **ID**: SKILL-SPEC-80d29cd423
- **Source retrospective**: ../2026-10-27-51.md

## Intent

Write an implementation plan for a later session that carries every fact this session already proved, each with its date, method, call count and exact values, under a section headed "Already verified. Don't redo.", and a separate list of what is still unverified, so the implementing agent neither repeats live tests that cost the owner's time nor builds on an assumption nobody checked. The v0.1.1 setup-wizard plan and the v0.2.0 auth plan were written this way at the owner's request, and the owner asked "What is still unverified?" as a direct follow-up, which only a plan with that split can answer in one line.

## Trigger

- **Direct:**
  - "write a plan for a new session";
  - "include details of the things you verified so the implementing agent doesn't redo them";
  - "what is still unverified?".
- **Proactive:** a design discussion produced live test results, and the implementation will run in a different session or after a compaction.
- **Negative:** a plan with no live or research findings behind it. A normal plan template is enough there.

## Inputs

- The design decisions agreed with the owner, quoted.
- The evidence: live test logs, API responses, screenshots the owner sent, and research agent reports with sources.
- What the plan builds on: an earlier release plan, and the current code on main.

## Outputs

`ai/implementation/plan-<name>.md` with these sections, in order:

1. **Header:** status, assumptions such as "Assumes v0.1.1 is merged", what breaks, and the line "Already established: §2 is done. Don't repeat it."
2. **§1 Goal and owner decisions:** a table D1…Dn, one sentence each, in the owner's terms.
3. **§2 Already verified. Don't redo.** One subsection per test session, each headed with its date and method ("live test", "API checks, 11 calls, read-only plus temporary tokens", "docs"). Each fact gives:
   - exact values: IDs, error codes, strings, response fields;
   - how it was shown.
4. **The remaining sections:** architecture, flows, setup, removals, testing, migration, work breakdown in parallel waves, and risks.
5. **Unverified items:** each marked *unverified* inline, where it's used, and collected in one list.

## Workflow

1. **Collect the evidence.** Gather every test result from this session into a scratch list: fact, value, date, method, source.
2. **Drop anything the evidence doesn't show directly.** If a fact rests on docs only, label it "docs" and not "verified".
3. **Write the exact values.** Error code `1001` with HTTP 400, not "an error". The 32-hex permission group ID prefix, not "the right group". Role string "Super Administrator - All Privileges", not "the admin role". Never write secrets, account IDs, zone IDs or private subdomains.
4. **Say what the agent must not redo, and why.** Most often the reason is that the test needs the owner's sign-in or a dashboard step.
5. **Mark each unverified assumption** inline with *unverified*, and say how to check it, for example "read it from `GET /accounts/{A}/roles`".
6. **Give the work-breakdown waves** with section references, so a parallel implementer can be briefed with "§3, §4" alone.
7. **Commit the plan on a branch and open a PR.** Plans go in the repo, never in the scratchpad.
8. **When asked "what is still unverified?",** answer from the collected list. Offer to verify the items you can check alone.

## Concrete examples

### Example 1: v0.2.0 auth plan, §2

`plan-v0.2.0-auth.md` §2.1 "Cloudflare OAuth: live test, 2026-10-26" records:
- `openid` survives only with `response_types ["code","id_token"]`;
- the client secret is shown only at creation;
- optional scopes are enforced, and a Workers list call is filtered to empty rather than refused.

§2.1a records the minimal-member test. §2.1b records "Bootstrap permissions and tooling: API checks, 2026-10-27 (11 API calls, read-only plus temporary tokens)".

When the owner asked "What is still unverified?", the answer was two items: the plain "Administrator" role string, and SST's `transform.worker` for Secrets Store bindings.

### Example 2: setup-wizard plan facts

`plan-setup-wizard.md` carries the token facts:
- creating a token holding Account API Tokens Write is refused (400, code 1001);
- a token can delete itself only with that permission (else 403/9109);
- `PUT /tokens/{id}` updates permissions and keeps the value;
- the deep links were verified from the owner's screenshots.

The implementing session ran the wizard work in parallel waves without repeating any of these tests.

## Anti-patterns

- **Writing "verified" for something read in docs only.**
- **Paraphrasing values** ("an admin role") so the implementer has to rediscover the exact string.
- **Leaving the plan in a sandbox path.** The owner can't open it, and the next session can't see it.
- **Burying unverified assumptions in prose** with no marker.
- **Recording secrets or account identifiers as "exact values".**

## Acceptance criteria

- Every §2 fact has a date and a method.
- Every assumption the plan relies on is either in §2 or marked *unverified*, and a grep for *unverified* gives the complete list.
- An implementer briefed with only the plan and a wave letter can start without asking the owner anything §2 already answers.
- No secret, account ID, zone ID or private subdomain appears in the file.

## Files this skill creates / modifies

- `ai/implementation/plan-<name>.md`: the plan.
- Optionally `ai/prompts/<name>.md`: the implementation prompt that points at the plan.
