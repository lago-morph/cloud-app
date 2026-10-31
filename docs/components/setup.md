# SETUP — Cloudflare setup

The one re-runnable command that takes a project from no Cloudflare account access to a set-up account: `cloudflare-setup` (plan-setup-wizard §3–§4, owner decisions of 2026-10-26). It reads the current state each run and does only what is missing, so the same command serves a new project, a project with a lot of local work, an account switch, a bad paste, and a framework release that needs more Cloudflare permissions. It drives PROV's account setup (`setup-account`, PROV-REQ-004) with the bootstrap token; every other command uses the everyday token.

Contracts: none app-facing. The token permission lists are `packages/framework/src/provision/cloudflare/permissions.ts` (PAR-331, PAR-332, DEC-0563); the settings file is PAR-340.

## 1. Requirements

#### SETUP-REQ-001 — One re-runnable command
Origin: owner · Derives from: SYS-REQ-022, SYS-REQ-023 · Decision: DEC-0563, DEC-0577, DEC-0578, DEC-0584, DEC-0588, DEC-0591, DEC-0697

`cloudflare-setup` MUST read the current state and then do only what is missing, in this order: the project's local setup when it has not been done (dependencies, local secrets, `.env.cloudflare` in `.gitignore`); the git checks (SETUP-REQ-005); both tokens; the account and its plan; the email domain; the account setup record; with the bootstrap token, the missing setup steps, the everyday token's permissions and the bootstrap token's self-deletion; the network check; a summary with the next step (a `deploy` of a `test-` stage). On a project whose tokens are valid and whose account setup is current it MUST change nothing and ask for nothing. `setup-account` stays as the account-setup step it calls, for scripts and advanced users. It MUST ask nothing on standard input: its options `--email-domain <domain>` and `--switch-account` answer its two questions. It MUST exit 0 only when the account is set up, the everyday token current and every host reachable, and 1 for every stop that needs the user (DEC-0588).

Amendment for v0.2.0 (Origin: owner, plan-v0.2.0 §1 D9 and D10, §5 · Decision: DEC-0697): the command no longer sets up the account. With a bootstrap token it runs only the bootstrap (SETUP-REQ-004 as amended), then prints the admin app's URL and the next step, "open the admin app and sign in". Without one it runs the check that "continue prototype setup" asks for: the local setup and the git checks, the everyday token, the account, the account setup record and the network, ending with the summary. The email domain, the plan check, the account setup steps and the everyday token's permission update leave the command: the admin app does the account setup and makes the everyday token (plan-v0.2.0 §5.2). Anything missing MUST name the admin app's page that does it, and give the bootstrap link as well while the admin app is not deployed. `--email-domain` goes. The rest is unchanged: the command reads the current state, changes nothing and asks for nothing when all is current, asks nothing on standard input, and `--switch-account` answers its question.

#### SETUP-REQ-002 — Tokens from the environment, then `.env.cloudflare`
Origin: owner · Derives from: SYS-REQ-023 · Decision: DEC-0570, DEC-0571, DEC-0574, DEC-0697

The command, like every Cloudflare command, MUST take `CLOUDFLARE_BOOTSTRAP_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_EMAIL_DOMAIN` and `CLOUDFLARE_ACCOUNT_ID` from the environment first, then from `.env.cloudflare` in the project root (PAR-340), and say which source it uses when both hold different values. Valid tokens already in the environment MUST be used without any prompt. The framework CLI alone writes the file, leaving it at PAR-341 after every write. On success it MUST fill in an empty `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_DOMAIN` (never changing a set value), so a copy of the file starts another project on the same account, and replace the bootstrap token's line with PAR-342 once the token is deleted.

Amendment for v0.2.0 (Origin: owner, plan-v0.2.0 §1 D9 and D10, §5 · Decision: DEC-0697): `CLOUDFLARE_EMAIL_DOMAIN` is no longer read or written; v0.2.0 has no email domain (plan-v0.2.0 §5.3).

#### SETUP-REQ-003 — Each stop says exactly what to do
Origin: owner · Derives from: SYS-REQ-023, SYS-REQ-029 · Decision: DEC-0697

