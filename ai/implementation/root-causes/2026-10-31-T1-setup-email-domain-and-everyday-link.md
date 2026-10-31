# Root cause: 9 of T1's 18 rewritten SETUP criteria tests fail because `cloudflare-setup` still runs the v0.1.x email-domain step and still gives the everyday-token link and the four-line template, which the v0.2.0 criteria removed.

Author: item T1 (diagnosis, §7a.1.8 step 1), 2026-10-31. T1 is the test author, not the author of `cloudflare-setup`; there is no separate diagnoser subagent (subagents here cannot start one), so the diagnosis is T1's own and the independent review below is a fresh cloud session. Found on `v0.2.0/75-setup-criteria-tests` (based on 74a ← 74 ← `71m-merge-auth-provider-into-admin-app`, merged with `71n-path-map-after-removals`).

## Symptom
`tests/compliance/criteria/setup/bootstrap-v020.test.ts` (written from setup.md §4 as rewritten by DEC-0697): 9 failed, 9 passed. Failing: SETUP-AC-001 (no tokens), SETUP-AC-002 (everything current), SETUP-AC-003 × 4 (junk everyday, junk bootstrap, inactive everyday, everyday with a denied permission), SETUP-AC-004 (everyday short of a permission), SETUP-AC-007 (a copied `.env.cloudflare`), SETUP-AC-008 (Workers Free, no domain). No project in the file holds `CLOUDFLARE_EMAIL_DOMAIN`, which v0.2.0 no longer reads (SETUP-REQ-002 as amended).

## Evidence
1. Six failures print, and stop on, the email-domain question (exit 1):
   `Which domain should the sign-in emails come from? The account "Main account" has these domains on Cloudflare DNS: … Set CLOUDFLARE_EMAIL_DOMAIN … or run: npm run cloudflare-setup -- --email-domain <domain>` (AC-002, AC-003 junk bootstrap, AC-003 denied permission, AC-004, AC-007). AC-008 with the zones cleared prints `The account "Main account" has no domain on Cloudflare DNS. The sign-in emails need one: add a domain …` and exits 1.
2. With the email domain set, the same scenarios pass in C's older file (`cloudflare-setup.test.ts`, all of SETUP-AC-002…008 passed through `npm run compliance -- --target local --only SETUP-AC-…`, evidence of run1 in T1's scratch run, commit 39c87a0). So the stop is the email-domain step itself, not the token or account checks after it.
3. Source: `packages/framework/src/provision/cloudflare/cloudflare-setup.ts` lines 525–536 ("// 5. The email domain."): with no `--email-domain` and no `CLOUDFLARE_EMAIL_DOMAIN`, it lists the zones and `return stop(chooseDomainText(…))`, before the everyday token's quick check (line 557) and before any bad-paste report of the bootstrap token that the bootstrap branch (line 522) did not take. Line 795 is the no-zone stop.
4. The other three failures print the everyday-token link: `Replace it with a new token from this link: https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=…&name=prototype-framework` (AC-003 junk and inactive everyday token; `problemText`, line 766, uses `deepLink(KIND[slot])` for both slots). AC-001's no-token stop prints "Requirements: a domain on Cloudflare DNS …" (line 185), the everyday link, and `ENV_CLOUDFLARE_TEMPLATE` (`token-sources.ts` line 43), whose third line is `CLOUDFLARE_EMAIL_DOMAIN=`; the same four lines are written to `.env.cloudflare`.
5. The plan and decisions already name this gap: E's DEC-0716 ("Without a bootstrap token, `cloudflare-setup` … still reads an email domain and looks up its zone with the everyday token … C's follow-up 34a deletes `email.ts`, so it has to take that lookup out anyway"; "57z (with C's 34a) is a hard release blocker"); D's v020-D.md: the rewritten SETUP texts "describe the end state of v0.2.0, after C's PR 34 removes the email setup".

## Causal chain
1. setup.md §4 (DEC-0697) rewrote SETUP-AC-001…008 for v0.2.0: no email domain, no plan or domain requirement, a three-line template, and the admin app's Everyday token page in place of the everyday link (SETUP-REQ-002/003 amendments). Evidence: setup.md §1, §4.
2. C's PR 34 removed only the Workers Paid stop (commit 44e8cc9, "pure removal"); the email-domain step, the domain requirement, the template's email line and the everyday link remain, deferred to C's 34a (progress §3 C: "`done` except 34a"; DEC-0716). Evidence 3, 4, 5.
3. A run with no email domain therefore stops at step 5 before reaching the checks the criteria describe (evidence 1, 2), and the stops that remain still print the v0.1.x remedies (evidence 4).
4. The tests assert the rewritten criteria, so they fail. The tests are not wrong: each failing assertion is a clause of the rewritten criterion text.

## Alternatives ruled out
- *The new tests are wrong.* Each failing assertion quotes the rewritten criterion (for example SETUP-AC-003: "the admin app's Everyday token page for the everyday token"; SETUP-AC-008: "with no `CLOUDFLARE_EMAIL_DOMAIN` and no zone, the command does not stop for the plan or the domain"). Three construction errors found on the first run (a wrong import, a too-narrow "user token" pattern, and a protected-token clause asserted beyond SETUP-AC-005's text) were corrected before this count; those tests were never green.
- *The fake API answers differently from Cloudflare.* The stop comes from the command's own branch (evidence 3), before any API answer could matter; with `CLOUDFLARE_EMAIL_DOMAIN` set the same fake runs pass (evidence 2).
- *Order of tests or shared state.* Each test builds its own world and project; the failures reproduce when a single test is run alone (`-t "SETUP-AC-008"`).

## Proposed fix (outside T1's owned paths: C's `cloudflare-setup.ts` and `token-sources.ts`; §7a.1.8 step 4)
In C's 34a (or, if 34a does not take it, a `9x-fix-setup-v020-messages` PR based on the branch that holds 34a): remove step 5 (the email domain) and the no-zone stop; drop `CLOUDFLARE_EMAIL_DOMAIN` from `ENV_CLOUDFLARE_TEMPLATE` and from the no-token instructions; remove the "a domain on Cloudflare DNS" requirement and the everyday-token link from the no-token stop and say that the admin app makes the everyday token; make `problemText` for the everyday slot name the admin app's Everyday token page instead of `deepLink("everyday")`. C's older tests that assert the v0.1.x text (`cloudflare-setup.test.ts` SETUP-AC-001 "both links … four template lines", SETUP-AC-008 "no CLOUDFLARE_EMAIL_DOMAIN …", "no zone at all …") change with it, through §7a.1.9 (`behaviour-changed`, DEC-0697). T1 does not edit them.

## Verification plan
After the fix, on the branch that holds it merged with 75: `npm run compliance -- --target local --only SETUP-AC-001,SETUP-AC-002,SETUP-AC-003,SETUP-AC-004,SETUP-AC-005,SETUP-AC-006,SETUP-AC-007,SETUP-AC-008,SETUP-AC-010` reports every SETUP ID `passed`; `bootstrap-v020.test.ts` 18/18. The junk-bootstrap case must then report `CLOUDFLARE_BOOTSTRAP_TOKEN` with only the bootstrap link (today hidden behind the email-domain stop).

## Review
Status: awaiting review
