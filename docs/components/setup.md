# SETUP — Cloudflare setup

The one re-runnable command that takes a project from no Cloudflare access to a set-up account: `cloudflare-setup` (plan-setup-wizard §3–§4, owner decisions of 2026-10-26 and 2026-11-27). It reads the current state each run and does only what is missing, so the same command serves a new project, a project with a lot of local work, a bad paste, and a framework release that needs more account setup.

Since the owner's decisions of 2026-11-27 (DEC-0795…DEC-0800) there is **one credential, supplied by the user**: a Cloudflare API token in `CLOUDFLARE_API_TOKEN` and the account in `CLOUDFLARE_ACCOUNT_ID`, from the environment or from the secrets file `~/.secrets/cloudflare`. The framework never deletes, rolls or updates that token. The two-token flow of v0.2.0-rc01 (a short-lived bootstrap token that deleted itself, and an everyday token made in the admin app; DEC-0563, DEC-0697) is gone: its text is in git history and in those decisions.

Contracts: none app-facing. The token's permission list is `packages/framework/src/provision/cloudflare/permissions.ts` (`TOKEN`; PAR-331, PAR-332, DEC-0797); the secrets file is PAR-450 and its override PAR-451.

## 1. Requirements

#### SETUP-REQ-001 — One re-runnable command
Origin: owner · Derives from: SYS-REQ-022, SYS-REQ-023 · Decision: DEC-0577, DEC-0578, DEC-0584, DEC-0588, DEC-0591, DEC-0798

`cloudflare-setup` MUST read the current state and then do only what is missing, in this order: the project's local setup when it has not been done (dependencies, local secrets, the `.gitignore` line); the git checks (SETUP-REQ-005); the credential (SETUP-REQ-002); the token, the account and the token's permissions (SETUP-REQ-004); when the account setup record is missing or older than the release's `ACCOUNT_SETUP_VERSION`, the whole account setup with the user's token (the `workers.dev` subdomain, the admin and sign-in OAuth clients with their secrets in Secrets Store, the admin app, the auth app with its database, the shared buckets, the signing credential and the setup record); the network check; a summary with the next step (a `deploy` of a `test-` stage). On a project whose token is valid and whose account setup is current it MUST change nothing and ask for nothing. It MUST ask nothing on standard input and takes no arguments. It MUST exit 0 only when the account is set up and every host reachable, and 1 for every stop that needs the user (DEC-0588).

The admin app's Account setup and Everyday token pages stay but are optional: the command does the account setup itself, and nobody needs an everyday token (DEC-0798).

#### SETUP-REQ-002 — One credential: the environment, then `~/.secrets/cloudflare`
Origin: owner · Derives from: SYS-REQ-023 · Decision: DEC-0795, DEC-0799, DEC-0800