Every message that needs the user to act MUST include the exact link or command. In particular:
- no everyday token: the plan and domain requirements (Workers Paid; a domain on Cloudflare DNS), both tokens' pre-filled dashboard links with what to choose on each page, the four-line template of `.env.cloudflare`, where it goes (a cloud session's environment settings, then a new session; on the command line the environment or `.env.cloudflare`), and the next prompt "continue prototype setup";
- a bad token (not accepted by Cloudflare, not active, the same token in both settings, a bootstrap token that cannot read API tokens or lacks a bootstrap permission, a user token given as the bootstrap token, a token of another account, an everyday token scoped to another zone or with a permission denied): which setting and what is wrong, with only that token's link;
- several accounts visible and `CLOUDFLARE_ACCOUNT_ID` unset: the accounts by name only, and how to copy the chosen one's ID from the dashboard into `CLOUDFLARE_ACCOUNT_ID` (DEC-0585);
- a plan other than Workers Paid, read with the bootstrap token's "Billing Read": that Better Auth needs it; the command stops before any change. A run with the everyday token alone cannot read the plan and reports it "not checked" (DEC-0588);
- no email domain: the account's zones, to pick one (also when there is only one), with `CLOUDFLARE_EMAIL_DOMAIN` or `--email-domain <domain>`; with none, that a domain is needed; a zone that is not active, to finish adding it;
- the bootstrap token needed and absent: only the bootstrap link and the next prompt;
- a blocked network host (`api.cloudflare.com`, R2's storage host or the account's `workers.dev` subdomain): the host, and where to change the cloud environment's network policy.

Amendment for v0.2.0 (Origin: owner, plan-v0.2.0 §1 D9 and D10, §5 · Decision: DEC-0697): with no everyday token, the stop gives the bootstrap token's link with what to choose, including an expiry no more than PAR-435 away; the four-line template of `.env.cloudflare` becomes three lines (no email domain); and the everyday-token link is replaced by the admin app's Everyday token page (plan-v0.2.0 §5.2 page 2). The plan stop (Workers Paid), the domain requirement and the email-domain stop are removed: the Workers Free plan suffices (plan-v0.2.0 §1). A bad everyday token's message names the admin app's Everyday token page instead of a link.

#### SETUP-REQ-004 — The bootstrap token: used once, then deleted
Origin: owner · Derives from: SYS-REQ-023 · Decision: DEC-0563, DEC-0565, DEC-0577, DEC-0586, DEC-0588, DEC-0589, DEC-0697

When the account setup record is missing or older than the release's `ACCOUNT_SETUP_VERSION`, or the everyday token lacks a permission of the release's list, the command MUST need the bootstrap token. With it, it MUST run only the missing setup steps, write the setup record, read the everyday token's permissions and zone exactly once and compare them with the list, add any missing permission to the existing everyday token in place (its value unchanged), and then make the bootstrap token delete itself. An everyday token scoped to the wrong account or zone MUST be explained, with the everyday link to make a new one. A bootstrap token without an expiry MUST be warned about. When the setup is already current and a bootstrap token is still valid, the everyday token MUST still be checked once and the bootstrap token deleted the same way. The bootstrap token MUST be kept when the setup steps or the in-place update fail, or the everyday token must be made again, so the next run can check the new one with it. Only an account token is accepted as the bootstrap token. No token whose ID PAR-361 names may be updated or deleted, and the everyday token is never deleted. So a bootstrap token whose ID PAR-361 (or the command's own list of protected IDs) names does not delete itself: the command MUST NOT send that delete, MUST leave its `.env.cloudflare` line as it is (the token still exists), MUST say that the token is protected and was not deleted, and finishes as it otherwise would (DEC-0589).

Amendment for v0.2.0 (Origin: owner, plan-v0.2.0 §1 D9 and D10, §5 · Decision: DEC-0697): the paragraph above is replaced by the following. The bootstrap token MUST be used once and never stored:
- On reading it, the command MUST verify it and read its expiry. When it has no expiry, or one more than PAR-435 away, the command MUST delete it at once, use it for nothing else, and stop with the bootstrap link and the instruction to make a new one with an expiry no more than PAR-435 away.
- With a usable bootstrap token the command MUST run only the bootstrap: create the admin and the sign-in OAuth clients, put each client's secret straight into the account's Secrets Store, deploy the admin app, and then make the bootstrap token delete itself as the run's last Cloudflare request. It MUST NOT read, update or create the everyday token, and MUST NOT apply account setup steps.
- The token's value MUST NOT be written to any file, environment setting or log. Its line in `.env.cloudflare` MUST be replaced with PAR-342. In a cloud session the command MUST say that the environment variable can be deleted because it is already invalid.
- When the bootstrap stops before its end, the token MUST NOT be deleted and its line MUST be kept, so the user can run it again within its expiry. An interrupted run therefore leaves at most a PAR-435 window. A protected token (PAR-361) MUST be neither used nor deleted.

