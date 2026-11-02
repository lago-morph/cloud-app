# Unused remote branches

Every branch on `origin` except `main` that is unused, as of 2026-11-02 (`git fetch --prune`; `origin/main` at `3395fc9`). Written for the owner, who deletes branches later through a proxy; nothing here has been deleted.

A branch is unused when its tip is an ancestor of `origin/main`, or when it has no open pull request. On 2026-11-02 the repository has no open pull request except this list's own (`v0.2.0/pre-rc-housekeeping`, left out), so every other branch is listed. The reason is the first that applies: merged into `main` (the tip is an ancestor of `origin/main`), else the branch's latest pull request (merged into another base, or with commits after its merge; or closed without merging), else no pull request and not merged.

| Reason | Branches |
| --- | --- |
| merged into `main` | 179 |
| PR merged (tip not in `main`) | 5 |
| PR closed without merging | 10 |
| no PR and not merged | 252 |
| **Total** | **446** |

"No PR and not merged" branches carry their last commit's subject, so anything worth keeping can be spotted before deleting.

## Branches

| Branch | Last commit | Reason | Note (last commit, no PR and not merged only) |
| --- | --- | --- | --- |
| `claude/batch-a` | 2026-10-25 | merged into `main` |  |
| `claude/batch-b` | 2026-10-25 | merged into `main` |  |
| `claude/batch-c` | 2026-10-25 | merged into `main` |  |
| `claude/better-auth` | 2026-10-26 | merged into `main` |  |
| `claude/changelog-0.1.0` | 2026-10-26 | merged into `main` |  |
| `claude/ci-playwright` | 2026-10-26 | merged into `main` |  |
| `claude/ci-skip-docs` | 2026-10-27 | merged into `main` |  |
| `claude/cloudflare-release` | 2026-10-24 | merged into `main` |  |
| `claude/distribution` | 2026-10-24 | merged into `main` |  |
| `claude/implement-aws` | 2026-10-24 | merged into `main` |  |
| `claude/implement-aws-fake-flake` | 2026-10-24 | merged into `main` |  |
| `claude/implement-aws-gev-fixes` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-bv5` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-cf-passC` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-cf-passC1` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-cf-passM` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-d-ev` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-ev5` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-fix-g6` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-fix-r2order` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-g6-s1` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-int-cf` | 2026-10-24 | merged into `main` |  |
| `claude/implement-local-cloudflare-rc-g6-review` | 2026-10-24 | merged into `main` |  |
| `claude/merge-v0.2.0-testing-plan` | 2026-10-31 | merged into `main` |  |
| `claude/pass3-fixes` | 2026-10-25 | merged into `main` |  |
| `claude/pass4-code` | 2026-10-26 | merged into `main` |  |
| `claude/pass4-tests` | 2026-10-26 | merged into `main` |  |
| `claude/plan-setup-wizard` | 2026-10-26 | merged into `main` |  |
| `claude/plan-v0.2.0` | 2026-10-26 | merged into `main` |  |
| `claude/plan-v0.2.0-facts` | 2026-10-27 | merged into `main` |  |
| `claude/plan-v0.2.0-readme` | 2026-10-27 | merged into `main` |  |
| `claude/r2-token-cleanup` | 2026-10-26 | merged into `main` |  |
| `claude/readme` | 2026-10-27 | merged into `main` |  |
| `claude/release-0.1.1` | 2026-10-27 | merged into `main` |  |
| `claude/releasing-doc` | 2026-10-26 | merged into `main` |  |
| `claude/restore-retro-2026-10-19` | 2026-10-31 | merged into `main` |  |
| `claude/retro-2026-10-27` | 2026-10-27 | merged into `main` |  |
| `claude/retrospective-2026-10-27` | 2026-10-27 | merged into `main` |  |
| `claude/retrospective-2026-10-31-57` | 2026-10-31 | merged into `main` |  |
| `claude/review-fixes` | 2026-10-25 | merged into `main` |  |
| `claude/run-pass3` | 2026-10-25 | merged into `main` |  |
| `claude/run-pass4` | 2026-10-25 | merged into `main` |  |
| `claude/run-pass5` | 2026-10-26 | merged into `main` |  |
| `claude/skill-package` | 2026-10-26 | merged into `main` |  |
| `claude/testing-standards-tdd-doegdn` | 2026-10-31 | merged into `main` |  |
| `claude/tests-a` | 2026-10-25 | merged into `main` |  |
| `claude/tests-bc` | 2026-10-25 | merged into `main` |  |
| `claude/wizard-b1-permissions` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-b2-token-sources` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-b3-setup-record` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-b4-state-machine` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-b5-starter` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-b6-skill-docs` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-fix-auth-flake` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-fix-guard` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-fix-live` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-fix-protected-bootstrap` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-fix-review` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-handoff` | 2026-10-27 | merged into `main` |  |
| `claude/wizard-live-evidence` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-live-pass` | 2026-10-26 | merged into `main` |  |
| `claude/wizard-tests` | 2026-10-26 | merged into `main` |  |
| `pr/05-static-checker` | 2026-10-23 | merged into `main` |  |
| `pr/06-cli-provision` | 2026-10-23 | merged into `main` |  |
| `pr/07-cli-provision-tests` | 2026-10-23 | merged into `main` |  |
| `pr/08-template-integration-a` | 2026-10-23 | merged into `main` |  |
| `pr/09-integration-tests-b` | 2026-10-23 | merged into `main` |  |
| `pr/10-harness-reference-app` | 2026-10-23 | merged into `main` |  |
| `pr/11-compliance-criteria-a` | 2026-10-23 | merged into `main` |  |
| `pr/12-compliance-criteria-b-e2e` | 2026-10-23 | merged into `main` |  |
| `pr/13-skill-demo` | 2026-10-23 | merged into `main` |  |
| `pr/14-implementation-record` | 2026-10-23 | merged into `main` |  |
| `pr/15-root-causes-evidence` | 2026-10-23 | merged into `main` |  |
| `v0.2.0/00-run-records` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/02-standards-skill-core` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/03-standards-skill-refs` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/04-claude-md-standards` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/05-e2e-governance` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/06-compliance-tiers` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/08-baseline-root-causes` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/10-record-linters` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/11-claude-commit-hook` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/14-ci-classifier` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/15-playwright-projects` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/16-ci-pr-selection` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/17-ci-no-duplicates` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/20-coverage-fuzz-list` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/24-auth-app-contract` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/25-auth-app-oauth` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/25a-auth-app-upstream` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/26-auth-app-store` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/26a-auth-app-signin` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/27-auth-app-worker` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/27a-auth-app-entry` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/28-auth-app-integration` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/28m-merge-ci-into-auth-app` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/29-auth-app-ci` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/30-bootstrap-token-rules` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/31-oauth-clients` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/32-admin-app-deploy` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/33-token-policies-move` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/34-remove-email-setup` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/34a-remove-email-files` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/34b-setup-without-email-domain` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/34c-fix-bootstrap-token-rules` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/36-req-changes-6-1` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/37-auth-doc-rewrite` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/39-setup-docs` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/39a-cli-skill-docs` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/39b-spec-followups` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/39c-role-change-wording` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/40-auth-app-provider` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/41-role-refresh` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/41a-test-app-auth-app` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/50-int-decisions-w1` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/52-deploy-auth-binding` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/53-secrets-store-bindings` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/54-signing-credential-secrets-store` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/55-merge-auth-app-into-bootstrap` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/56-admin-app-signin` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/56b-admin-app-grant-routes` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/56c-admin-app-worker-deploy` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/57-everyday-token-page` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/57b-everyday-page` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/57z-everyday-switch` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/58-admin-status-page` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/58a-merge-f-into-e` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/59-account-setup-page` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/59b-account-setup-page` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/60-email-cleanup-offer` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/61-admin-app-integration` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/64-skill-setup-flow` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/65-quickstart-upgrade-notes` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/66-skill-testing-refs` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/67-template-e2e-layer` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/68-template-fuzz-helper` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/69-fix-template-signing` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/69r-reference-removed-scripts` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/70-readme-v020` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/70b-readme-wording` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/71m-merge-auth-provider-into-admin-app` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/71n-path-map-after-removals` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/74-auth-criteria-tests` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/74a-auth-sign-in-criteria-tests` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/75-setup-criteria-tests` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/78-e2e-scope` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/79-e2e-setup` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/80-e2e-signin` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/81-e2e-starter-upgrade` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/84-integration-provision` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/85-integration-testing` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/86-integration-client` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/88-fuzz-targets` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/89-fix-files-base64url-noncanonical` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/89b-fix-return-to-decoded-tab-newline` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/91-fix-native-copy-fetch` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/92-fix-mig-record-order` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/93-fix-selection-e2e004` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/93a-fix-selection-e2e004` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/94-fix-release-login-check` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/95-fix-demo-signing` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/96-fix-remove-registry-first` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/96b-fix-deploy-without-email` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/97-fix-testing-type-exports` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/97b-fix-testing-types-email` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/98-fix-demo-role-refresh` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/99-records-harness-failures` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/cleanup-161` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/integration` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/owner-decisions` | 2026-10-31 | merged into `main` |  |
| `v0.2.0/plan-7a-trim` | 2026-10-31 | merged into `main` |  |
| `claude/vibrant-lovelace-ny20lh` | 2026-10-19 | PR #4 merged |  |
| `pr/01-workspace-and-spec` | 2026-10-23 | PR #6 merged |  |
| `pr/02-framework-services` | 2026-10-23 | PR #7 merged |  |
| `pr/03-services-unit-tests` | 2026-10-23 | PR #8 merged |  |
| `pr/04-runtimes-build-testing` | 2026-10-23 | PR #9 merged |  |
| `claude/implement-aws-live` | 2026-10-24 | PR #23 closed |  |
| `v0.2.0/38-retire-password-mail-docs` | 2026-10-31 | PR #83 closed |  |
| `v0.2.0/42-drop-auth-mail-tables` | 2026-10-31 | PR #124 closed |  |
| `v0.2.0/43-check-login-auth-app` | 2026-10-31 | PR #115 closed |  |
| `v0.2.0/44m-merge-docs-into-auth-provider` | 2026-10-31 | PR #122 closed |  |
| `v0.2.0/45-remove-password` | 2026-10-31 | PR #116 closed |  |
| `v0.2.0/46-remove-mail` | 2026-10-31 | PR #117 closed |  |
| `v0.2.0/47-remove-admins` | 2026-10-31 | PR #118 closed |  |
| `v0.2.0/61a-admin-app-ci` | 2026-10-31 | PR #120 closed |  |
| `v0.2.0/61m-merge-ci-into-admin-app` | 2026-10-31 | PR #125 closed |  |
| `claude/ba-cf-pass` | 2026-10-25 | no PR and not merged | Cloudflare pass-auth: full run k9cc5zjcbm5mrkc and milestone y5cuhf8fwk5khtd (PROV-AC-004, MAIL-AC-007), re... |
| `claude/ba-cf-pass2` | 2026-10-25 | no PR and not merged | Cloudflare pass-auth-2 evidence: full run wxnforn019mo5ic, milestone run ykpjdoi5gccpsdv, check-login g8np1... |
| `claude/ba-cleanup` | 2026-10-25 | no PR and not merged | Remove superseded evidence, spike lockfile and integrated draft maps |
| `claude/ba-fix-cf` | 2026-10-25 | no PR and not merged | Fix Cloudflare Error 1000 on sign-up and the unreached sign-in limit (PWD-AC-008) |
| `claude/ba-fix-local` | 2026-10-25 | no PR and not merged | Fix-local: local compliance record xiu1uitdbzr2rx1 (122 passed) |
| `claude/ba-fix-offline` | 2026-10-25 | no PR and not merged | fix: E2E-005 meaning text, PROV-AC-002 restart wait, MAIL-AC-007 verified reading |
| `claude/ba-harness-limits` | 2026-10-25 | no PR and not merged | Compliance harness: D1 budgets by plan, self-created test tokens, deferred second-account clause |
| `claude/ba-i-a` | 2026-10-25 | no PR and not merged | I-A: Better Auth tables in the framework migration histories (both dialects) |
| `claude/ba-i-b` | 2026-10-25 | no PR and not merged | I-B: name BA's handler type for declaration emit; AUTH.NOT_VERIFIED/RATE_LIMITED have no app route |
| `claude/ba-i-c` | 2026-10-25 | no PR and not merged | I-C: local compliance evidence for the password, mail and login-forgery criteria (14 passed; CFG-AC-006/MAI... |
| `claude/ba-i-d` | 2026-10-25 | no PR and not merged | MAIL (I-D): .mail/ files are exactly { to, subject, text, html, time }; I-A's history test lists 0002 |
| `claude/ba-i-e` | 2026-10-25 | no PR and not merged | I-E: config, secrets and Cloudflare settings for the password provider |
| `claude/ba-i-f` | 2026-10-25 | no PR and not merged | I-F: email provisioning and the test mail sink on Cloudflare |
| `claude/ba-i-f-fix` | 2026-10-25 | no PR and not merged | I-F fix: Email Routing readiness from the zone's DNS; DEC-0527 sink address |
| `claude/ba-i-g` | 2026-10-25 | no PR and not merged | I-G: local compliance record wgsciwwk0kx1ue7 (109 passed, 8 failed, 5 blocked) |
| `claude/ba-i-h` | 2026-10-25 | no PR and not merged | Merge remote-tracking branch 'origin/claude/better-auth' into claude/ba-i-h |
| `claude/ba-signup-budget` | 2026-10-25 | no PR and not merged | Tests: keep cloud sign-ups within PAR-259 (shared verified account, stage sign-up budget) |
| `claude/ba-spec-roles` | 2026-10-25 | no PR and not merged | Spec: admins are a database role; anyone who signs up is a user |
| `claude/ba-t1` | 2026-10-25 | no PR and not merged | Tests (T1): local criteria of the password provider and mail |
| `claude/ba-t2t3` | 2026-10-25 | no PR and not merged | T2+T3: cloud tests for the password provider, mail and prodcheck checks |
| `claude/ba-t4` | 2026-10-25 | no PR and not merged | T4: AUTH criteria for admins by database role; tests for AUTH-AC-015, PWD-AC-010, CLI-AC-006/007 |
| `claude/better-auth-spike` | 2026-10-24 | no PR and not merged | spike(ba-s1-s3): RESULT.md with evidence, problems and recommended PARs |
| `claude/implement-aws-gf1-fix` | 2026-10-24 | no PR and not merged | G-F1 follow-up: Data API fake exceptions carry no PGlite cause |
| `claude/implement-local-cloudflare-a-01` | 2026-10-19 | no PR and not merged | A-01: spike Cloudflare tool auth through the sandbox proxy |
| `claude/implement-local-cloudflare-a-02` | 2026-10-19 | no PR and not merged | A-02: workers.dev reachability spike (curl, Node fetch, Playwright Chromium) |
| `claude/implement-local-cloudflare-a-03` | 2026-10-19 | no PR and not merged | A-03 spike: SST Worker updates keep API-set secrets |
| `claude/implement-local-cloudflare-a-04` | 2026-10-19 | no PR and not merged | A-04 spike: workers.dev route off/on via API keeps secrets and bindings |
| `claude/implement-local-cloudflare-a-05` | 2026-10-19 | no PR and not merged | A-05 spike: D1 HTTP API applies a PRAGMA-prefixed migration file atomically |
| `claude/implement-local-cloudflare-a-06` | 2026-10-19 | no PR and not merged | A-06: D1 export/import copy-fidelity spike; fallback page-by-page copy applied |
| `claude/implement-local-cloudflare-a-07` | 2026-10-19 | no PR and not merged | Spike A-07: R2 signed URLs, bucket CORS, bucket-scoped R2 token |
| `claude/implement-local-cloudflare-a-08` | 2026-10-19 | no PR and not merged | A-08: local vs remote D1 limits spike (SQL-OQ-1) |
| `claude/implement-local-cloudflare-a-09` | 2026-10-19 | no PR and not merged | A-09 spike: sql.d.ts typing approach with restricted Drizzle types |
| `claude/implement-local-cloudflare-a-10` | 2026-10-19 | no PR and not merged | A-10 spike: dependency pins install and work together |
| `claude/implement-local-cloudflare-a-ev` | 2026-10-19 | no PR and not merged | A-EV: phase A evaluation — all ten spikes accepted; exit passed |
| `claude/implement-local-cloudflare-a-int` | 2026-10-19 | no PR and not merged | A-INT: revise plan for phase-A spike outcomes |
| `claude/implement-local-cloudflare-b-01` | 2026-10-19 | no PR and not merged | B-01: workspace bootstrap |
| `claude/implement-local-cloudflare-b-02` | 2026-10-19 | no PR and not merged | B-02: CORE type fixtures, design doc and decision drafts |
| `claude/implement-local-cloudflare-b-03` | 2026-10-19 | no PR and not merged | B-03: browser api helper and ApiError; http.md design and decision drafts |
| `claude/implement-local-cloudflare-b-04` | 2026-10-19 | no PR and not merged | B-04: note how B-T1's proposed logWriter option maps to the test sinks |
| `claude/implement-local-cloudflare-b-05` | 2026-10-19 | no PR and not merged | B-05: use PROTOTYPE_FRAMEWORK_DIALECT (as B-T2); PGlite harness test pays template setup in beforeAll |
| `claude/implement-local-cloudflare-b-06` | 2026-10-19 | no PR and not merged | B-06: select-form tests through the handle; sql.md handles/atomic/failures details; decision drafts |
| `claude/implement-local-cloudflare-b-07` | 2026-10-19 | no PR and not merged | B-07: migrations.md generation/record/local details; decision drafts; MIG internal entry points listed |
| `claude/implement-local-cloudflare-b-08` | 2026-10-19 | no PR and not merged | B-08: KV.UNAVAILABLE mapping and logging; kv.md implementation details; decision drafts |
| `claude/implement-local-cloudflare-b-09` | 2026-10-19 | no PR and not merged | B-09: CFG key declarations, values-file schema, stage file selection, resolution, embedded module, ConfigSe... |
| `claude/implement-local-cloudflare-b-10` | 2026-10-19 | no PR and not merged | B-10: local .dev.vars writer and dev secret generation, secrets set argument and stdin rules, design doc an... |
| `claude/implement-local-cloudflare-b-11` | 2026-10-19 | no PR and not merged | B-11: files.md shared runtime shape and local route details; decision draft |
| `claude/implement-local-cloudflare-b-12` | 2026-10-19 | no PR and not merged | B-12: browser getCurrentUser/login/logout, auth.md design details, decision draft |
| `claude/implement-local-cloudflare-b-13` | 2026-10-19 | no PR and not merged | B-13: certification library, google.md implementation notes, decision drafts |
| `claude/implement-local-cloudflare-b-14` | 2026-10-19 | no PR and not merged | B-14: check.md design details for the rule engine, rules, diagnostics and app-config check; decision drafts |
| `claude/implement-local-cloudflare-b-15` | 2026-10-19 | no PR and not merged | B-15: migration checker (apply both histories to local D1 and PGlite, supported-change whitelist, dialect c... |
| `claude/implement-local-cloudflare-b-16` | 2026-10-19 | no PR and not merged | B-16: stage runtime tests get the integration timeout (PGlite template on first use) |
| `claude/implement-local-cloudflare-b-16a` | 2026-10-19 | no PR and not merged | B-16a: GOOGLE re-exports AUTH's login-provider types; test:integration builds dist first; decision drafts |
| `claude/implement-local-cloudflare-b-17` | 2026-10-19 | no PR and not merged | B-17: verify names only failing/skipped tests; root-cause record for the negative-LIMIT fixture |
| `claude/implement-local-cloudflare-b-18` | 2026-10-19 | no PR and not merged | B-18: template app using every capability once, with in-process and smoke tests |
| `claude/implement-local-cloudflare-b-ev` | 2026-10-20 | no PR and not merged | B-EV: phase B evaluation (exit check passed; CHECK-AC-003 deferred to E-EV) |
| `claude/implement-local-cloudflare-b-int` | 2026-10-19 | no PR and not merged | B-INT: integrate phase-B decision drafts (DEC-0110…DEC-0243, PAR-119), owner items, lint wiring, declared deps |
| `claude/implement-local-cloudflare-b-run` | 2026-10-19 | no PR and not merged | B-RUN: phase B raw test output and exit-check record |
| `claude/implement-local-cloudflare-b-run2` | 2026-10-20 | no PR and not merged | B-RUN run 2: phase B raw results after accepted fixes (local) |
| `claude/implement-local-cloudflare-b-t1` | 2026-10-19 | no PR and not merged | B-T1: integration test cases for core, http, log, config, secrets |
| `claude/implement-local-cloudflare-b-t2` | 2026-10-19 | no PR and not merged | B-T2: integration test cases for SQL, MIG and KV (local) |
| `claude/implement-local-cloudflare-b-t3` | 2026-10-19 | no PR and not merged | B-T3: integration test cases for files, auth, google (local) |
| `claude/implement-local-cloudflare-b-t4` | 2026-10-19 | no PR and not merged | B-T4: integration tests for check, cli, local and build |
| `claude/implement-local-cloudflare-b-t5` | 2026-10-20 | no PR and not merged | B-T5: record run results |
| `claude/implement-local-cloudflare-batch-verify-1` | 2026-10-20 | no PR and not merged | validation: batch verify 1 (online + offline) at 2901e94 |
| `claude/implement-local-cloudflare-batch-verify-2` | 2026-10-20 | no PR and not merged | validation: batch verify 2 (online + offline) at 1487c7d |
| `claude/implement-local-cloudflare-c-01` | 2026-10-20 | no PR and not merged | C-01: ROUTES.md names the file list item test ID |
| `claude/implement-local-cloudflare-c-02` | 2026-10-20 | no PR and not merged | C-02: blocked-all, leftover check via listStageResources, build+typecheck first, wire npm run compliance |
| `claude/implement-local-cloudflare-c-03` | 2026-10-20 | no PR and not merged | C-03: PROV target-neutral core with fake target, Cloudflare log-bucket ownership check |
| `claude/implement-local-cloudflare-c-04` | 2026-10-20 | no PR and not merged | C-04: decision drafts and changes needed elsewhere |
| `claude/implement-local-cloudflare-c-04a` | 2026-10-20 | no PR and not merged | C-04a: wire smoke command, connectTestStage export, and dev origin record |
| `claude/implement-local-cloudflare-c-05` | 2026-10-20 | no PR and not merged | C-05: minimal scaffolder (skill/scripts/scaffold) |
| `claude/implement-local-cloudflare-c-ev` | 2026-10-20 | no PR and not merged | C-EV: Phase C local evaluation (exit check not met) |
| `claude/implement-local-cloudflare-c-int` | 2026-10-20 | no PR and not merged | C-INT: plan updates for phase D from phase C reports; owner items Q5, Q8 |
| `claude/implement-local-cloudflare-c-run` | 2026-10-20 | no PR and not merged | C-RUN: traceability report, compliance log and SUMMARY |
| `claude/implement-local-cloudflare-c-run2` | 2026-10-20 | no PR and not merged | C-RUN-2: traceability report |
| `claude/implement-local-cloudflare-c-run3` | 2026-10-20 | no PR and not merged | C-RUN run 3: local compliance evidence, traceability report and summary |
| `claude/implement-local-cloudflare-c-t1` | 2026-10-20 | no PR and not merged | C-T1: compliance criteria for core, http, log, config, secrets, cli |
| `claude/implement-local-cloudflare-c-t2` | 2026-10-20 | no PR and not merged | C-T2: decision drafts and cloud usage estimate |
| `claude/implement-local-cloudflare-c-t3` | 2026-10-20 | no PR and not merged | C-T3: FILES and AUTH compliance criteria and E2E-009 |
| `claude/implement-local-cloudflare-c-t4` | 2026-10-20 | no PR and not merged | C-T4: completion notes and informational local run results |
| `claude/implement-local-cloudflare-c-t5` | 2026-10-20 | no PR and not merged | C-T5: run-level tests for COMPL-AC-001 and COMPL-AC-003 |
| `claude/implement-local-cloudflare-c-t6` | 2026-10-20 | no PR and not merged | C-T6: skip the two CLI-AC-003 tests that expose driver defects; decision draft |
| `claude/implement-local-cloudflare-cde-int` | 2026-10-20 | no PR and not merged | CDE-INT: DEC-0391 (E2E-004 judged at F-EV); notes linking D-01/D-03 timeout records to the accepted D-04 re... |
| `claude/implement-local-cloudflare-cf-cleanupR` | 2026-10-23 | no PR and not merged | Cloudflare cleanup of run stage R (test-wxezkd4j5ye3oio): redacted logs |
| `claude/implement-local-cloudflare-cf-pass0` | 2026-10-23 | no PR and not merged | CF pass 0: setup-account, DEC-0334 live checks 1-9/11, D-02 R2 checks |
| `claude/implement-local-cloudflare-cf-pass1` | 2026-10-23 | no PR and not merged | Cloudflare pass 1: R's first deploy fails at step 3 (SST "Target not found: Files"); stopped before the driver |
| `claude/implement-local-cloudflare-cf-pass1b` | 2026-10-23 | no PR and not merged | Cloudflare pass 1b logs: old stage removed; R's first deploy fails at step 5 (asset upload 401) |
| `claude/implement-local-cloudflare-cf-pass1c` | 2026-10-24 | no PR and not merged | Record Cloudflare pass 1c: pass-1 driver re-run and PROV-AC-004 on stage R |
| `claude/implement-local-cloudflare-cf-pass2to5` | 2026-10-24 | no PR and not merged | Cloudflare passes 2-5: evidence and driver records |
| `claude/implement-local-cloudflare-cf-passB` | 2026-10-24 | no PR and not merged | Cloudflare pass B: PROV-AC-001, COMPL-AC-004, MIG-AC-002/003/006, PROV-AC-002 (no run stage) |
| `claude/implement-local-cloudflare-cleanup` | 2026-10-23 | no PR and not merged | Cleanup: delete stale evidence, archive superseded runs and spike code |
| `claude/implement-local-cloudflare-d-01` | 2026-10-20 | no PR and not merged | D-01: root-cause record re-run results |
| `claude/implement-local-cloudflare-d-02` | 2026-10-20 | no PR and not merged | D-02: files.md Cloudflare details and download names; decision drafts |
| `claude/implement-local-cloudflare-d-03` | 2026-10-20 | no PR and not merged | D-03: root-cause record: final verify run evidence |
| `claude/implement-local-cloudflare-d-04` | 2026-10-20 | no PR and not merged | D-04: root-cause record for verify failures outside D-04 (machine load, offline signing) |
| `claude/implement-local-cloudflare-d-05` | 2026-10-20 | no PR and not merged | D-05: decision drafts; cli.md and cloudflare.md in sync with the cloud commands |
| `claude/implement-local-cloudflare-d-06` | 2026-10-20 | no PR and not merged | D-06: decision drafts |
| `claude/implement-local-cloudflare-d-07` | 2026-10-20 | no PR and not merged | D-07: driver sets the run stage's test secret apiKey (DEC-0277, DEC-0366) |
| `claude/implement-local-cloudflare-d-t` | 2026-10-20 | no PR and not merged | D-T1/D-T2: COMPL-AC-008 test, PROV-AC-002 lock, usage estimates and decisions |
| `claude/implement-local-cloudflare-dbcap8` | 2026-10-23 | no PR and not merged | Raise the at-once D1 database cap for cloud tests to 8 (DEC-0419) |
| `claude/implement-local-cloudflare-demo-rerun` | 2026-10-20 | no PR and not merged | Demo re-run: local compliance --only DEMO-AC-001..011, E2E-002, E2E-004 (run cmzgvk4zb2o6ako) |
| `claude/implement-local-cloudflare-diag-b1` | 2026-10-19 | no PR and not merged | Root-cause records for CORE-AC-001 (ApiErrorInit) and HTTP-AC-001 (deep link) |
| `claude/implement-local-cloudflare-diag-b2` | 2026-10-19 | no PR and not merged | B diag: root causes for MIG-AC-001/002/003 local integration failures |
| `claude/implement-local-cloudflare-diag-b3` | 2026-10-19 | no PR and not merged | Root cause: SQL-AC-001 reference action passed to ref() is silently ignored |
| `claude/implement-local-cloudflare-diag-b4` | 2026-10-19 | no PR and not merged | Root-cause record: template Download popup empty in phase-B check (not a defect) |
| `claude/implement-local-cloudflare-diag-c1` | 2026-10-20 | no PR and not merged | Root cause AUTH-AC-007: wrangler dev proxy rewrites Origin scheme via forwarded Host |
| `claude/implement-local-cloudflare-diag-c2` | 2026-10-20 | no PR and not merged | root cause: CLI-AC-002 / MIG-AC-001 verify fetch failed (PGlite start-up blocks main thread during D1 replay) |
| `claude/implement-local-cloudflare-diag-c3` | 2026-10-20 | no PR and not merged | Root cause: E2E-004 coverage part and not-run unit-level criteria (C-RUN) |
| `claude/implement-local-cloudflare-diag-c3b` | 2026-10-20 | no PR and not merged | Root cause E2E-004: revise cause C (SKILL-AC-005 unit test exists but is too weak; LOCAL-AC-001 and CHECK-A... |
| `claude/implement-local-cloudflare-diag-c4` | 2026-10-20 | no PR and not merged | Root cause: FILES-AC-003 expired-ticket clause, execution context destroyed (diagnosis) |
| `claude/implement-local-cloudflare-diag-c5` | 2026-10-20 | no PR and not merged | Root cause: SEC-AC-002 cli.test.ts depends on SEC-AC-001/003 state under --only |
| `claude/implement-local-cloudflare-diag-c6` | 2026-10-20 | no PR and not merged | Root cause: CLI-AC-003 driver cleanup failures (dev stop throws; leftovers exit 0) |
| `claude/implement-local-cloudflare-diag-c7` | 2026-10-20 | no PR and not merged | Root cause: compliance CLI exits 64 on runtime errors; pending-stages write failure loses the record |
| `claude/implement-local-cloudflare-diag-cloudtests` | 2026-10-23 | no PR and not merged | diag: root cause for the Cloudflare paths of the compliance tests (MIG stage, D1 guards, redundant removes,... |
| `claude/implement-local-cloudflare-diag-e1` | 2026-10-20 | no PR and not merged | Root cause: SKILL-AC-004 example copies vitest.config.ts, which verify neither type-checks nor reads |
| `claude/implement-local-cloudflare-diag-e2` | 2026-10-20 | no PR and not merged | Root cause: COMPL-AC-001 test Where reader parses DEC-0319's two-column ID table in the decision log |
| `claude/implement-local-cloudflare-diag-e3` | 2026-10-20 | no PR and not merged | Root cause: SKILL-AC-001 deploying.md missing configuration example link |
| `claude/implement-local-cloudflare-diag-e4` | 2026-10-20 | no PR and not merged | Root cause: SKILL-AC-004 demo-overlap failure is template files kept unchanged by the demo |
| `claude/implement-local-cloudflare-diag-f04` | 2026-10-20 | no PR and not merged | F-04 diagnosis: root-cause records for E2E-016 R-01 and R-06 |
| `claude/implement-local-cloudflare-diag-f1` | 2026-10-20 | no PR and not merged | Diagnose F-02 round 1: the five demo FRAMEWORK-ISSUE entries |
| `claude/implement-local-cloudflare-diag-f2` | 2026-10-20 | no PR and not merged | Root cause F-02 entry 2 (revised): test apps send stage credentials to other hosts |
| `claude/implement-local-cloudflare-diag-f3` | 2026-10-20 | no PR and not merged | Root-cause record: F-02 round 2 demo issues (entries 1-4) |
| `claude/implement-local-cloudflare-diag-f4` | 2026-10-20 | no PR and not merged | Root cause: F-02 round 3 demo issue #1 (browser-only clauses) |
| `claude/implement-local-cloudflare-diag-mig002` | 2026-10-20 | no PR and not merged | Root cause record: MIG-AC-002 no-change deploy, workerd startup fatal (diagnosis only) |
| `claude/implement-local-cloudflare-diag-order` | 2026-10-20 | no PR and not merged | Root cause scan: test order dependence (no failures; sessions.test.ts timer-overflow observation) |
| `claude/implement-local-cloudflare-diag-pass0` | 2026-10-23 | no PR and not merged | Root-cause records for Cloudflare pass 0 findings F-1 and F-2 (diagnosis only) |
| `claude/implement-local-cloudflare-diag-pass1` | 2026-10-23 | no PR and not merged | Diagnose pass 1: sst --target Files not found on a first deploy |
| `claude/implement-local-cloudflare-diag-pass1c` | 2026-10-24 | no PR and not merged | Root-cause records: pass 1c FILES-AC-001 list order, E2E-004/AUTH-AC-005 cloud coverage |
| `claude/implement-local-cloudflare-diag-pass2` | 2026-10-24 | no PR and not merged | Root causes: pass 2 SEC-AC-001/HTTP-AC-002 and SEC-AC-005 (Cloudflare secret version rollout) |
| `claude/implement-local-cloudflare-diag-registry` | 2026-10-20 | no PR and not merged | Root-cause record: createTestApp joins the host-wide Miniflare dev registry |
| `claude/implement-local-cloudflare-e-01` | 2026-10-20 | no PR and not merged | E-01: decision drafts and skill.md implementation notes |
| `claude/implement-local-cloudflare-e-02` | 2026-10-20 | no PR and not merged | E-02: template README owner steps; decision drafts |
| `claude/implement-local-cloudflare-e-03` | 2026-10-20 | no PR and not merged | E-03: examples copy the finalize route and HMAC helper; references point at them |
| `claude/implement-local-cloudflare-e-04` | 2026-10-20 | no PR and not merged | E-04: make owner steps copy-and-paste; mark unverified Cloudflare claims (F8) |
| `claude/implement-local-cloudflare-e-05` | 2026-10-20 | no PR and not merged | Skill: document the ticket form on every target in files.md and tests example (F-02 entry 2) |
| `claude/implement-local-cloudflare-e-ev` | 2026-10-20 | no PR and not merged | E-EV: phase E evaluation (SKILL-AC-001..005, CHECK-AC-003 passed; E2E-011 cloud blocked by DEC-0317) |
| `claude/implement-local-cloudflare-e-run` | 2026-10-20 | no PR and not merged | E-RUN: local run of tests/skill, verify, and compliance for SKILL-AC-001..005 and CHECK-AC-003; E2E-011 clo... |
| `claude/implement-local-cloudflare-e-t1` | 2026-10-20 | no PR and not merged | E-T1: skill checks for SKILL-AC-001…-004 in tests/skill, collected by the integration layer |
| `claude/implement-local-cloudflare-e-t2` | 2026-10-20 | no PR and not merged | E-T2: close evaluation E flags F1-F5 for SKILL-AC-001/004 and CHECK-AC-003 |
| `claude/implement-local-cloudflare-f-01` | 2026-10-20 | no PR and not merged | demo: build record and framework issues |
| `claude/implement-local-cloudflare-f-01b` | 2026-10-20 | no PR and not merged | demo: build record, framework issues, local smoke evidence |
| `claude/implement-local-cloudflare-f-01c` | 2026-10-20 | no PR and not merged | Demo: local smoke evidence, build record, framework issue |
| `claude/implement-local-cloudflare-f-01d` | 2026-10-20 | no PR and not merged | Add raw smoke evidence for the demo local run |
| `claude/implement-local-cloudflare-f-04` | 2026-10-20 | no PR and not merged | F-04: E2E-016 architecture review record |
| `claude/implement-local-cloudflare-f-04-rr` | 2026-10-20 | no PR and not merged | F-04 re-review: E2E-016 after fix-f04a and fix-f04b |
| `claude/implement-local-cloudflare-f-ev` | 2026-10-20 | no PR and not merged | F-EV: final evaluation and release report (not working) |
| `claude/implement-local-cloudflare-f-ev2` | 2026-10-20 | no PR and not merged | F-EV2: re-judge local after G1-G3; release report at 903d0f9 (not working) |
| `claude/implement-local-cloudflare-f-ev3` | 2026-10-21 | no PR and not merged | F-EV3: re-base local on final-local-4; MIG-AC-002 failure recorded; release report at c016e7e (not working) |
| `claude/implement-local-cloudflare-final-local` | 2026-10-20 | no PR and not merged | Final local run: verify (online/offline), full local compliance run emckebxm5x3kxd1, traceability |
| `claude/implement-local-cloudflare-final-local-2` | 2026-10-20 | no PR and not merged | Record final-local-2: full local compliance run q3qgbyunuxaz1fw at 26128b1 |
| `claude/implement-local-cloudflare-final-local-3` | 2026-10-20 | no PR and not merged | Record batch-verify-3 and final-local-3 evidence at 760e7b7 |
| `claude/implement-local-cloudflare-final-local-4` | 2026-10-21 | no PR and not merged | Batch verify 4 and final local run 4 at a5b2164 (DEC-0417 merge) |
| `claude/implement-local-cloudflare-fix-auth005` | 2026-10-24 | no PR and not merged | fix-auth005: decision draft names the local driver record |
| `claude/implement-local-cloudflare-fix-c1` | 2026-10-20 | no PR and not merged | root causes: record fixes for FILES-AC-004 and AUTH-AC-007 (dev Vite cors, changeOrigin) |
| `claude/implement-local-cloudflare-fix-c2` | 2026-10-20 | no PR and not merged | Root cause CLI-AC-002/MIG-AC-001: record the fix and re-check |
| `claude/implement-local-cloudflare-fix-c3` | 2026-10-20 | no PR and not merged | Root-cause record E2E-004: Fix (A, B) section |
| `claude/implement-local-cloudflare-fix-c3c` | 2026-10-20 | no PR and not merged | Root cause E2E-004: Fix (C) results |
| `claude/implement-local-cloudflare-fix-c4` | 2026-10-20 | no PR and not merged | Record fixes: global unit timeout applied; E2E-004 Fix (C, phase rule) |
| `claude/implement-local-cloudflare-fix-c4b` | 2026-10-20 | no PR and not merged | root-causes: record the FILES-AC-003 dev-watch fix and its verification |
| `claude/implement-local-cloudflare-fix-c5` | 2026-10-20 | no PR and not merged | test(secrets): make cli.test.ts tests provision their own state |
| `claude/implement-local-cloudflare-fix-c6` | 2026-10-20 | no PR and not merged | Record the local compliance run in the CLI-AC-003 Fix section |
| `claude/implement-local-cloudflare-fix-c7` | 2026-10-20 | no PR and not merged | docs(root-cause): Fix section for compliance CLI exit and pending stages (c7) |
| `claude/implement-local-cloudflare-fix-cloudtests` | 2026-10-23 | no PR and not merged | evidence: local compliance run for fix-cloudtests (MIG-AC-002/-003, SEC-AC-003, CLI-AC-004, E2E-014 passed;... |
| `claude/implement-local-cloudflare-fix-core001` | 2026-10-20 | no PR and not merged | docs(root-cause): record CORE-AC-001 fix with red/green evidence |
| `claude/implement-local-cloudflare-fix-e1` | 2026-10-20 | no PR and not merged | fix-e1: drop vitest.config.ts example and the unused app Vitest configs (SKILL-AC-004) |
| `claude/implement-local-cloudflare-fix-e2` | 2026-10-20 | no PR and not merged | fix-e2: Fix section for the COMPL-AC-001 Where-parser root cause |
| `claude/implement-local-cloudflare-fix-e3` | 2026-10-20 | no PR and not merged | Run tests/skill/example-pages.test.ts in root verify (SKILL-AC-004) |
| `claude/implement-local-cloudflare-fix-e4` | 2026-10-20 | no PR and not merged | fix-e4: SKILL-AC-004 demo clause exempts verified template/reference copies (DEC-0392) |
| `claude/implement-local-cloudflare-fix-envtoken` | 2026-10-24 | no PR and not merged | Send the environment Cloudflare token from test hooks; drop the HTTPS_PROXY refusal (DEC-0420) |
| `claude/implement-local-cloudflare-fix-f04a` | 2026-10-20 | no PR and not merged | fix-f04a: add portability notes to seven component documents (E2E-016 R-01) |
| `claude/implement-local-cloudflare-fix-f04b` | 2026-10-20 | no PR and not merged | fix-f04b: attachment for every download on both targets (E2E-016 R-06) |
| `claude/implement-local-cloudflare-fix-f1` | 2026-10-20 | no PR and not merged | F-02 round 1 fix (entries 1, 3, 4, 5): skill and contract-doc clarifications |
| `claude/implement-local-cloudflare-fix-f2` | 2026-10-20 | no PR and not merged | Update F-02 entry 2 fix record after rebase |
| `claude/implement-local-cloudflare-fix-f3` | 2026-10-20 | no PR and not merged | F-02 round 2: skill fixes for demo entries 1-3 |
| `claude/implement-local-cloudflare-fix-f4a` | 2026-10-20 | no PR and not merged | fix-f4a: DEC-0393 and testing.md sentence for page-only demo clauses |
| `claude/implement-local-cloudflare-fix-f4b` | 2026-10-20 | no PR and not merged | fix-f4b: record driver run result |
| `claude/implement-local-cloudflare-fix-http001` | 2026-10-20 | no PR and not merged | docs(root-cause): HTTP-AC-001 fix section with red/green evidence |
| `claude/implement-local-cloudflare-fix-mig` | 2026-10-20 | no PR and not merged | Record fixes for MIG-AC-001 and MIG-AC-002 root causes |
| `claude/implement-local-cloudflare-fix-mig002` | 2026-10-21 | no PR and not merged | fix-mig002: record the checks |
| `claude/implement-local-cloudflare-fix-pass0` | 2026-10-23 | no PR and not merged | Fix pass 0 F-2: read back a bucket on a creation conflict; record F-1 as sandbox limitation |
| `claude/implement-local-cloudflare-fix-pass1` | 2026-10-23 | no PR and not merged | Fix pass-1 step 3: target Files only with a database; guard the Worker; skip sst remove without app/ state |
| `claude/implement-local-cloudflare-fix-registry` | 2026-10-20 | no PR and not merged | fix-registry: createTestApp never joins Wrangler's local dev registry |
| `claude/implement-local-cloudflare-fix-registry-2` | 2026-10-20 | no PR and not merged | fix-registry-2: registry-free platform proxy for the migration checker and fake D1 API |
| `claude/implement-local-cloudflare-fix-sec001` | 2026-10-24 | no PR and not merged | fix(compliance): wait for SEC.MISSING after deleting the further stage's secret (SEC-AC-001, HTTP-AC-002) |
| `claude/implement-local-cloudflare-fix-sql001` | 2026-10-19 | no PR and not merged | docs(root-cause): record SQL-AC-001 fix with red/green evidence |
| `claude/implement-local-cloudflare-fix-verify` | 2026-10-20 | no PR and not merged | docs(root-causes): Fix section for the D-04 verify-failures record |
| `claude/implement-local-cloudflare-g2` | 2026-10-20 | no PR and not merged | G2: tagged tests for CHECK-AC-005 demo part and DEMO-AC-003 warn clause |
| `claude/implement-local-cloudflare-g3` | 2026-10-20 | no PR and not merged | Review DEMO-AC-009 root-cause record: accepted (closes G3) |
| `claude/implement-local-cloudflare-int-f04` | 2026-10-20 | no PR and not merged | Integrate fix-f04a and fix-f04b decision drafts as DEC-0413 and DEC-0414 |
| `claude/implement-local-cloudflare-int-final` | 2026-10-20 | no PR and not merged | Integrate pending decision drafts as DEC-0394…DEC-0412 |
| `claude/implement-local-cloudflare-int-mig002` | 2026-10-21 | no PR and not merged | Integrate fix-mig002 decision (DEC-0417) |
| `claude/implement-local-cloudflare-int-registry` | 2026-10-20 | no PR and not merged | Integrate fix-registry and fix-registry-2 decisions (DEC-0415, DEC-0416) |
| `claude/implement-local-cloudflare-plan-f04` | 2026-10-20 | no PR and not merged | plan: add fix-f04a, fix-f04b and the F-04 re-review for E2E-016 R-01/R-06 |
| `claude/implement-local-cloudflare-plan-tests` | 2026-10-20 | no PR and not merged | plan: add owner-approved test economy rules to §1 conventions |
| `claude/implement-local-cloudflare-plan-usage` | 2026-10-19 | no PR and not merged | plan: add binding cloud usage limits for Cloudflare items |
| `claude/implement-local-cloudflare-probe-r2order` | 2026-10-24 | no PR and not merged | FILES-AC-001 R2 order: live probe results (none of the candidate rules; S3 same order) |
| `claude/implement-local-cloudflare-rc-b05-review` | 2026-10-19 | no PR and not merged | B-05 root-cause review: ACCEPTED (PGlite harness test timeout) |
| `claude/implement-local-cloudflare-rc-b1-review` | 2026-10-19 | no PR and not merged | Review root-cause records CORE-AC-001 and HTTP-AC-001: both accepted |
| `claude/implement-local-cloudflare-rc-b17-fix` | 2026-10-19 | no PR and not merged | Fix CLI-AC-002 Postgres-only fixture: negative OFFSET instead of negative LIMIT (B-17 RC fix) |
| `claude/implement-local-cloudflare-rc-b17-review` | 2026-10-19 | no PR and not merged | Review B-17 negative-LIMIT root cause: ACCEPTED |
| `claude/implement-local-cloudflare-rc-b2-review` | 2026-10-19 | no PR and not merged | Review root-cause records for MIG-AC-001 and MIG-AC-002 (both accepted) |
| `claude/implement-local-cloudflare-rc-b4-review` | 2026-10-19 | no PR and not merged | Review root cause: template download popup (ACCEPTED) |
| `claude/implement-local-cloudflare-rc-c1-review` | 2026-10-20 | no PR and not merged | Review root causes FILES-AC-004 (Vite CORS) and AUTH-AC-007 (wrangler Origin rewrite): both accepted |
| `claude/implement-local-cloudflare-rc-c2-review` | 2026-10-20 | no PR and not merged | Review root cause CLI-AC-002/MIG-AC-001 verify fetch failed: accepted |
| `claude/implement-local-cloudflare-rc-c3-review` | 2026-10-20 | no PR and not merged | C-RUN root cause review: E2E-004 coverage and not-run IDs (A, B accepted; C rejected in part) |
| `claude/implement-local-cloudflare-rc-c3b-review` | 2026-10-20 | no PR and not merged | Review revised cause C of E2E-004 root-cause record: ACCEPTED with condition |
| `claude/implement-local-cloudflare-rc-c4-review` | 2026-10-20 | no PR and not merged | Review FILES-AC-003: correct a docs reference |
| `claude/implement-local-cloudflare-rc-c5-review` | 2026-10-20 | no PR and not merged | Review SEC-AC-002 root cause (cli.test.ts shared state): ACCEPTED |
| `claude/implement-local-cloudflare-rc-c6-review` | 2026-10-20 | no PR and not merged | Review root cause CLI-AC-003 driver cleanup failures: ACCEPTED |
| `claude/implement-local-cloudflare-rc-c7-review` | 2026-10-20 | no PR and not merged | Review: accept compliance CLI exit/pending-stages root-cause record |
| `claude/implement-local-cloudflare-rc-cloudtests-review` | 2026-10-23 | no PR and not merged | review: root cause for the Cloudflare paths of the compliance tests (accepted with changes) |
| `claude/implement-local-cloudflare-rc-e1-review` | 2026-10-20 | no PR and not merged | Review SKILL-AC-004 root cause: accepted (remove vitest.config.ts example block) |
| `claude/implement-local-cloudflare-rc-e2-review` | 2026-10-20 | no PR and not merged | Review: COMPL-AC-001 Where-parser root cause ACCEPTED with fix requirements |
| `claude/implement-local-cloudflare-rc-e3-review` | 2026-10-20 | no PR and not merged | Review root cause SKILL-AC-001 deploying example link: accepted |
| `claude/implement-local-cloudflare-rc-e4-review` | 2026-10-20 | no PR and not merged | Review SKILL-AC-004 demo-overlap root cause: accepted with fix requirements |
| `claude/implement-local-cloudflare-rc-f04-review` | 2026-10-20 | no PR and not merged | F-04 root-cause review: E2E-016 R-01 and R-06 (both agree-with-changes) |
| `claude/implement-local-cloudflare-rc-f1-review` | 2026-10-20 | no PR and not merged | F-02 round 1: root-cause review (entry 2 rejected: connect.ts sends stage cookie to foreign hosts) |
| `claude/implement-local-cloudflare-rc-f2-review` | 2026-10-20 | no PR and not merged | Review F-02 entry 2 (revised): accepted with additions |
| `claude/implement-local-cloudflare-rc-f3-review` | 2026-10-20 | no PR and not merged | F-02 round 2: review of demo-issue root causes (all four accepted) |
| `claude/implement-local-cloudflare-rc-f4-review` | 2026-10-20 | no PR and not merged | F-02 round 3: review of demo browser-test root cause (accepted with amended fix) |
| `claude/implement-local-cloudflare-rc-final-review` | 2026-10-20 | no PR and not merged | Root-cause reviews: D-01 and D-03 timeouts accepted; order scan accepted with changes |
| `claude/implement-local-cloudflare-rc-mig002-review` | 2026-10-21 | no PR and not merged | Review root cause MIG-AC-002 workerd crash: not accepted as proven; race-free port fix required |
| `claude/implement-local-cloudflare-rc-pass0-review` | 2026-10-23 | no PR and not merged | Review root-cause records for Cloudflare pass 0 findings F-1 and F-2 |
| `claude/implement-local-cloudflare-rc-pass1-review` | 2026-10-23 | no PR and not merged | Review pass-1 root cause: confirm cause; require target-by-database, Worker guard, exact app/ test, fake co... |
| `claude/implement-local-cloudflare-rc-pass1c-review` | 2026-10-24 | no PR and not merged | Review pass 1c root-cause records: FILES-AC-001 R2 list order, AUTH-AC-005 cloud coverage |
| `claude/implement-local-cloudflare-rc-pass2-review` | 2026-10-24 | no PR and not merged | Review: pass 2 root causes SEC-AC-001/HTTP-AC-002 and SEC-AC-005 |
| `claude/implement-local-cloudflare-rc-registry-review` | 2026-10-20 | no PR and not merged | Root-cause review: accept testing dev-registry record with required changes |
| `claude/implement-local-cloudflare-rc-sql001-review` | 2026-10-19 | no PR and not merged | Review SQL-AC-001 reference-action root-cause record: ACCEPTED |
| `claude/implement-local-cloudflare-rc-timeout-review` | 2026-10-20 | no PR and not merged | Review global unit testTimeout change of fix: ACCEPTED |
| `claude/implement-local-cloudflare-rc-verify-review` | 2026-10-20 | no PR and not merged | Review D-04 verify-failures root-cause record: ACCEPTED with concrete fixes |
| `claude/implement-local-cloudflare-report` | 2026-10-20 | no PR and not merged | Interim final report for the local and Cloudflare phase |
| `claude/implement-local-cloudflare-staging-d` | 2026-10-20 | no PR and not merged | Record phase-D merge local verify run (online + offline) |
| `t5/batch2-record-drafts` | 2026-10-31 | no PR and not merged | T5 batch 2: draft test-change records for the independent evaluator (not for merge) |
| `worktree-agent-a5c863459daafbf2b` | 2026-10-20 | no PR and not merged | Demo compliance tests: apply learned substitutions longest first (a share token can contain the post ID) |
| `claude/implement-aws-g-10` | 2026-10-24 | merged into `main` |  |
| `claude/implement-aws-g-11` | 2026-10-24 | merged into `main` |  |
| `claude/implement-aws-g-12` | 2026-10-24 | merged into `main` |  |
| `claude/implement-aws-g-ev` | 2026-10-24 | merged into `main` |  |
| `claude/implement-aws-g-int` | 2026-10-24 | merged into `main` |  |
| `claude/implement-aws-g-run` | 2026-10-24 | merged into `main` |  |
| `claude/implement-aws-g-t4` | 2026-10-24 | merged into `main` |  |
| `archive/implement-local-cloudflare` | 2026-10-25 | no PR and not merged | Archive superseded release-1 evidence from claude/better-auth |
| `aws` | 2026-10-24 | no PR and not merged | Evidence: compliance --target local --only FILES-AC-002 at ffdcbb5 (passed) |
| `claude/implement-aws-g-01` | 2026-10-24 | no PR and not merged | G-01: aws Target, ./targets/aws export stub, AWS secret location, config/aws/test.json, AWS SDK pins |
| `claude/implement-aws-g-02` | 2026-10-24 | no PR and not merged | G-02: RDS Data API SQL adapter with resume retry, error mapping and value normalisation |
| `claude/implement-aws-g-03` | 2026-10-24 | no PR and not merged | AWS G-03: S3 log sink with PAR-260 pending-write wait, SSM secret reader, Lambda settings |
| `claude/implement-aws-g-04` | 2026-10-24 | no PR and not merged | G-04: FILES on S3 (store, presigned tickets with session token, CORS value, preflight, S3 fake) |
| `claude/implement-aws-g-05` | 2026-10-24 | no PR and not merged | G-05: AWS Lambda runtime on assembleStage and hono/aws-lambda |
| `claude/implement-aws-g-06` | 2026-10-24 | no PR and not merged | G-06: build --target aws (Lambda bundle, entry, inspection) |
| `claude/implement-aws-g-07` | 2026-10-24 | no PR and not merged | G-07: AWS account operations (preflight, engine check, log bucket, shared VPC, SST state home) |
| `claude/implement-aws-g-08` | 2026-10-24 | no PR and not merged | G-08: SST AWS program writer (G-S2 program from the app definition, exact-ARN IAM, step-3 plan) |
| `claude/implement-aws-g-09` | 2026-10-24 | no PR and not merged | G-09: AWS database operations (resume wait, create/copy/drop on postgres, per-file migration transactions, ... |
| `claude/implement-aws-g-f1` | 2026-10-24 | no PR and not merged | G-F1: PGlite-backed RDS Data API fake with self-tests |
| `claude/implement-aws-g-s1` | 2026-10-24 | no PR and not merged | Spike G-S1: AWS SDK pins, Lambda runtime/arch, Hono Function URL adapter, Data API driver, SDK proxy |
| `claude/implement-aws-g-s2` | 2026-10-24 | no PR and not merged | G-S2: SST AWS stage program offline spike (type-check, Pulumi mocks, --target experiment) |
| `claude/implement-aws-g-t1` | 2026-10-24 | no PR and not merged | G-T1: AWS cloud test hooks (SSM, S3 log bucket, stage probe, IAM simulation, log deny, Function URL, pause ... |
| `claude/implement-aws-g-t2` | 2026-10-24 | no PR and not merged | G-T2: AWS criteria AWS-AC-001…006 |
| `claude/implement-aws-g-t3` | 2026-10-24 | no PR and not merged | G-T3: offline AWS pre-check suites (untagged, pre-check, not evidence) |
| `google` | 2026-10-24 | no PR and not merged | spike(ba-s1-s3): RESULT.md with evidence, problems and recommended PARs |

## Delete commands

One command per batch of at most 20 branches, in the table's order. Check the "no PR and not merged" rows first; drop any branch to keep from its command.

Batch 1 (20):

```sh
git push origin --delete claude/batch-a claude/batch-b claude/batch-c claude/better-auth claude/changelog-0.1.0 claude/ci-playwright claude/ci-skip-docs claude/cloudflare-release claude/distribution claude/implement-aws claude/implement-aws-fake-flake claude/implement-aws-gev-fixes claude/implement-local-cloudflare claude/implement-local-cloudflare-bv5 claude/implement-local-cloudflare-cf-passC claude/implement-local-cloudflare-cf-passC1 claude/implement-local-cloudflare-cf-passM claude/implement-local-cloudflare-d-ev claude/implement-local-cloudflare-ev5 claude/implement-local-cloudflare-fix-g6
```

Batch 2 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-fix-r2order claude/implement-local-cloudflare-g6-s1 claude/implement-local-cloudflare-int-cf claude/implement-local-cloudflare-rc-g6-review claude/merge-v0.2.0-testing-plan claude/pass3-fixes claude/pass4-code claude/pass4-tests claude/plan-setup-wizard claude/plan-v0.2.0 claude/plan-v0.2.0-facts claude/plan-v0.2.0-readme claude/r2-token-cleanup claude/readme claude/release-0.1.1 claude/releasing-doc claude/restore-retro-2026-10-19 claude/retro-2026-10-27 claude/retrospective-2026-10-27 claude/retrospective-2026-10-31-57
```

Batch 3 (20):

```sh
git push origin --delete claude/review-fixes claude/run-pass3 claude/run-pass4 claude/run-pass5 claude/skill-package claude/testing-standards-tdd-doegdn claude/tests-a claude/tests-bc claude/wizard-b1-permissions claude/wizard-b2-token-sources claude/wizard-b3-setup-record claude/wizard-b4-state-machine claude/wizard-b5-starter claude/wizard-b6-skill-docs claude/wizard-fix-auth-flake claude/wizard-fix-guard claude/wizard-fix-live claude/wizard-fix-protected-bootstrap claude/wizard-fix-review claude/wizard-handoff
```

Batch 4 (20):

```sh
git push origin --delete claude/wizard-live-evidence claude/wizard-live-pass claude/wizard-tests pr/05-static-checker pr/06-cli-provision pr/07-cli-provision-tests pr/08-template-integration-a pr/09-integration-tests-b pr/10-harness-reference-app pr/11-compliance-criteria-a pr/12-compliance-criteria-b-e2e pr/13-skill-demo pr/14-implementation-record pr/15-root-causes-evidence v0.2.0/00-run-records v0.2.0/02-standards-skill-core v0.2.0/03-standards-skill-refs v0.2.0/04-claude-md-standards v0.2.0/05-e2e-governance v0.2.0/06-compliance-tiers
```

Batch 5 (20):

```sh
git push origin --delete v0.2.0/08-baseline-root-causes v0.2.0/10-record-linters v0.2.0/11-claude-commit-hook v0.2.0/14-ci-classifier v0.2.0/15-playwright-projects v0.2.0/16-ci-pr-selection v0.2.0/17-ci-no-duplicates v0.2.0/20-coverage-fuzz-list v0.2.0/24-auth-app-contract v0.2.0/25-auth-app-oauth v0.2.0/25a-auth-app-upstream v0.2.0/26-auth-app-store v0.2.0/26a-auth-app-signin v0.2.0/27-auth-app-worker v0.2.0/27a-auth-app-entry v0.2.0/28-auth-app-integration v0.2.0/28m-merge-ci-into-auth-app v0.2.0/29-auth-app-ci v0.2.0/30-bootstrap-token-rules v0.2.0/31-oauth-clients
```

Batch 6 (20):

```sh
git push origin --delete v0.2.0/32-admin-app-deploy v0.2.0/33-token-policies-move v0.2.0/34-remove-email-setup v0.2.0/34a-remove-email-files v0.2.0/34b-setup-without-email-domain v0.2.0/34c-fix-bootstrap-token-rules v0.2.0/36-req-changes-6-1 v0.2.0/37-auth-doc-rewrite v0.2.0/39-setup-docs v0.2.0/39a-cli-skill-docs v0.2.0/39b-spec-followups v0.2.0/39c-role-change-wording v0.2.0/40-auth-app-provider v0.2.0/41-role-refresh v0.2.0/41a-test-app-auth-app v0.2.0/50-int-decisions-w1 v0.2.0/52-deploy-auth-binding v0.2.0/53-secrets-store-bindings v0.2.0/54-signing-credential-secrets-store v0.2.0/55-merge-auth-app-into-bootstrap
```

Batch 7 (20):

```sh
git push origin --delete v0.2.0/56-admin-app-signin v0.2.0/56b-admin-app-grant-routes v0.2.0/56c-admin-app-worker-deploy v0.2.0/57-everyday-token-page v0.2.0/57b-everyday-page v0.2.0/57z-everyday-switch v0.2.0/58-admin-status-page v0.2.0/58a-merge-f-into-e v0.2.0/59-account-setup-page v0.2.0/59b-account-setup-page v0.2.0/60-email-cleanup-offer v0.2.0/61-admin-app-integration v0.2.0/64-skill-setup-flow v0.2.0/65-quickstart-upgrade-notes v0.2.0/66-skill-testing-refs v0.2.0/67-template-e2e-layer v0.2.0/68-template-fuzz-helper v0.2.0/69-fix-template-signing v0.2.0/69r-reference-removed-scripts v0.2.0/70-readme-v020
```

Batch 8 (20):

```sh
git push origin --delete v0.2.0/70b-readme-wording v0.2.0/71m-merge-auth-provider-into-admin-app v0.2.0/71n-path-map-after-removals v0.2.0/74-auth-criteria-tests v0.2.0/74a-auth-sign-in-criteria-tests v0.2.0/75-setup-criteria-tests v0.2.0/78-e2e-scope v0.2.0/79-e2e-setup v0.2.0/80-e2e-signin v0.2.0/81-e2e-starter-upgrade v0.2.0/84-integration-provision v0.2.0/85-integration-testing v0.2.0/86-integration-client v0.2.0/88-fuzz-targets v0.2.0/89-fix-files-base64url-noncanonical v0.2.0/89b-fix-return-to-decoded-tab-newline v0.2.0/91-fix-native-copy-fetch v0.2.0/92-fix-mig-record-order v0.2.0/93-fix-selection-e2e004 v0.2.0/93a-fix-selection-e2e004
```

Batch 9 (20):

```sh
git push origin --delete v0.2.0/94-fix-release-login-check v0.2.0/95-fix-demo-signing v0.2.0/96-fix-remove-registry-first v0.2.0/96b-fix-deploy-without-email v0.2.0/97-fix-testing-type-exports v0.2.0/97b-fix-testing-types-email v0.2.0/98-fix-demo-role-refresh v0.2.0/99-records-harness-failures v0.2.0/cleanup-161 v0.2.0/integration v0.2.0/owner-decisions v0.2.0/plan-7a-trim claude/vibrant-lovelace-ny20lh pr/01-workspace-and-spec pr/02-framework-services pr/03-services-unit-tests pr/04-runtimes-build-testing claude/implement-aws-live v0.2.0/38-retire-password-mail-docs v0.2.0/42-drop-auth-mail-tables
```

Batch 10 (20):

```sh
git push origin --delete v0.2.0/43-check-login-auth-app v0.2.0/44m-merge-docs-into-auth-provider v0.2.0/45-remove-password v0.2.0/46-remove-mail v0.2.0/47-remove-admins v0.2.0/61a-admin-app-ci v0.2.0/61m-merge-ci-into-admin-app claude/ba-cf-pass claude/ba-cf-pass2 claude/ba-cleanup claude/ba-fix-cf claude/ba-fix-local claude/ba-fix-offline claude/ba-harness-limits claude/ba-i-a claude/ba-i-b claude/ba-i-c claude/ba-i-d claude/ba-i-e claude/ba-i-f
```

Batch 11 (20):

```sh
git push origin --delete claude/ba-i-f-fix claude/ba-i-g claude/ba-i-h claude/ba-signup-budget claude/ba-spec-roles claude/ba-t1 claude/ba-t2t3 claude/ba-t4 claude/better-auth-spike claude/implement-aws-gf1-fix claude/implement-local-cloudflare-a-01 claude/implement-local-cloudflare-a-02 claude/implement-local-cloudflare-a-03 claude/implement-local-cloudflare-a-04 claude/implement-local-cloudflare-a-05 claude/implement-local-cloudflare-a-06 claude/implement-local-cloudflare-a-07 claude/implement-local-cloudflare-a-08 claude/implement-local-cloudflare-a-09 claude/implement-local-cloudflare-a-10
```

Batch 12 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-a-ev claude/implement-local-cloudflare-a-int claude/implement-local-cloudflare-b-01 claude/implement-local-cloudflare-b-02 claude/implement-local-cloudflare-b-03 claude/implement-local-cloudflare-b-04 claude/implement-local-cloudflare-b-05 claude/implement-local-cloudflare-b-06 claude/implement-local-cloudflare-b-07 claude/implement-local-cloudflare-b-08 claude/implement-local-cloudflare-b-09 claude/implement-local-cloudflare-b-10 claude/implement-local-cloudflare-b-11 claude/implement-local-cloudflare-b-12 claude/implement-local-cloudflare-b-13 claude/implement-local-cloudflare-b-14 claude/implement-local-cloudflare-b-15 claude/implement-local-cloudflare-b-16 claude/implement-local-cloudflare-b-16a claude/implement-local-cloudflare-b-17
```

Batch 13 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-b-18 claude/implement-local-cloudflare-b-ev claude/implement-local-cloudflare-b-int claude/implement-local-cloudflare-b-run claude/implement-local-cloudflare-b-run2 claude/implement-local-cloudflare-b-t1 claude/implement-local-cloudflare-b-t2 claude/implement-local-cloudflare-b-t3 claude/implement-local-cloudflare-b-t4 claude/implement-local-cloudflare-b-t5 claude/implement-local-cloudflare-batch-verify-1 claude/implement-local-cloudflare-batch-verify-2 claude/implement-local-cloudflare-c-01 claude/implement-local-cloudflare-c-02 claude/implement-local-cloudflare-c-03 claude/implement-local-cloudflare-c-04 claude/implement-local-cloudflare-c-04a claude/implement-local-cloudflare-c-05 claude/implement-local-cloudflare-c-ev claude/implement-local-cloudflare-c-int
```

Batch 14 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-c-run claude/implement-local-cloudflare-c-run2 claude/implement-local-cloudflare-c-run3 claude/implement-local-cloudflare-c-t1 claude/implement-local-cloudflare-c-t2 claude/implement-local-cloudflare-c-t3 claude/implement-local-cloudflare-c-t4 claude/implement-local-cloudflare-c-t5 claude/implement-local-cloudflare-c-t6 claude/implement-local-cloudflare-cde-int claude/implement-local-cloudflare-cf-cleanupR claude/implement-local-cloudflare-cf-pass0 claude/implement-local-cloudflare-cf-pass1 claude/implement-local-cloudflare-cf-pass1b claude/implement-local-cloudflare-cf-pass1c claude/implement-local-cloudflare-cf-pass2to5 claude/implement-local-cloudflare-cf-passB claude/implement-local-cloudflare-cleanup claude/implement-local-cloudflare-d-01 claude/implement-local-cloudflare-d-02
```

Batch 15 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-d-03 claude/implement-local-cloudflare-d-04 claude/implement-local-cloudflare-d-05 claude/implement-local-cloudflare-d-06 claude/implement-local-cloudflare-d-07 claude/implement-local-cloudflare-d-t claude/implement-local-cloudflare-dbcap8 claude/implement-local-cloudflare-demo-rerun claude/implement-local-cloudflare-diag-b1 claude/implement-local-cloudflare-diag-b2 claude/implement-local-cloudflare-diag-b3 claude/implement-local-cloudflare-diag-b4 claude/implement-local-cloudflare-diag-c1 claude/implement-local-cloudflare-diag-c2 claude/implement-local-cloudflare-diag-c3 claude/implement-local-cloudflare-diag-c3b claude/implement-local-cloudflare-diag-c4 claude/implement-local-cloudflare-diag-c5 claude/implement-local-cloudflare-diag-c6 claude/implement-local-cloudflare-diag-c7
```

Batch 16 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-diag-cloudtests claude/implement-local-cloudflare-diag-e1 claude/implement-local-cloudflare-diag-e2 claude/implement-local-cloudflare-diag-e3 claude/implement-local-cloudflare-diag-e4 claude/implement-local-cloudflare-diag-f04 claude/implement-local-cloudflare-diag-f1 claude/implement-local-cloudflare-diag-f2 claude/implement-local-cloudflare-diag-f3 claude/implement-local-cloudflare-diag-f4 claude/implement-local-cloudflare-diag-mig002 claude/implement-local-cloudflare-diag-order claude/implement-local-cloudflare-diag-pass0 claude/implement-local-cloudflare-diag-pass1 claude/implement-local-cloudflare-diag-pass1c claude/implement-local-cloudflare-diag-pass2 claude/implement-local-cloudflare-diag-registry claude/implement-local-cloudflare-e-01 claude/implement-local-cloudflare-e-02 claude/implement-local-cloudflare-e-03
```

Batch 17 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-e-04 claude/implement-local-cloudflare-e-05 claude/implement-local-cloudflare-e-ev claude/implement-local-cloudflare-e-run claude/implement-local-cloudflare-e-t1 claude/implement-local-cloudflare-e-t2 claude/implement-local-cloudflare-f-01 claude/implement-local-cloudflare-f-01b claude/implement-local-cloudflare-f-01c claude/implement-local-cloudflare-f-01d claude/implement-local-cloudflare-f-04 claude/implement-local-cloudflare-f-04-rr claude/implement-local-cloudflare-f-ev claude/implement-local-cloudflare-f-ev2 claude/implement-local-cloudflare-f-ev3 claude/implement-local-cloudflare-final-local claude/implement-local-cloudflare-final-local-2 claude/implement-local-cloudflare-final-local-3 claude/implement-local-cloudflare-final-local-4 claude/implement-local-cloudflare-fix-auth005
```

Batch 18 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-fix-c1 claude/implement-local-cloudflare-fix-c2 claude/implement-local-cloudflare-fix-c3 claude/implement-local-cloudflare-fix-c3c claude/implement-local-cloudflare-fix-c4 claude/implement-local-cloudflare-fix-c4b claude/implement-local-cloudflare-fix-c5 claude/implement-local-cloudflare-fix-c6 claude/implement-local-cloudflare-fix-c7 claude/implement-local-cloudflare-fix-cloudtests claude/implement-local-cloudflare-fix-core001 claude/implement-local-cloudflare-fix-e1 claude/implement-local-cloudflare-fix-e2 claude/implement-local-cloudflare-fix-e3 claude/implement-local-cloudflare-fix-e4 claude/implement-local-cloudflare-fix-envtoken claude/implement-local-cloudflare-fix-f04a claude/implement-local-cloudflare-fix-f04b claude/implement-local-cloudflare-fix-f1 claude/implement-local-cloudflare-fix-f2
```

Batch 19 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-fix-f3 claude/implement-local-cloudflare-fix-f4a claude/implement-local-cloudflare-fix-f4b claude/implement-local-cloudflare-fix-http001 claude/implement-local-cloudflare-fix-mig claude/implement-local-cloudflare-fix-mig002 claude/implement-local-cloudflare-fix-pass0 claude/implement-local-cloudflare-fix-pass1 claude/implement-local-cloudflare-fix-registry claude/implement-local-cloudflare-fix-registry-2 claude/implement-local-cloudflare-fix-sec001 claude/implement-local-cloudflare-fix-sql001 claude/implement-local-cloudflare-fix-verify claude/implement-local-cloudflare-g2 claude/implement-local-cloudflare-g3 claude/implement-local-cloudflare-int-f04 claude/implement-local-cloudflare-int-final claude/implement-local-cloudflare-int-mig002 claude/implement-local-cloudflare-int-registry claude/implement-local-cloudflare-plan-f04
```

Batch 20 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-plan-tests claude/implement-local-cloudflare-plan-usage claude/implement-local-cloudflare-probe-r2order claude/implement-local-cloudflare-rc-b05-review claude/implement-local-cloudflare-rc-b1-review claude/implement-local-cloudflare-rc-b17-fix claude/implement-local-cloudflare-rc-b17-review claude/implement-local-cloudflare-rc-b2-review claude/implement-local-cloudflare-rc-b4-review claude/implement-local-cloudflare-rc-c1-review claude/implement-local-cloudflare-rc-c2-review claude/implement-local-cloudflare-rc-c3-review claude/implement-local-cloudflare-rc-c3b-review claude/implement-local-cloudflare-rc-c4-review claude/implement-local-cloudflare-rc-c5-review claude/implement-local-cloudflare-rc-c6-review claude/implement-local-cloudflare-rc-c7-review claude/implement-local-cloudflare-rc-cloudtests-review claude/implement-local-cloudflare-rc-e1-review claude/implement-local-cloudflare-rc-e2-review
```

Batch 21 (20):

```sh
git push origin --delete claude/implement-local-cloudflare-rc-e3-review claude/implement-local-cloudflare-rc-e4-review claude/implement-local-cloudflare-rc-f04-review claude/implement-local-cloudflare-rc-f1-review claude/implement-local-cloudflare-rc-f2-review claude/implement-local-cloudflare-rc-f3-review claude/implement-local-cloudflare-rc-f4-review claude/implement-local-cloudflare-rc-final-review claude/implement-local-cloudflare-rc-mig002-review claude/implement-local-cloudflare-rc-pass0-review claude/implement-local-cloudflare-rc-pass1-review claude/implement-local-cloudflare-rc-pass1c-review claude/implement-local-cloudflare-rc-pass2-review claude/implement-local-cloudflare-rc-registry-review claude/implement-local-cloudflare-rc-sql001-review claude/implement-local-cloudflare-rc-timeout-review claude/implement-local-cloudflare-rc-verify-review claude/implement-local-cloudflare-report claude/implement-local-cloudflare-staging-d t5/batch2-record-drafts
```

Batch 22 (1):

```sh
git push origin --delete worktree-agent-a5c863459daafbf2b
```

### Check before deleting

These are unused by the definition above but hold work the docs point to: `aws` is the branch the deferred AWS target lives on (DEC-0508, "branch `aws`" throughout the spec); `claude/implement-aws-g-*` are AWS work items, not all of them in `aws`; `archive/implement-local-cloudflare` is an archive of superseded release-1 evidence; `google` holds the Better Auth spike result. They are last in the table and in a batch of their own.

Batch 23 (20), only after checking:

```sh
git push origin --delete claude/implement-aws-g-10 claude/implement-aws-g-11 claude/implement-aws-g-12 claude/implement-aws-g-ev claude/implement-aws-g-int claude/implement-aws-g-run claude/implement-aws-g-t4 archive/implement-local-cloudflare aws claude/implement-aws-g-01 claude/implement-aws-g-02 claude/implement-aws-g-03 claude/implement-aws-g-04 claude/implement-aws-g-05 claude/implement-aws-g-06 claude/implement-aws-g-07 claude/implement-aws-g-08 claude/implement-aws-g-09 claude/implement-aws-g-f1 claude/implement-aws-g-s1
```

Batch 24 (5), only after checking:

```sh
git push origin --delete claude/implement-aws-g-s2 claude/implement-aws-g-t1 claude/implement-aws-g-t2 claude/implement-aws-g-t3 google
```

## Added after the list was written

| Branch | Last commit | Reason | Note |
| --- | --- | --- | --- |
| `v0.2.0/ci-userns-probe` | 2026-11-02 | PR closed without merging | THROWAWAY probe for `ai/implementation/root-causes/2026-11-02-ci-userns-offline.md` (PR #168, closed). Never merge. |

Batch 25 (1):

```sh
git push origin --delete v0.2.0/ci-userns-probe
```
