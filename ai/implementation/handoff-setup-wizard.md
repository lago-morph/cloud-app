# Handoff: setup wizard implementation

Plan: ai/implementation/plan-setup-wizard.md. Owner questions: ai/implementation/owner-questions.md.

Number ranges: b1 DEC-0563–0569/PAR-331–339; b2 DEC-0570–0576/PAR-340–349; b3 DEC-0577–0583/PAR-350–359; b4 DEC-0584–0590/PAR-360–369; b5 DEC-0591–0597/PAR-370–379; b6 DEC-0598–0604/PAR-380–389; fixes/tests DEC-0605–0619/PAR-390–399.

## Status (2026-10-26, after wave 2)
- Done (merged to main): wave 1 #32 b1, #33 b2, #34 b3, #35 b5 (see decision log DEC-0563–0597); wave 2 #38 b4 cloudflare-setup state machine (DEC-0584–0590, PAR-360–361; carried-forward minors 1–12 fixed), #36 b6 skill/settings deny/QUICKSTART/docs/spec (DEC-0598–0604, PAR-380; SETUP-REQ/AC in docs/components/setup.md). Each PR: CI green + independent review, fixes re-reviewed.
- Verify: main 009aa03, clean clone, `npm run verify` exit 0 (with the browser shim below).
- In progress (step 5):
  - #39 claude/wizard-fix-guard — token-write guard judges the URL-normalised path (`sentPath`), dangling-symlink write-through, + the live-pass guarded layer (ai/implementation/spikes/live-wizard/, preflight.md). CI failed once on an unrelated AUTH-AC-011 flake (tamper of last 2 chars can be a no-op); diagnosis under review, test fix on claude/wizard-fix-auth-flake.
  - #40 claude/wizard-tests — compliance criteria tests (SETUP-AC-001–010, CLI-AC-008, CLI-AC-001 additions, SKILL-AC-007/008, offline starter integration). Defect found: SETUP-AC-002 env-only run creates .env.cloudflare; diagnosis confirmed; fix being added on the same branch.
  - Whole-feature independent review of everything since 9316a19 (+#39, #40).
- Next: fix review findings red-green, re-review, merge #39/#40/flake fix; then the live pass (step 6) with the guarded layer; final handoff + merge #37.
- Open questions: owner-questions.md (18 items).

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
