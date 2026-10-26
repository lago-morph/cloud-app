# SETUP — Cloudflare setup

The one re-runnable command that takes a project from no Cloudflare account access to a set-up account: `cloudflare-setup` (plan-setup-wizard §3–§4, owner decisions of 2026-10-26). It reads the current state each run and does only what is missing, so the same command serves a new project, a project with a lot of local work, an account switch, a bad paste, and a framework release that needs more Cloudflare permissions. It drives PROV's account setup (`setup-account`, PROV-REQ-004) with the bootstrap token; every other command uses the everyday token.

Contracts: none app-facing. The token permission lists are `packages/framework/src/provision/cloudflare/permissions.ts` (PAR-331, PAR-332, DEC-0563); the settings file is PAR-340.

## 1. Requirements

#### SETUP-REQ-001 — One re-runnable command
Origin: owner · Derives from: SYS-REQ-022, SYS-REQ-023 · Decision: DEC-0563, DEC-0577, DEC-0578, DEC-0591

`cloudflare-setup` MUST read the current state and then do only what is missing, in this order: the project's local setup when it has not been done (dependencies, local secrets, `.env.cloudflare` in `.gitignore`); the git checks (SETUP-REQ-005); both tokens; the account and its plan; the email domain; the account setup record; with the bootstrap token, the missing setup steps, the everyday token's permissions and the bootstrap token's self-deletion; the network check; a summary with the next step (a `deploy` of a `test-` stage). On a project whose tokens are valid and whose account setup is current it MUST change nothing and ask for nothing. `setup-account` stays as the account-setup step it calls, for scripts and advanced users.

#### SETUP-REQ-002 — Tokens from the environment, then `.env.cloudflare`
Origin: owner · Derives from: SYS-REQ-023 · Decision: DEC-0570, DEC-0571, DEC-0574

The command, like every Cloudflare command, MUST take `CLOUDFLARE_BOOTSTRAP_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_EMAIL_DOMAIN` and `CLOUDFLARE_ACCOUNT_ID` from the environment first, then from `.env.cloudflare` in the project root (PAR-340), and say which source it uses when both hold different values. Valid tokens already in the environment MUST be used without any prompt. The framework CLI alone writes the file, leaving it at PAR-341 after every write. On success it MUST fill in an empty `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_DOMAIN` (never changing a set value), so a copy of the file starts another project on the same account, and replace the bootstrap token's line with PAR-342 once the token is deleted.

#### SETUP-REQ-003 — Each stop says exactly what to do
Origin: owner · Derives from: SYS-REQ-023, SYS-REQ-029

Every message that needs the user to act MUST include the exact link or command. In particular:
- no everyday token: the plan and domain requirements (Workers Paid; a domain on Cloudflare DNS), both tokens' pre-filled dashboard links with what to choose on each page, the four-line template of `.env.cloudflare`, where it goes (a cloud session's environment settings, then a new session; on the command line the environment or `.env.cloudflare`), and the next prompt "continue prototype setup";
- a bad token (not a token, invalid, another account, another zone, or missing a permission it cannot be given): which token and what is wrong, with only that token's link;
- several accounts visible and `CLOUDFLARE_ACCOUNT_ID` unset: the accounts, and a request to choose;
- a plan other than Workers Paid: that Better Auth needs it; the command stops before any change;
- no email domain: the zones the everyday token sees, to pick one, or, with none, that a domain is needed;
- the bootstrap token needed and absent: only the bootstrap link and the next prompt;
- a blocked network host (`api.cloudflare.com`, R2's storage host or the account's `workers.dev` subdomain): the host, and where to change the cloud environment's network policy.

#### SETUP-REQ-004 — The bootstrap token: used once, then deleted
Origin: owner · Derives from: SYS-REQ-023 · Decision: DEC-0563, DEC-0565, DEC-0577

When the account setup record is missing or older than the release's `ACCOUNT_SETUP_VERSION`, or the everyday token lacks a permission of the release's list, the command MUST need the bootstrap token. With it, it MUST run only the missing setup steps, write the setup record, read the everyday token's permissions and zone exactly once and compare them with the list, add any missing permission to the existing everyday token in place (its value unchanged), and then make the bootstrap token delete itself. An everyday token scoped to the wrong account or zone MUST be explained, with the everyday link to make a new one. A bootstrap token without an expiry MUST be warned about. When the setup is already current and a bootstrap token is still valid, that token MUST be deleted the same way.