#### SETUP-REQ-005 — Git safety warns and never blocks
Origin: owner · Derives from: SYS-REQ-015 · Decision: DEC-0572, DEC-0598

Every run MUST print a prominent warning when the project is not a git repository, when `.env.cloudflare` is not ignored, and when it is tracked; the tracked warning MUST say that the tokens are in the history and how to replace them. The command MUST add `.env.cloudflare` to `.gitignore` unless it is already ignored or `.gitignore` holds PAR-343's marker. None of these conditions may stop the command or change its exit status.

#### SETUP-REQ-006 — Account switch
Origin: owner · Derives from: SYS-REQ-023, SYS-REQ-024 · Decision: DEC-0585

When the tokens' account differs from the project's recorded account (`CLOUDFLARE_ACCOUNT_ID`), the command MUST explain that stages on the old account keep running and how to remove them with the old everyday token while it still works, and stop without a change. Run again with `--switch-account`, it MUST set up the new account as needed and replace `CLOUDFLARE_ACCOUNT_ID` in `.env.cloudflare`, or say to change it in the environment when it comes from there. It MUST NOT change anything on the old account.

#### SETUP-REQ-007 — No token value is printed
Origin: owner · Derives from: SYS-REQ-015 · Decision: DEC-0573, DEC-0590, DEC-0599

No output of the command may contain a token value, an account ID, a zone ID, a token ID or the account's `workers.dev` subdomain. It reports pass or fail, settings, account and zone names, permission names and HTTP status codes.

## 2. Design

The command is the framework CLI's `cloudflare-setup` (CLI-REQ-001), run as `npm run cloudflare-setup`; the skill runs it on "set up Cloudflare", "continue prototype setup" and "continue setup" and relays its output as is (SKILL-REQ-007). In v0.2.0 (DEC-0697; plan-v0.2.0 §5) its steps are:

0. **Local setup** (`runLocalSetup`, DEC-0591), when not done.
1. **Git** (`git-safety.ts`, DEC-0572): the three warnings, and the `.gitignore` line.
2. **Tokens** (`token-sources.ts`, DEC-0570): each is checked with `/accounts/<id>/tokens/verify` and for its account; the everyday token also gets the quick check, one read per permission (`probeEveryday`, DEC-0565).
3. **The bootstrap**, when a bootstrap token is given (DEC-0680…DEC-0685):
   1. its expiry is read from its own verify call; no expiry, or one more than PAR-435 away, means it is deleted at once and the run stops (DEC-0681);
   2. the admin client and the sign-in client are created, both private and confidential with `response_types ["code","id_token"]` and the required scopes `user-details.read` and `memberships.read`; the admin client also offers the optional scopes the admin app's pages request (DEC-0684);
   3. each client's ID and secret go straight into the account's Secrets Store under PAR-436's names (DEC-0685);
   4. the admin app is deployed (Worker name PAR-438) and bound to its client;
   5. the bootstrap token deletes itself as the last request, and its line is commented out (`commentOutBootstrap`, DEC-0683);
   6. the admin app's URL and "open the admin app and sign in" are printed.

   The bootstrap never reads or changes the everyday token and applies no account setup step (DEC-0682).
4. **No everyday token and no bootstrap token:** the bootstrap link (`deepLink`, DEC-0564), the template (`ENV_CLOUDFLARE_TEMPLATE`) and the next prompt; stop.
5. **The account:** the everyday token's (an account token's owner, or the one `CLOUDFLARE_ACCOUNT_ID` names among a user token's), chosen as SETUP-REQ-003 and SETUP-REQ-006 say.
6. **The setup record** (provisioning.md §2 "Account settings record", DEC-0577), read with the everyday token, and every step's inspection (`checkAccountSetup`, DEC-0578, DEC-0579). Current, and the everyday token meets the list: done. Otherwise the run names what is missing and the admin app's page that does it: Account setup (page 1) or Everyday token (page 2).
7. **Network check** of `api.cloudflare.com`, the account's R2 storage host and its `workers.dev` subdomain, each named by kind and bounded by PAR-360; a blocked one names the hosts to allow (`api.cloudflare.com`, `*.r2.cloudflarestorage.com`, `*.workers.dev`).
8. **Summary:** account name, account setup, everyday token, then the next step, `npm run deploy -- --target cloudflare --stage test-first`.

