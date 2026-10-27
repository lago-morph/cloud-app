# Spec: `owner-assisted-live-test`

- **ID**: SKILL-SPEC-b752fd328c
- **Source retrospective**: ../2026-10-27-51.md

## Intent

Run a live platform check that needs the owner's hands (a dashboard deep link, an OAuth consent, a sign-in as a second account) so that one round trip gives a conclusive, recorded result: the agent prepares everything it can alone, gives the owner numbered steps and says exactly what to send back, reads the evidence against an expected outcome written down beforehand, re-runs rather than infers when the evidence is ambiguous, and deletes every resource it created before reporting. In this session such checks settled the token deep links, the OAuth client behaviour and the minimal-member limits, and two of them needed a re-run because the first evidence did not match what the owner had actually done.

## Trigger

- **Direct:**
  - "generate a link I can test";
  - "create a test app I can log into";
  - "run the live test";
  - "I'll sign in, tell me what to do".
- **Proactive:** a design or plan depends on a platform behaviour that:
  - the docs don't state, or state ambiguously;
  - only a human can drive, because a dashboard page must be opened, a consent screen approved, or a second identity used.
- **Negative:**
  - the agent can verify it alone through the API or a public repo. Do that instead, and never ask the owner to do what a tool call can.
  - a check already recorded as verified in the current plan's "Already verified" section.

## Inputs

- The question, as one falsifiable sentence (for example, "a deep link with `permissionGroupKeys` pre-ticks email groups given by ID").
- The credentials the agent holds: proxy-injected API hosts, and environment variables present at session start.
- Where results are recorded: a plan file or an evidence folder in the repo.

## Outputs

- Numbered owner steps in chat, with links. Never tokens, account IDs or private subdomains.
- An evidence entry in the repo:
  - date;
  - method;
  - API call count;
  - expected vs observed;
  - verdict;
  - resources created and deleted.
- A clean account: a listing proving every test resource is gone.

## Workflow

1. **Write the expectation first.** Before creating anything, write in the evidence file:
   - the question;
   - the expected observation if true;
   - the expected observation if false;
   - which observation would be ambiguous.
2. **Prepare everything you can alone.** Using your own credentials, create the throwaway resources:
   - an OAuth client;
   - a test Worker;
   - a temporary token with a short expiry;
   - generated links.
   
   Give each one a run-scoped name prefix (for example `oauth-test-<run>`). Record each ID locally. Never print secrets.
3. **Give the owner numbered steps.** Each step is one action, and the steps:
   - say which account or identity to use ("sign in as the invited member, not yourself");
   - list what to send back: a screenshot of page X, or the text shown after step N;
   - end with "tell me if you did anything different from these steps".
4. **Wait.** Don't poll the owner. End the turn.
5. **Read the evidence against step 1.**
   - Match → record as verified.
   - Clearly opposite → record as refuted.
   - Anything else, including a count that doesn't match, an extra sign-in or a missing screenshot → ask the owner one question about what happened, then re-run the steps. Never record an inferred result.
6. **Check server-side where you can.** Confirm with your own API calls: list the authorizations, the token's permission groups, the D1 rows written.
7. **Clean up.** Delete every resource from step 2, then list the account's tokens, OAuth clients and Workers and compare them with the list taken before step 2. Report any difference.
8. **Record and report.** Update the evidence file with the verdict, the call count and the cleanup proof. In chat, tell the owner the verdict in one line and which plan items it settles.

## Concrete examples

### Example 1: dashboard token deep links

- **Question:** do `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=<url-encoded JSON>&name=…` links pre-tick permissions given by 32-hex group ID, including email groups?
- **Prepared:** two links, bootstrap (12 groups) and everyday (7). The group IDs were looked up from `GET /accounts/{id}/tokens/permission_groups`.
- **Owner steps:** open link 1, don't create the token, and screenshot the permissions summary. Then the same for link 2.
- **Observed:** the zone groups were all ticked, and the account groups showed "+4 more". A finding the docs didn't give: the scope always defaults to the entire account.
- **Recorded:** in the setup-wizard plan as verified (commits `e5b8867`, `fe9ec71`).
- **Cleanup:** nothing was created, so there was nothing to delete.

### Example 2: OAuth private client with a minimal member

- **Question:** can a member with only "HTTP Applications Read" sign in through a private client, and what can their token do?
- **Prepared:** a private confidential OAuth client and a test Worker with a callback that logs the scopes granted and the result of each API call. Names were prefixed with the run ID.
- **Owner steps:** invite the member (done by the owner), open the app in a private window, sign in as the member, approve, and screenshot the result.
- **Observed:** consent succeeded, but every API call beyond identity was refused. The token is capped by the member's role.
- **Ambiguity handled:** in the first phase the evidence showed two authorizations. The owner said "I signed in twice", and the phase was re-run and recorded clean.
- **Cleanup:** the client and the Worker were deleted. The token list was confirmed back to `admin`, `Read-all`, `prototype-r2-signing`.

## Anti-patterns

- **Asking the owner to check what a tool can check.** For example, asking whether a public repository holds a skill copy, when one clone answers it.
- **Recording a result the evidence doesn't directly show** ("probably the second sign-in was the member").
- **Leaving throwaway tokens behind.** In this session the owner found leftover `compliance-r2read-*` tokens in the dashboard before the agent did.
- **Asking the owner to paste a token or secret into chat** as part of the steps.
- **Putting the owner's name, account ID or workers.dev subdomain** in any link or recorded evidence.

## Acceptance criteria

- The evidence file has the expectation written before the result, with timestamps or commit order showing it.
- Every verdict is one of verified, refuted or re-run. None is "likely".
- The account's resource listing after the check equals the listing before it, and the comparison is recorded.
- The owner took at most one round of steps per conclusive result, plus one re-run when the evidence was ambiguous.

## Files this skill creates / modifies

- `ai/implementation/plan-*.md` or `validation/<area>/<run>/SUMMARY.md`: the evidence entry.
- No code files. Throwaway Workers live in the scratchpad and are deleted after the check.