#### SETUP-REQ-005 — Git safety warns and never blocks
Origin: owner · Derives from: SYS-REQ-015 · Decision: DEC-0572, DEC-0598

Every run MUST print a prominent warning when the project is not a git repository, when `.env.cloudflare` is not ignored, and when it is tracked; the tracked warning MUST say that the tokens are in the history and how to replace them. The command MUST add `.env.cloudflare` to `.gitignore` unless it is already ignored or `.gitignore` holds PAR-343's marker. None of these conditions may stop the command or change its exit status.

#### SETUP-REQ-006 — Account switch
Origin: owner · Derives from: SYS-REQ-023, SYS-REQ-024

When the tokens' account differs from the project's recorded account (`CLOUDFLARE_ACCOUNT_ID`), the command MUST explain that stages on the old account keep running and offer to remove them while the old token still works, then set up the new account as needed and update `CLOUDFLARE_ACCOUNT_ID`. It MUST NOT change anything on the old account unless the user accepts the removal.

#### SETUP-REQ-007 — No token value is printed
Origin: owner · Derives from: SYS-REQ-015 · Decision: DEC-0573, DEC-0599

No output of the command may contain a token value. It reports only pass or fail, permission names and HTTP status codes.

## 2. Design

The command is the framework CLI's `cloudflare-setup` (CLI-REQ-001), run as `npm run cloudflare-setup`; the skill runs it on "set up Cloudflare", "continue prototype setup" and "continue setup" and relays its output as is (SKILL-REQ-007). Its steps are plan-setup-wizard §4.3:

0. **Local setup** (`runLocalSetup`, DEC-0591), when not done.
1. **Git** (`git-safety.ts`, DEC-0572): the three warnings, and the `.gitignore` line.
2. **Tokens** (`token-sources.ts`, DEC-0570): each is checked with `/accounts/<id>/tokens/verify` and for its account; the everyday token also gets the quick check, one read per permission (`probeEveryday`, DEC-0565).
3. **No everyday token:** the links (`deepLink`, DEC-0564), template (`ENV_CLOUDFLARE_TEMPLATE`) and next prompt; stop.
4. **The account:** chosen as SETUP-REQ-003 and SETUP-REQ-006 say; the plan is read with the bootstrap token's "Billing Read" (`GET /accounts/<id>/subscriptions`).
5. **The email domain:** `CLOUDFLARE_EMAIL_DOMAIN`, else a pick from the zones the everyday token sees.
6. **The setup record** (provisioning.md §2 "Account settings record", DEC-0577), read with the everyday token, and every step's inspection (`checkAccountSetup`, DEC-0578, DEC-0579). Current, and the everyday token meets the list: done. Otherwise the bootstrap token is needed.
7. **With the bootstrap token:** `applySetupSteps` for the missing steps and the record; one comparison of the everyday token's policies (`comparePolicies`); the in-place update (`inPlaceUpdateBody`, `PUT /accounts/<a>/tokens/<id>`, which keeps the value); the bootstrap token's `DELETE` of itself and the comment-out (`commentOutBootstrap`); in a cloud session, a note that the environment variable can now be removed.
8. **Network check** of the three hosts.
9. **Summary.**

The everyday token reads the record through R2 and checks with its own permissions that the buckets, the signing record, email sending and the test mailbox's routing rule exist. A second project on the same account (a copied `.env.cloudflare`) therefore needs no bootstrap token. A future release that needs a permission an existing bootstrap token lacks asks for a new one from the new link; the everyday token is still upgraded in place.

The state machine's implementation records its own decisions in the decision log; this document states the outcomes the criteria check.

## 3. Uses

