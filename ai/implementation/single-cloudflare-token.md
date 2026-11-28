# Cloudflare setup with one token: design notes and test results

Item: Cloudflare setup with one token (owner decisions of 2026-11-27; DEC-0795…DEC-0801). Spec: `docs/components/setup.md` (SETUP-REQ-001…007, SETUP-AC-001…011 rewritten). Branch `v0.2.0/single-cloudflare-token`.

## 1. The owner's problem and decisions

Startup was too hard: a short-lived bootstrap token made from a deep link set up the admin app and deleted itself, then the person signed in to the admin app, ran its Account setup page and made an everyday token there. The owner decided (binding):

1. One credential, supplied by the user: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment, else from a `.env`-format file, `~/.secrets/cloudflare` by default, overridable by an environment variable. Setup reports the source, never the value.
2. With no credential, print a copyable two-line template (nothing after `=`), where it goes, and a deep link.
3. No two-token workflow; never delete or roll the user's token; manage only tokens the framework created.
4. More permissions than needed: say nothing. Missing ones: name them and give the link.
5. Warn, do not fail, on a secrets file readable by group or others.
6. Choose the least complex fate for `.env.cloudflare` and the bootstrap path, and record it.

## 2. Design (what changed)

| Area | Before (v0.2.0-rc01) | Now |
| --- | --- | --- |
| Sources | environment, then project `.env.cloudflare` (read and written by the CLI) | environment, then `~/.secrets/cloudflare` (PAR-486; `CLOUDFLARE_SECRETS_FILE`, PAR-487), read only |
| Tokens | bootstrap (`CLOUDFLARE_BOOTSTRAP_TOKEN`, ≤ 1 day, self-deleting) + everyday (made in the admin app) | one user token, any expiry, never deleted, rolled or updated |
| Permission list | `BOOTSTRAP` (4) and `EVERYDAY` (4) | `TOKEN` (6): Workers Scripts, Workers R2 Storage, D1, Secrets Store, OAuth Client, Account API Tokens, all Write (PAR-331 → 3); `EVERYDAY` kept for the admin app's optional page |
| Permission check | bootstrap reads its own policies; everyday token probed per read | the token reads its own policies (`GET …/tokens/<id>` or `/user/tokens/<id>`), `comparePolicies` with `TOKEN`; missing listed by dashboard and API name with `deepLink("token")`; extra never mentioned; unreadable policies = "Account API Tokens Edit" missing |
| Account setup | bootstrap (clients, Secrets Store, admin app) in the CLI; the rest in the admin app's page 1 | both in the CLI, one run, when `checkAccountSetup` says not current; page 1's code moved to `provision/cloudflare/account-setup-run.ts` and shared |
| Token guard | DELETE only of the bootstrap's own ID (armed) or learned signing tokens | DELETE only of learned `prototype-r2-signing` tokens; anything on the user's token's ID or a PAR-361 ID refused; no PUT or roll ever |
| Account ID | optional; filled into `.env.cloudflare`; `--switch-account` | required (deploy already required it); never written; no switch; a token that cannot see it lists the accounts it sees by name |
| `.env.cloudflare` | the settings file | not read or written; a notice says to move it; git warnings and the `.gitignore` line kept for old files |
| Agent protection | deny rules for `.env.cloudflare` | plus `Read(~/.secrets/**)`, `Edit(~/.secrets/**)` and the shell readers of `.secrets/cloudflare` in the template's `.claude/settings.json`; the skill router names the file |

Why removal of `.env.cloudflare` rather than compatibility (DEC-0799): compatibility would keep a project-relative token file, its writer (template, fill-in, comment-out, mode 600, symlink handling) and a three-way precedence. Only 0.1.x and 0.2.0-rc01 apps have one; the notice tells them what to do.

Why the token's name is `prototype-framework-cli`, not `prototype-framework`: the admin app's Everyday token page finds "its" token by the name `prototype-framework` and may update it. A different name keeps the page away from the user's token (owner decision 3).

Why the CLI now does the account setup (DEC-0798): with one token that holds the six groups there is nothing the admin app's OAuth grant adds for setup, and sending the person to a browser sign-in and two pages was the hard part. The admin app is still deployed (sign-in for administrators, status and cleanup pages).

Files: `packages/framework/src/provision/cloudflare/{token-sources,cloudflare-setup,permissions,account-setup-run,git-safety}.ts`, `src/cli/{cloudflare-settings,wiring,main}.ts`, `src/cli/commands/{cloudflare-setup,upgrade,operations}.ts`, `src/admin-app/{setup-page,everyday-page,bundle,worker}.ts`, `src/provision/cloudflare/auth-app-deploy.ts` (message), test support `fake-cloud.test-support.ts` (D1 list and create), `setup-world.test-support.ts` (`token` kind, `/user/tokens/<id>`).

## 3. Test impact (testing-standards rule 5 and rule 8)

Added or rewritten (new expectations from setup.md as rewritten):
- unit: `token-sources.unit.test.ts` (20), `cloudflare-setup.unit.test.ts` (36), `cloudflare-settings.unit.test.ts` (11), `permissions.unit.test.ts` (+3), `upgrade.unit.test.ts` (verdict), `setup-world.unit.test.ts`, `tests/permission-tables.unit.test.ts`;
- integration (compliance): `tests/compliance/criteria/setup/cloudflare-setup.test.ts` (32, SETUP-AC-001…010), `starter-offline.test.ts` (SETUP-AC-001/009 offline), `criteria/cli/commands.test.ts` (CLI-AC-001's setup clause, and the secrets file pointed away from the operator's);
- e2e: `tests/compliance/e2e/E2E-017-setup.spec.ts` (6) and scenario E2E-017 rewritten (DEC-0801).

