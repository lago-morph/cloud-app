# Handoff: setup wizard implementation

Plan: ai/implementation/plan-setup-wizard.md. Owner questions: ai/implementation/owner-questions.md.

Number ranges: b1 DEC-0563–0569/PAR-331–339; b2 DEC-0570–0576/PAR-340–349; b3 DEC-0577–0583/PAR-350–359; b4 DEC-0584–0590/PAR-360–369; b5 DEC-0591–0597/PAR-370–379; b6 DEC-0598–0604/PAR-380–389; fixes/tests DEC-0605–0619/PAR-390–399.

## Status (2026-10-26, after wave 1)
- Done (merged to main): #32 batch 1 permissions.ts (DEC-0563–0565, PAR-331–332); #33 batch 2 token-sources.ts, git-safety.ts, cli/cloudflare-settings.ts (DEC-0570–0574, PAR-340–343); #34 batch 3 setup-record.ts, setup-steps.ts (DEC-0577–0579); #35 batch 5 starter, runLocalSetup, version-check, upgrade, framework skill/ copy (DEC-0591–0597, PAR-371; PAR-370 retired). Each had CI green and an independent review with no open blocker/major (fixes re-reviewed).
- In progress: wave 2 — b4 cloudflare-setup state machine (branch claude/wizard-b4-state-machine; also resolves the carried-forward minor findings 1–12), b6 skill/settings deny/quickstart/docs/spec (claude/wizard-b6-skill-docs).
- Carried-forward minor findings: see the list below.
- Next: merge wave 2 (PR, CI, independent review), clean-clone verify; then test author (§6 criteria) + independent review of everything since the plan's merge (8cea04f); fixes red-green; live Cloudflare pass (step 6 guards); final handoff.
- Open questions: owner-questions.md.

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