**The admin app** (plan-v0.2.0 §5.2; item E) does what the bootstrap no longer does. The signed-in admin authorizes their own role's rights through the admin client's optional scopes, page by page. Page 1, Account setup, deploys the auth app with its D1 database, creates the shared resources and writes the setup record. Page 2, Everyday token, creates or updates the everyday token with exactly the everyday set and shows its value once to the human; the agent never sees it. Page 3, Status, is read-only. The skill's setup flow is: run `cloudflare-setup` with the bootstrap token; open the admin app for account setup and the everyday token; the user saves the everyday token; "continue prototype setup" checks that it works.

The everyday token reads the record through R2 and checks with its own permissions that the shared resources exist. A second project on the same account (a copied `.env.cloudflare`) therefore needs no bootstrap token and no admin-app visit.

The implementation is `packages/framework/src/provision/cloudflare/cloudflare-setup.ts`, bound in `src/cli/commands/cloudflare-setup.ts`; its decisions are DEC-0584…DEC-0590 and DEC-0680…DEC-0685. Every token `PUT` or `DELETE` passes a guard, an allow-list (DEC-0589, DEC-0618); in v0.2.0 it refuses every `PUT` and arms the `DELETE` only around the self-delete (DEC-0682, DEC-0683). Every printed line passes a redaction of the run's token values, account ID, zone ID, token IDs and subdomain (DEC-0590). This document states the outcomes the criteria check.

## 3. Uses