PROV (`setup-account`'s steps, the setup record, the per-target operations for removing old-account stages), CLI (the command table, the token sources and the git warnings), CF (the Cloudflare API), SKILL (the trigger phrases).

## 4. Acceptance criteria

The automated criteria run against the fake Cloudflare API (`fake-cloud.test-support.ts`), with fake token values only; the output of every run is searched for each fake token value.

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| SETUP-AC-001 | In a new project with no tokens in the environment or `.env.cloudflare`, `cloudflare-setup` prints both tokens' links exactly as `deepLink` builds them, the four lines of the template, where they go in a cloud session and on the command line, the plan and domain requirements, and "continue prototype setup"; it makes no Cloudflare write request. | SETUP-REQ-001, SETUP-REQ-003 | Local |
| SETUP-AC-002 | With a valid everyday token, a current setup record (`setupVersion` equal to `ACCOUNT_SETUP_VERSION`, the same email domain, every step's inspection done) and every permission of the list, the command says everything is set up, asks for nothing, makes no Cloudflare write request and leaves `.env.cloudflare` byte for byte as it was. The same holds with the values in the environment only. | SETUP-REQ-001, SETUP-REQ-002 | Local |
| SETUP-AC-003 | For each bad paste (a value that is not a token, a token that fails `verify`, a token of another account, an everyday token scoped to another zone), the output names which token and what is wrong, and contains that token's link and not the other token's. | SETUP-REQ-003 | Local |
| SETUP-AC-004 | With the everyday token lacking one permission of the list and no bootstrap token, the command prints only the bootstrap link and the next prompt and changes nothing. With the bootstrap token, it updates the everyday token in place: afterwards the same value passes the quick check for the missing permission, and the token keeps its other policies. Then the bootstrap token is deleted (the fake API lists it no more and answers 401 to it) and its line in `.env.cloudflare` reads exactly PAR-342. | SETUP-REQ-004, SETUP-REQ-002 | Local |
| SETUP-AC-005 | With a setup record older than `ACCOUNT_SETUP_VERSION`, or one step missing, and the bootstrap token present, the command applies only the missing steps (no create request for a step found done), writes the record with the release's `ACCOUNT_SETUP_VERSION`, and deletes the bootstrap token. A run with a current setup and a still-valid bootstrap token deletes that token and changes nothing else. A bootstrap token without an expiry is warned about. | SETUP-REQ-004 | Local |
| SETUP-AC-006 | With tokens of another account than the project's `CLOUDFLARE_ACCOUNT_ID`, the command says that the old account's stages keep running and offers to remove them; declining leaves the old account unchanged (no request to it but reads). It then sets up the new account as needed and writes the new `CLOUDFLARE_ACCOUNT_ID`. | SETUP-REQ-006 | Local |
| SETUP-AC-007 | A second project given a copy of the first project's `.env.cloudflare` (after a successful setup: account and email domain filled in, the bootstrap line commented out) completes with no bootstrap token and no Cloudflare write request. | SETUP-REQ-001, SETUP-REQ-002 | Local |
| SETUP-AC-008 | With two accounts visible and `CLOUDFLARE_ACCOUNT_ID` unset, the command lists them and asks; with a plan other than Workers Paid, it says Better Auth needs it and stops before any write; with no `CLOUDFLARE_EMAIL_DOMAIN` it lists the visible zones, and with none it says a domain is needed; with a network host blocked, it names the host and where to change the cloud environment's network policy. | SETUP-REQ-003 | Local |
| SETUP-AC-009 | In a project whose local setup is missing, the command runs it first (dependencies, local secrets, the `.gitignore` line). Outside a git repository, with `.env.cloudflare` not ignored, and with it tracked, each run prints the matching warning set off from the rest of the output, and the exit status is the same as without the condition; the `.gitignore` line is added unless PAR-343's marker is present. | SETUP-REQ-001, SETUP-REQ-005 | Local |
| SETUP-AC-010 | Across every run of SETUP-AC-001 to SETUP-AC-009, no output (standard output, standard error, or a file the command writes other than `.env.cloudflare`) contains any fake token value. | SETUP-REQ-007 | Local |
| SETUP-AC-011 | On a real account, with a dashboard-made bootstrap token the owner supplied for the run and an everyday token the harness made for it (never the owner's, DEC-0604): a fresh setup completes; a second run needs nothing; after the harness removes one permission from that everyday token, a run with a new bootstrap token restores it with the token's value unchanged; the bootstrap token deletes itself (401 afterwards); and a pasted non-token value gets the bad-paste message. | SETUP-REQ-001, SETUP-REQ-003, SETUP-REQ-004 | Cloud (milestone) |

## 5. Portability note

The command is Cloudflare's only: its tokens, links, plan check and setup steps are Cloudflare's. A new target would get its own setup command; the local setup (step 0), the git warnings and the no-value rule are target-neutral and would be shared.
