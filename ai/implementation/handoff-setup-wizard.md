# Handoff: setup wizard implementation

Plan: ai/implementation/plan-setup-wizard.md. Owner questions: ai/implementation/owner-questions.md.

Number ranges: b1 DEC-0563–0569/PAR-331–339; b2 DEC-0570–0576/PAR-340–349; b3 DEC-0577–0583/PAR-350–359; b4 DEC-0584–0590/PAR-360–369; b5 DEC-0591–0597/PAR-370–379; b6 DEC-0598–0604/PAR-380–389; fixes/tests DEC-0605–0619/PAR-390–399.

## Status (2026-10-27, FINAL — plan implemented, merged and verified)
- Merged to main: #32 b1 permissions; #33 b2 token sources + git safety; #34 b3 setup record + steps; #35 b5 starter, version-check, upgrade, framework skill copy; #38 b4 cloudflare-setup state machine; #36 b6 skill, settings deny rule, QUICKSTART, docs, spec (SETUP-REQ/AC); #41 AUTH-AC-011 test flake fix; #42 compliance criteria tests (SETUP-AC-001–010, CLI-AC-008, CLI-AC-001, SKILL-AC-007/008) + token-guard hardening (#39, #40 contained) + whole-feature review fixes (no unscoped npx; guard allow-lists; 429 stop not swallowed); #44 protected bootstrap kept, stops reported; #46 live defects D1 (network check probed the bare workers.dev host) and D2 (record-only upgrade reported); #45 live evidence. Every PR: CI green + independent review with no open blocker/major; fixes re-reviewed; defects diagnosed, diagnosis independently reviewed, fixed red-green.
- Verify: main c22151c, clean clone, `npm run verify` exit 0 (2527 unit tests) with the browser shim below; tests/compliance/criteria/setup 45/45 with CLOUDFLARE_* unset.
- Live pass (2026-10-26, evidence ai/implementation/spikes/live-wizard/live-pass-2026-10-26.md): all exercises passed through the guarded layer (owner token protected, wizard-named ≤2 h tokens, budgets, no 429, no guard refusals); in-place PUT with the top-level zone form accepted and value unchanged; real runs exit 0 after #46; account setup record upgraded to setupVersion 1 (frameworkVersion 0.1.0); all wizard tokens deleted; Workers/buckets/D1 match the preflight baseline. SETUP-AC-011's self-delete clause covered by fake API + plan §2 (owner question 20).
- Not done / open: owner-questions.md (20 items + ideas). No workflow-patch files were needed. Unrelated PR #43 (plan v0.2.0) was merged on main by another session meanwhile.
- Next (for the owner): review owner-questions.md; nothing else is in progress.

## Carried-forward minor findings (assigned to b4)
1. Deny on a stronger group marks the weaker missing; treat deny as "remake token", not "upgrade".
2. Specific-zone grant uses a nested form; switch to the documented top-level `com.cloudflare.api.account.zone.<Z>` form; verify live.
3. In-place PUT drops permission groups' `meta`.
4. policyCovers may count an account-scope group in a zone-only policy as granted on the account.
5. Dashboard single entire-account policy not tested.
6. applySetupSteps uses the record fallback under the bootstrap token (should read directly).
7. setup-account records FIRST_SETUP_VERSION unless setupVersion is wired (operations.ts).
8. First run after upgrade writes the record but prints "nothing changed".
9. Domain change writes {emailDomain} alone, dropping other fields (vs DEC-0577).
10. A symlinked .env.cloudflare becomes a regular file on rewrite.
11. missingCredentials counts a whitespace-only env value as present.
12. provision/public.ts doesn't re-export PERMISSIONS_VERSION/ACCOUNT_SETUP_VERSION, so upgrade step 4 prints "unknown".

## Verify in this sandbox
Run in a clean clone under the scratch area. The sandbox's Chromium is build 1243 while Playwright 1.64.1 wants 1248: make a dir of symlinks to /opt/pw-browsers/* plus `chromium_headless_shell-1248 -> chromium_headless_shell-1243` and `chromium-1248 -> chromium-1243`, and run with `PLAYWRIGHT_BROWSERS_PATH=<that dir> npm run verify`. Wave-1 main (b851020): verify passed with the shim (the only failure without it was tests/skill/example-pages.test.ts, "Executable doesn't exist").