PROV (`setup-account`'s steps, the setup record, the per-target operations for removing old-account stages), CLI (the command table, the token sources and the git warnings), CF (the Cloudflare API), SKILL (the trigger phrases).

## 4. Acceptance criteria

In v0.2.0, SETUP-AC-001…SETUP-AC-008 and SETUP-AC-011 are rewritten for the bootstrap and the admin app (DEC-0697); their IDs and Where columns are kept. The automated criteria run against the fake Cloudflare API (`fake-cloud.test-support.ts`), with fake token values only; the output of every run is searched for each fake token value.

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| SETUP-AC-001 | In a new project with no tokens in the environment or `.env.cloudflare`, `cloudflare-setup` prints the bootstrap token's link exactly as `deepLink` builds it (plan-v0.2.0 §5.1's four groups), with the instruction to set an expiry no more than PAR-435 away, the three lines of the template, where they go in a cloud session and on the command line, that the admin app makes the everyday token, and "continue prototype setup". It prints no everyday-token link, no plan requirement and no domain requirement. It writes the template to `.env.cloudflare` when absent, makes no Cloudflare write request and exits 1. | SETUP-REQ-001, SETUP-REQ-003 | Local |
| SETUP-AC-002 | With a valid everyday token, a current setup record (`setupVersion` equal to `ACCOUNT_SETUP_VERSION`, every step's inspection done) and every permission of the list, the command says everything is already set up, asks for nothing, makes no Cloudflare write request, leaves `.env.cloudflare` byte for byte as it was and exits 0. The same holds with the values in the environment only. | SETUP-REQ-001, SETUP-REQ-002 | Local |
| SETUP-AC-003 | For each bad paste (a value that is not a token, a token that is not active, the same token in both settings, the everyday token pasted as the bootstrap token, a user token as the bootstrap token, a token of another account, an everyday token with a permission denied), the output names which setting and what is wrong, and gives only that token's remedy: the bootstrap link for the bootstrap token, the admin app's Everyday token page for the everyday token. The command exits 1, and no token is updated or deleted. | SETUP-REQ-003 | Local |
| SETUP-AC-004 | With the everyday token lacking one permission of the list and no bootstrap token, the command names the missing permission and the admin app's Everyday token page, with the bootstrap link while the admin app is not deployed, changes nothing and exits 1. With a bootstrap token, the everyday token is neither read nor updated and no new token is made. The bootstrap token is deleted (the fake API lists it no more and answers 401 to it), and its line in `.env.cloudflare` reads exactly PAR-342. | SETUP-REQ-004, SETUP-REQ-002 | Local |
| SETUP-AC-005 | With a usable bootstrap token, the command creates the admin and the sign-in OAuth clients (private, confidential, `response_types ["code","id_token"]`, required scopes `user-details.read` and `memberships.read`; the admin client's optional scopes as listed, the sign-in client's none), puts each client's ID and secret into Secrets Store under PAR-436's names, deploys the admin app, prints its URL and "open the admin app and sign in", and deletes the bootstrap token as its last Cloudflare request. It applies no setup step and leaves the setup record as it was. A bootstrap token with no expiry, or with one more than PAR-435 away, is deleted at once, used for nothing else, and the run exits 1 with the bootstrap link; one exactly PAR-435 away runs. When the bootstrap stops before its end, or the self-delete fails, the token's line is kept and the command exits 1 (naming the dashboard when the delete failed). A token whose ID is in PAR-361's setting is neither updated nor deleted. | SETUP-REQ-004 | Local |
| SETUP-AC-006 | With tokens of another account than the project's `CLOUDFLARE_ACCOUNT_ID`, the command says that the old account's stages keep running and how to remove them with the old everyday token, changes nothing and exits 1. Run again with `--switch-account` and a bootstrap token for the new account, it runs the bootstrap there (its bootstrap token deleted) and writes the new `CLOUDFLARE_ACCOUNT_ID` into `.env.cloudflare` (or, when the value comes from the environment, says to change it there); no request is sent to the old account. | SETUP-REQ-006 | Local |
| SETUP-AC-007 | A second project given a copy of the first project's `.env.cloudflare` (after a successful setup: account filled in, the bootstrap line commented out) completes with no bootstrap token and no Cloudflare write request. | SETUP-REQ-001, SETUP-REQ-002 | Local |
| SETUP-AC-008 | Each of these stops exits 1 and prints its link or command: two accounts visible and `CLOUDFLARE_ACCOUNT_ID` unset (the accounts by name, no ID); a network host blocked (named by kind, with the hosts to allow in a cloud environment's network access settings). On Workers Free, and with no `CLOUDFLARE_EMAIL_DOMAIN` and no zone, the command does not stop for the plan or the domain. | SETUP-REQ-001, SETUP-REQ-003 | Local |
| SETUP-AC-009 | In a project whose local setup is missing, the command runs it first (dependencies, local secrets, the `.gitignore` line). Outside a git repository, with `.env.cloudflare` not ignored, and with it tracked, each run prints the matching warning set off from the rest of the output, and the exit status is the same as without the condition; the `.gitignore` line is added unless PAR-343's marker is present. | SETUP-REQ-001, SETUP-REQ-005 | Local |
| SETUP-AC-010 | Across every run of SETUP-AC-001 to SETUP-AC-009, no output (standard output, standard error, or a file the command writes other than `.env.cloudflare`) contains any fake token value, account ID, zone ID, token ID or `workers.dev` subdomain. | SETUP-REQ-007 | Local |
| SETUP-AC-011 | On a real account, with a dashboard-made bootstrap token the owner supplied for the run, with an expiry no more than PAR-435 away: the bootstrap creates both OAuth clients with their secrets in Secrets Store, deploys the admin app, prints its URL, and the bootstrap token deletes itself (401 afterwards). After the owner does account setup and makes the everyday token in the admin app, a run with no bootstrap token needs nothing. A pasted non-token value gets the bad-paste message, and a bootstrap token with a longer expiry is deleted at once. When the run's bootstrap token is instead a protected stand-in (the account's existing dashboard token, which the owner's rule forbids changing or deleting), the run sends no DELETE for it, says it is protected and was not deleted, and otherwise finishes as it would; the self-delete clause is then covered by SETUP-AC-004 and SETUP-AC-005 against the fake API. | SETUP-REQ-001, SETUP-REQ-003, SETUP-REQ-004 | Cloud (milestone) |

## 5. Portability note

The command is Cloudflare's only: its tokens, links, plan check and setup steps are Cloudflare's. A new target would get its own setup command; the local setup (step 0), the git warnings and the no-value rule are target-neutral and would be shared.