Changes to once-green tests, by reason:
- `component-removed` (the bootstrap token and `.env.cloudflare`, DEC-0796, DEC-0799): `tests/compliance/criteria/setup/bootstrap-v020.test.ts` removed (its clauses are SETUP-AC-001…008 as rewritten, now in `cloudflare-setup.test.ts`); in `cloudflare-setup.unit.test.ts` every bootstrap-expiry, self-delete, comment-out, account-switch, email-domain and everyday-quick-check test removed; in `token-sources.unit.test.ts` every write test (template, fill-in, comment-out, mode 600, symlinks) removed; E2E-017's bootstrap-expiry, Account setup page and Everyday token page tests removed (the pages keep `packages/framework/test/integration/admin-app`).
- `behaviour-changed` (DEC-0795…DEC-0799): SETUP-AC-001…010 expectations (template, link, sources, permission messages, one-run setup, guard), CLI-AC-001's setup clause, `cloudflare-settings.unit.test.ts` (secrets file instead of `.env.cloudflare`), `permissions.unit.test.ts` (`TOKEN`, `PERMISSIONS_VERSION` 3, `TOKEN_NAMES`), `upgrade.unit.test.ts` (the verdict text), `tests/permission-tables.unit.test.ts` (the `token` table), `setup-page.unit.test.ts` and `auth-app-deploy.unit.test.ts` ("run npm run cloudflare-setup first" without "with a bootstrap token"), `setup-world.unit.test.ts` (`TOKEN` for Secrets Store Write).
- `refactor-only`: none of the admin app's page 1 tests changed beyond the message above; its code moved to `account-setup-run.ts` unchanged.

Fuzz targets: none affected. CI path map: no new component or test file outside existing directories (`tests/compliance/criteria/setup`, `packages/framework/test/integration/admin-app` already map SETUP).

## 4. Test results (this branch, 2026-11-27)

- `npm run typecheck`: pass. `npm run lint`: pass.
- Unit (`vitest.unit.config.ts`, whole suite): 2969 tests in 276 files; 2965 passed, 4 failed. The only failures are the 4 tests of `tests/support/mock-oauth2/launcher.unit.test.ts`, untouched by this branch. Root cause (evidence): they spawn `node` to import `launcher.ts`; this machine's Node 22.22.1 has no TypeScript stripping (`node -e 'console.log(process.features.typescript)'` prints `false`, and importing any `.ts` file fails with `ERR_UNKNOWN_FILE_EXTENSION`). An environment difference (the repository pins Node 22.22.0), not this change.
- Integration: `tests/compliance/criteria/setup` (both files), `tests/skill/cloudflare-setup.test.ts`, `tests/compliance/criteria/cli/git-warnings.test.ts`, `packages/framework/test/integration/admin-app`: 5 files, 56 tests, all pass (mock-oauth2-server from its Docker image, as CI runs it).
- E2E: `E2E-017-setup.spec.ts` (project `e2e-api`): 6 passed.
- `criteria/setup/starter-offline.test.ts` (the packed starter, installed offline, then `cloudflare-setup` with no credential): 1 passed.
- Not run here: `criteria/cli/commands.test.ts` (every CLI command in both forms on a template copy; long). CI runs it.

Live, read-only (the owner's account token from `~/.secrets/cloudflare`; every non-GET request refused before sending, by a wrapper; the token never printed, and the output was searched for it): setup reported both settings "from the file /home/…/.secrets/cloudflare", found the account, said "has every permission the framework needs" for a token with about 390 permission groups (no word about the extra ones), then found the account's v0.2.0 setup not current and stopped at its first write (`POST …/oauth_clients`, refused by the wrapper). So the source reporting, the account check, the self-read of the token's policies and the permission comparison work on the real API. The full setup (writes) was not run on the owner's primary account: it would create OAuth clients, Workers, a D1 database, buckets and a signing token there. That is SETUP-AC-011's milestone run, for the owner to schedule (a test account, or the primary account if wanted).

## 5. Deviations and open points

- **Roles (testing-standards rule 1).** This item was done by one agent, itself a subagent, which the rule forbids from creating further agents; implementer, test-case author and runner were therefore not separate, and there is no independent evaluator verdict. Red/green was followed at module level (the new `token-sources` tests were run against the old module first: 18 of 20 failed as expected), not one behaviour at a time. The orchestrator may want an independent test review of `cloudflare-setup.test.ts` and E2E-017 before merge.
- **Product skill (rule 10).** `skill/SKILL.md`'s hard rule now also names `~/.secrets/cloudflare`; no testing rule was removed or loosened; the router keeps its pointers to reference files.
- **Live-pass runner.** `scripts/live-pass/` (DEC-0793) still drives the bootstrap-and-admin-app flow (starter tokens, the Everyday token page). It is not changed here and must be reworked before the next live pass.
- **Open questions for the owner:** (1) retire the admin app's Account setup and Everyday token pages, or the admin app itself? (2) Run SETUP-AC-011's live setup on which account? (3) Release: this changes PAR-331 and the setup flow, so it belongs in the next release candidate (`0.2.0-rc02`, DEC-0792).

## 6. Final counts

- Unit: 2965 passed, 4 failed (the environment-caused launcher tests of §4), 276 files.
- Integration run here: 56 passed (5 files), re-run after the last code change: 46 passed (3 files).
- Offline starter run: 1 passed.
- E2E-017: 6 passed.