The command, like every Cloudflare command, MUST take `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the names wrangler reads) from the environment first; a setting the environment does not set MUST be taken from the secrets file, a file in `.env` format with the same names. The secrets file is `~/.secrets/cloudflare` in the user's home directory (PAR-450), never a path relative to the project, so every project, worktree and session on the machine shares it; `CLOUDFLARE_SECRETS_FILE` overrides the path (PAR-451; `~/` and any relative path are read from the home directory). When both sources hold a setting and differ, the environment MUST win and a notice MUST name the setting. The command MUST say which source each setting came from (the variable, or the file's path), never the value.

The framework MUST NOT create, write or change the secrets file, and MUST NOT write either value anywhere. A secrets file readable by its group or by others MUST be warned about on every run (with `chmod 600` and the path) and MUST NOT fail the run. The project's old `.env.cloudflare` (PAR-340) and `CLOUDFLARE_BOOTSTRAP_TOKEN` MUST NOT be read; when either is present, a notice MUST say it is no longer used.

#### SETUP-REQ-003 — Each stop says exactly what to do
Origin: owner · Derives from: SYS-REQ-023, SYS-REQ-029 · Decision: DEC-0795, DEC-0797

Every message that needs the user to act MUST include the exact link or command. In particular:
- no credential, or one of the two settings missing: the template, exactly the two lines `CLOUDFLARE_API_TOKEN=` and `CLOUDFLARE_ACCOUNT_ID=` with nothing after the `=`, meant to be copied out of the chat and used both as the secrets file's contents and as a session's environment variables; where it goes (the resolved secrets file path, or a cloud session's environment variables); the token's pre-filled dashboard link (`deepLink`, DEC-0564) with what to choose on its page; where to find the account ID; and the next prompt "continue prototype setup";
- a bad token (not accepted by Cloudflare, not active): which setting, where it came from, what is wrong, and the token link;
- an account the token cannot see (`CLOUDFLARE_ACCOUNT_ID` names another one): the accounts the token sees, by name only, where to find the right ID, and the token link (DEC-0585);
- a token missing required permissions: exactly which ones, as the dashboard names them, and the token link (SETUP-REQ-004);
- a blocked network host (`api.cloudflare.com`, R2's storage host or the account's `workers.dev` subdomain): the host, and where to change the cloud environment's network policy.

#### SETUP-REQ-004 — The user's token: checked, used, never changed
Origin: owner · Derives from: SYS-REQ-023 · Decision: DEC-0796, DEC-0797, DEC-0589

The command MUST verify the token and read its own permissions with it, and compare them with the release's list (`TOKEN`). A token with more permissions than the list MUST be accepted without any message about them. A token lacking any MUST stop the run before any change, naming exactly the missing permissions and giving the token link; a token that cannot read its own permissions lacks "Account API Tokens Write", which MUST be named, with the note that the others could not be checked.

The framework MUST NEVER delete, roll or update the user's token, nor any token whose ID PAR-361 names. It MAY mint tokens it needs itself through the API (the R2 signing token), and MUST manage (replace or delete) only tokens it created. The user creates at most one token.

#### SETUP-REQ-005 — Git safety warns and never blocks
Origin: owner · Derives from: SYS-REQ-015 · Decision: DEC-0572, DEC-0598, DEC-0799

Every run MUST print a prominent warning when the project is not a git repository, and, for an old `.env.cloudflare` still in the project, when it is not ignored and when it is tracked; the tracked warning MUST say that the tokens are in the history and how to replace them. The command MUST add `.env.cloudflare` to `.gitignore` unless it is already ignored or `.gitignore` holds PAR-343's marker, so an old file is never committed. None of these conditions may stop the command or change its exit status.

#### SETUP-REQ-006 — Account switch
Status: retired (DEC-0799). The account is the user's `CLOUDFLARE_ACCOUNT_ID`, which setup never writes, so there is nothing to switch and no `--switch-account`. A token that cannot see that account is a stop of SETUP-REQ-003. Stages on an account the user moves away from keep running until removed with `remove`, as before.

#### SETUP-REQ-007 — No token value is printed
Origin: owner · Derives from: SYS-REQ-015 · Decision: DEC-0573, DEC-0590, DEC-0599

No output of the command may contain a token value, an account ID, a zone ID, a token ID or the account's `workers.dev` subdomain, except the admin app's URL in the summary (DEC-0686). It reports pass or fail, settings and their sources (variable names, the secrets file's path), account names, permission names and HTTP status codes.

## 2. Design

The command is the framework CLI's `cloudflare-setup` (CLI-REQ-001), run as `npm run cloudflare-setup`; the skill runs it on "set up Cloudflare", "continue prototype setup" and "continue setup" and relays its output as is (SKILL-REQ-007). Its steps (DEC-0795…DEC-0800):

0. **Local setup** (`runLocalSetup`, DEC-0591), when not done.
1. **The credential's sources** (`token-sources.ts`, `readCloudflareSettings`): the environment, then the secrets file. Its notices (a value that differs between the two; a file others can read; an old `.env.cloudflare` or `CLOUDFLARE_BOOTSTRAP_TOKEN`) go to standard error, then the git warnings (`git-safety.ts`, DEC-0572).
2. **Both settings or a stop:** either missing prints `noCredentialText`: the two-line template (`CREDENTIAL_TEMPLATE`), where it goes (`whereItGoes`, with the resolved path), the token link (`tokenLinkBlock`: `deepLink("token")`, DEC-0564, named `prototype-framework-cli`), where the account ID is shown, and the next prompt. Otherwise each setting's source is printed.
3. **The token:** `GET /accounts` and `/accounts/<id>/tokens/verify` (or `/user/tokens/verify` for a user token): valid and active, and the account `CLOUDFLARE_ACCOUNT_ID` names is among those it sees.
4. **Its permissions:** `GET /accounts/<a>/tokens/<its ID>` (or `/user/tokens/<its ID>`), compared with `TOKEN` by `comparePolicies` (DEC-0565). Missing groups are listed by their dashboard name ("Edit" for "Write") and API name, with the link. Extra groups are not mentioned.
5. **The account setup**, when `checkAccountSetup` (DEC-0577, DEC-0578) finds the setup record missing, older than `ACCOUNT_SETUP_VERSION`, or a step missing: the `workers.dev` subdomain, the admin and sign-in OAuth clients with their IDs and secrets in Secrets Store under PAR-436's names (DEC-0684, DEC-0685), the admin app (Worker PAR-438, DEC-0686), then `runAccountSetup` (`account-setup-run.ts`, the code the admin app's Account setup page also runs, DEC-0719): the auth app and its D1 database, the shared buckets, the signing credential in Secrets Store and the setup record. Each part finds what exists and makes only what is missing.
6. **Network check** of `api.cloudflare.com`, the account's R2 storage host and its `workers.dev` subdomain, each named by kind and bounded by PAR-360; a blocked one names the hosts to allow (`api.cloudflare.com`, `*.r2.cloudflarestorage.com`, `*.workers.dev`).
7. **Summary:** account name, account setup, the admin app's URL when it was just deployed (optional: status and cleanup pages), then the next step, `npm run deploy -- --target cloudflare --stage test-first`.

Every token write passes a guard, an allow-list (DEC-0589, DEC-0618, DEC-0796): nothing on the user's token's ID and nothing on a PAR-361 ID; no `PUT` and no roll of any token; a `DELETE` only of a `prototype-r2-signing` token the guard saw in a token list or a create answer. Every printed line passes a redaction of the run's token value, account ID, token IDs and subdomain (DEC-0590).

The implementation is `packages/framework/src/provision/cloudflare/cloudflare-setup.ts`, bound in `src/cli/commands/cloudflare-setup.ts`. Every other Cloudflare command reads the same credential through `cli/cloudflare-settings.ts` (`withCloudflareSettings`). This document states the outcomes the criteria check.

## 3. Uses

PROV (the setup record and the account steps), CLI (the command table, the credential's sources and the git warnings), CF (the Cloudflare API, OAuth clients and Secrets Store), SKILL (the trigger phrases), the admin app (its account setup code, which the command shares; plan-v0.2.0 §5.2).

## 4. Acceptance criteria

SETUP-AC-001…SETUP-AC-011 are rewritten for the one credential (DEC-0795…DEC-0800); their IDs and Where columns are kept, and SETUP-AC-006 now checks the retired account switch's replacement. The automated criteria run against the fake Cloudflare API (`fake-cloud.test-support.ts`, `setup-world.test-support.ts`), with fake token values only and a temporary home directory; the output of every run is searched for each fake token value.

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| SETUP-AC-001 | With no credential in the environment or the secrets file, `cloudflare-setup` prints the two template lines `CLOUDFLARE_API_TOKEN=` and `CLOUDFLARE_ACCOUNT_ID=` exactly, one after the other with nothing after the `=`; the resolved secrets file path (`~/.secrets/cloudflare` under the home directory, or the `CLOUDFLARE_SECRETS_FILE` path); that the same lines work as a cloud session's environment variables; the token link exactly as `deepLink("token")` builds it (the six groups of `TOKEN`, name `prototype-framework-cli`); where to find the account ID; and "continue prototype setup". It prints nothing about a bootstrap or an everyday token. It writes no file (no `.env.cloudflare`, no secrets file), sends no Cloudflare request and exits 1. With only one of the two settings set, it names the missing one and prints the same template and link. | SETUP-REQ-001, SETUP-REQ-003 | Local |
| SETUP-AC-002 | With a valid token holding every permission of the list and a current setup record (`setupVersion` equal to `ACCOUNT_SETUP_VERSION`, every step's inspection done), the command says everything is already set up, asks for nothing, makes no Cloudflare write request, leaves the secrets file byte for byte as it was and exits 0. The same holds with the values in the environment only, and then no file is created. The output names each setting's source (the variable or the file's path) and holds no value. | SETUP-REQ-001, SETUP-REQ-002 | Local |
| SETUP-AC-003 | For each bad credential (a value that is not a token, a token that is not active, a `CLOUDFLARE_ACCOUNT_ID` the token cannot see), the output names the setting, where it came from and what is wrong, and gives the token link; for the account, it lists the accounts the token sees by name only. The command exits 1, makes no write request, and no token is updated, rolled or deleted. | SETUP-REQ-003 | Local |
| SETUP-AC-004 | A token lacking one or several permissions of the list (also by a `deny` policy) makes the command name exactly the missing ones, by their dashboard name, and give the token link; it changes nothing and exits 1. A token that cannot read its own permissions gets "Account API Tokens Edit" named and the note that the others could not be checked. A token with more permissions than the list (other account groups, zone groups) passes with no message about them. | SETUP-REQ-004 | Local |
| SETUP-AC-005 | On an account with no setup, one run with a token holding exactly the list creates the admin and the sign-in OAuth clients (private, confidential, `response_types ["code","id_token"]`, required scopes `user-details.read` and `memberships.read`; the admin client's six optional scopes, the sign-in client's none) with their IDs and secrets in Secrets Store under PAR-436's names, deploys the admin app and the auth app with its D1 database, creates the shared buckets and the signing credential, writes the setup record at `ACCOUNT_SETUP_VERSION`, prints the next step and exits 0. A second run changes nothing. Across both runs no request updates, rolls or deletes the user's token or a token PAR-361 names; the only token deletions are of `prototype-r2-signing` tokens. A step that fails stops the run with exit 1 and its cause, with the user's token still untouched. | SETUP-REQ-001, SETUP-REQ-004 | Local |
| SETUP-AC-006 | The environment wins over the secrets file for each setting (a token in the file that differs from the environment's is not used, and a notice names the setting); a setting the environment lacks is taken from the file; `CLOUDFLARE_SECRETS_FILE` points at another file. A secrets file readable by group or others gets a warning with `chmod 600` and the path, and the exit status is the same as with mode 600. An old `.env.cloudflare` in the project and a `CLOUDFLARE_BOOTSTRAP_TOKEN` are not used, each with a notice. An argument (such as the removed `--switch-account`) is a usage error that does not echo it. | SETUP-REQ-002, SETUP-REQ-006 | Local |
| SETUP-AC-007 | A second project on the same machine, with no file of its own, completes from the same secrets file with no write request (the file is not relative to a project). | SETUP-REQ-001, SETUP-REQ-002 | Local |
| SETUP-AC-008 | Each of these stops exits 1 and prints its link or command: a network host blocked (named by kind, with the hosts to allow in a cloud environment's network access settings). On Workers Free, and with no zone, the command does not stop for the plan or a domain. | SETUP-REQ-001, SETUP-REQ-003 | Local |
| SETUP-AC-009 | In a project whose local setup is missing, the command runs it first (dependencies, local secrets, the `.gitignore` line). Outside a git repository, with an old `.env.cloudflare` not ignored, and with it tracked, each run prints the matching warning set off from the rest of the output, and the exit status is the same as without the condition; the `.gitignore` line is added unless PAR-343's marker is present. | SETUP-REQ-001, SETUP-REQ-005 | Local |
| SETUP-AC-010 | Across every run of SETUP-AC-001 to SETUP-AC-009, no output (standard output, standard error, or a file the command writes) contains any fake token value, account ID, zone ID, token ID or `workers.dev` subdomain, other than the admin app's URL in the summary. | SETUP-REQ-007 | Local |
| SETUP-AC-011 | On a real account, with the owner's own token from the environment or `~/.secrets/cloudflare` (a broad, non-expiring token is expected): the command reports the source, says nothing about the token's extra permissions, finds the account set up (or sets it up), and exits 0; afterwards the token still verifies as active, with the same ID and the same policies as before the run. A pasted non-token value gets the bad-token message. | SETUP-REQ-001, SETUP-REQ-002, SETUP-REQ-003, SETUP-REQ-004 | Cloud (milestone) |

## 5. Portability note

The command is Cloudflare's only: its token, link, OAuth clients and admin app are Cloudflare's. A new target would get its own setup command; the local setup (step 0), the git warnings, the secrets-file pattern (environment first, then a file under the home directory) and the no-value rule are target-neutral and would be shared.
