# Live pass — v0.2.0 runbook

The once-per-release live pass (plan `plan-v0.2.0-testing-auth.md` §7 "Live") of the published release candidate **`0.2.0-rc01`** (npm dist-tag `next`), in a brand-new, empty **test Cloudflare account** that is set up for the first time during the pass. It also settles the points the v0.2.0 run left *unverified* (section 4).

**Two accounts, two logins.** In this runbook, and in every prompt of the runner:
- the **primary Cloudflare account** is the Cloudflare account the owner already has (the one this sandbox's own token belongs to). The login that owns it is the **primary account login**. During the pass the runner invites the primary account login into the test Cloudflare account with the role "HTTP Applications Read"; nothing in the primary Cloudflare account changes.
- the **test Cloudflare account** is the new free account made for the pass. The **test account login** is the new login, made with a new email, whose sign-up created the test Cloudflare account. It is the Super Administrator there: it makes the tokens and runs the admin app's pages.

Each login works in its own browser profile: "the test account login's browser profile" and "the primary account login's browser profile". Every prompt starts by naming which one it is for.

**Who does what (owner decision DEC-0793).** The owner makes the test Cloudflare account and one token, then starts one Claude session and pastes one message. The agent runs the runner, `scripts/live-pass/live-pass.mjs`, which does everything that needs no human Cloudflare login, by API: it invites the primary account login, changes that login's role and back, makes its own probe tokens, replaces the everyday token's value so nobody copies it, passes each token only to the command that needs it, waits on its own, and records everything. Whenever a human step is needed, the agent gives **one link**, names the login whose browser profile it is for, says in one to three sentences what to do there and what should be seen, and names the exact reply. Nobody describes what happened: after the run an analyst works it out from the records alone (`ai/implementation/live-pass-analysis.md`).

**Time:** about 10 minutes before the session; then about 2 hours in one session, with 17 short human steps.

---

## 1. For the owner

### Before the session

1. **Make the test Cloudflare account.** Open a new browser profile (or another browser), so that the usual profile stays signed in as the primary account login. In the new profile, sign up with a **new email address** (the Free plan is enough). This creates the test account login and the test Cloudflare account, and the new profile is the test account login's browser profile:
   `https://dash.cloudflare.com/sign-up`
2. **Turn on R2** in the test Cloudflare account, in the test account login's browser profile (no API can do it):
   `https://dash.cloudflare.com/?to=/:account/r2/overview`
   Press the button that enables R2 (Cloudflare may ask for a payment method; the pass stays within the free allowances). Create no bucket.
3. **Make the one token, `live-pass-owner`,** in the test account login's browser profile, from this pre-filled link:
   ```
   https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%225bc3f8b21c554832afc660159ab75fa4%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%221af1fa2adc104452b74a9a3364202f20%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%2209b2857d1c31407795e75e3fed8617a1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%2250fc2f43318f40e4855a35d8de5bf643%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22adc8fa2bc6124928a8b3314dc63a1235%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%2282c075da3f4647a2a03becd0fe240f8a%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22bf7481a1826f439697cb59a20b22293e%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22e086da7e2179491d91ee5f35b3ca210a%22%2C%22type%22%3A%22edit%22%7D%5D&name=live-pass-owner
   ```
   The link fills in the token's name and all eight permissions. Set only the end date, **a week from today** (the one thing the link cannot fill in), then press "Continue to summary", then "Create Token", and copy the value.
4. **Copy the test Cloudflare account's ID**: the address bar shows it, `dash.cloudflare.com/<account ID>/…`.

### The session

Start **one** Claude cloud session on this repository's `main` branch, in an environment that can reach `api.cloudflare.com`, `dash.cloudflare.com`, `*.workers.dev` and `registry.npmjs.org`. Paste this message, with the three values filled in (pasting the token here is fine: it is for the empty test Cloudflare account only, and is deleted at the end):

```
Run the v0.2.0 live pass. Read only the section "For the agent in the session" of ai/implementation/live-pass-v0.2.0.md and follow it exactly. In this live-pass session you, the main agent, run the runner's commands yourself and relay its owner prompts to me live, word for word: this is an exception to the orchestrator rule in CLAUDE.md, for the live-pass sessions only (owner decisions DEC-0789 and DEC-0793).
Test Cloudflare account ID: <the ID>
Token live-pass-owner: <the value>
Primary account login's email: <the email>
```

From then on **the agent gives a link each time** a human step is needed. Each prompt first names the login whose browser profile it is for, then gives the link, says what to do there and what should be seen, and names the reply: `ok`, a word such as `user`, `admin`, `updated` or `new`, or a pasted value. If what shows differs, say so in a few words instead. Twice it asks for a **starter token**, made in the test account login's browser profile from a link, and its value pasted (Cloudflare lets only a token made in the dashboard hold "Account API Tokens Edit", so the runner cannot make these); for the second one (S5's) you may reply `skip`. The runner works on its own in between, for up to 20 minutes during the deploys.

At the end the agent says **"THE LIVE PASS IS FINISHED"** and prints the records' R2 bucket and prefix. To have the run analysed and the test Cloudflare account cleaned up, start an analysis session (section 3) and give it those lines, the test Cloudflare account's ID and the **same token** `live-pass-owner`. No new token is needed.

### If something goes wrong

- **The agent says BLOCKED:** a step the rest depends on failed; the message says what to do. When it is fixed, the agent runs `retry`; if you decide to go on without the step, tell the agent and it runs `skip <step> "<your reason>"`.
- **The session or its container ended** in the middle: start a new session and paste the same message, with `resume` instead of `start` (the agent knows). The runner continues where it stopped and asks a waiting question again. A starter token pasted in the lost container is asked for again, with its link; if the everyday token's value was lost and the runner cannot replace it, the test account login gets a link to roll it in the dashboard.
- **The admin app asks the test account login to sign in again** (its session lasts 15 minutes): sign in, then repeat the page.
- **You replied something wrong:** tell the agent; it records your correction (`note`).

---

## 2. What the runner does, and which login is needed when

All in one session, in this order.

| Step | The runner, by API | The human step, from one link |
|---|---|---|
| P1, P2 | checks tools, network, the token's eight permissions and that the test Cloudflare account is empty; makes the app `livepass` from `npm create @lago-morph/prototype-app@0.2.0-rc01` | — |
| P3 | invites the primary account login's email with the role "HTTP Applications Read" | primary account login: accepts the invitation from its email |
| S2 | runs the setup with a value that is not a token | — |
| TOK-S4, C-1, S4 | checks the starter token's expiry and groups, then runs the bootstrap | test account login: makes the starter token from a link that fills in its name and four permissions (only the end date, tomorrow, is set by hand); its value is pasted |
| TOK-S5, S5 | runs the bootstrap again | test account login: makes a second starter token, or `skip` |
| S6 | reads the admin app's log | test account login: signs in to the admin app; primary account login: is refused |
| S7, E-1, S8, S10 | checks what each page made; after S8 **rolls the everyday token's value** (`PUT …/tokens/<id>/value`) and keeps the new value | test account login: runs Account setup, Everyday token with Secrets Store unticked, Everyday token, Status |
| CP, R1, R2, S9, U3, S11, S12 | collects the logs; checks the everyday token; runs "continue prototype setup"; probes U3; deploys `test-live` and `prodcheck` | — |
| S13 | checks the auth app's records and the uploaded file | test account login: logs in to the app and uploads an image; primary account login: logs in |
| S14 | **changes the primary account login's role** to Administrator, later **sets it back** (also if S14 fails or is skipped partway) | primary account login: logs out and in twice |
| S15, S16 | — | test account login: logs out of the app and the admin app, then opens Status again |
| S17, FIN | removes both stages, collects every log, uploads the records to R2 | — |

Every token value stays in a mode-600 directory outside the repository and reaches only the command that needs it: a starter token only the setup command of S2, S4 or S5, the everyday token only the part-2 framework commands. The sandbox's own Cloudflare variables (the primary Cloudflare account's) never reach a command.

## 3. After the run: analysis and cleanup

An agent in a new session follows `ai/implementation/live-pass-analysis.md`, with the records' bucket and prefix, the test Cloudflare account's ID and the token `live-pass-owner`. It reads the records, records its findings, then deletes everything the run made, removes the primary account login from the test Cloudflare account, and last deletes the token itself.

## 4. What the run checks

Every step records expected against observed; IDs are kept from the previous runbook. Results go to `results.md` in the records. Human steps are marked (browser); section 2 says which login does each.

| ID | What is expected |
|---|---|
| P1 | Tools and network; `live-pass-owner` holds its eight groups (Workers Observability optional); the test Cloudflare account empty. |
| P2 | `npm create @lago-morph/prototype-app@0.2.0-rc01` makes the app `livepass`; the installed framework is that version; a committed `config/cloudflare/prodcheck.json`. |
| P3 (browser) | The runner's invitation is sent; the test account login (Super Administrator) and the primary account login (no administrator role) are accepted members. |
| S2 | A non-token value in `CLOUDFLARE_BOOTSTRAP_TOKEN`: names the setting and the link, exit 1, nothing created. |
| TOK-S4, TOK-S5 (browser) | Each pasted starter token is an active account token (TOK-S5 may be skipped: S5 is then n/a). |
| C-1 | What the TTL picker set: the starter token has at most 24 h left (PAR-435) and holds exactly its four groups. |
| S4 | Bootstrap: both OAuth clients created, Secrets Store `prototype-framework` with four entries, Worker `prototype-admin`, the token deleted itself, exit 0, no token value in the output; C-2, C-3, C-4, E-2. |
| S5 | Re-run: "already exist", both client IDs kept, the admin app redeployed, the token deleted itself. |
| S6 (browser) | The test account login admitted, the primary account login refused with 403; the admin app logs "admin signed in". |
| S7 (browser) | Page 1: Worker and D1 `prototype-auth`, buckets `prototype-logs`, `sst-state`, `prototype-backups` with its lifecycle rule, setup record version 2; E-8 (release-blocking: the signing token is made), E-9 and F-3, F-6. |
| E-1 (browser) | Page 2 with Secrets Store unticked: nothing was done; no token made. |
| S8 (browser) | Page 2: one `prototype-framework` token with exactly the four everyday groups, on the test Cloudflare account only (U2); the runner rolls its value and the new value verifies as the same token (or the owner pastes the value if the roll is refused). |
| S10 (browser) | Page 3 before sign-ins: no app registered, no sign-in. |
| CP | Logs, records and a snapshot collected; the checkpoint stored; part 2 begins in the same session. |
| R1, R2 | The everyday token's value verifies as page 2's token; every starter token is gone; the app is there. |
| S9 | "continue prototype setup" with the everyday token: no email-domain question, account setup current, exit 0; U2; A-1 part a (the role names, read across every page of the role list); A-2 (the issuer). |
| U3 | A token without Secrets Store Read uploads a Worker binding a store secret, or not (recorded); F-7. |
| S11 | Test stage `test-live`: deploys, health 200, mock login gives level `user`. |
| S12 | Production stage `prodcheck`: no email-domain stop, exit 0; F-1; F-4; `/start` 302 for the registered return, 400 for a foreign one; no mock login; F-5 n/a. |
| S13 (browser) | The auth app records the test account login as `admin` and the primary account login as `user`; F-8 (an uploaded object in the stage's bucket). |
| S14 (browser) | The runner sets the primary account login's role to Administrator; after signing out and in, `admin` (A-1 part b, DEC-0703); the runner sets the role back, and the next sign-in gives `user`. The role is set back even if S14 fails or is skipped partway. There is no wait for the role-refresh interval (owner decision on PR #171, option B): that a re-check does not pick up a role change is covered locally by E2E-007, and a configurable re-check interval goes to the 0.2.0 cleanup. |
| S15 (browser) | Signed out of the app and the admin app. |
| S16 (browser) | Page 3: the registered app and both sign-ins (E-4). |
| S17 | Both stages removed (production after its backup); `/start` 400 and no registry row; no stage resource left; the shared resources kept. |
| FIN | All logs and records uploaded; the bucket and prefix printed; `live-pass-owner` covers the analysis and the cleanup. |

Recorded throughout, without any human step: every command with its arguments, exit code, timing and output (secrets scrubbed); an API snapshot of the test Cloudflare account after every step; every API call's method, path and status; the Workers logs of the admin app, the auth app and the stages (the runner turns on Workers Logs for every Worker, DEC-0789); the shared log bucket; the auth app's records of who signed in with which role.

**Verified live on 2026-11-08**, on the primary Cloudflare account with temporary tokens only (each deleted afterwards; nothing else was created there):
- `GET …/tokens/permission_groups` lists every group above, with the IDs the link uses (Account Settings Write `1af1fa2a…`, Workers Observability Write `82c075da…`).
- An API-made token cannot hold "Account API Tokens Write": creating one, or adding the group to one in place, is refused with code 1001, "sub-token is not allowed to have permissions to manage other tokens". So the runner cannot make the starter tokens; the test account login makes them in the dashboard.
- An API-made token can hold every other group the runner needs: one with Account Settings Write, D1, OAuth Client, Secrets Store, Workers Observability, Workers R2 Storage and Workers Scripts (all Write) was made, verified, listed members (Write covers Read), roles, OAuth clients and stores, and ran a Workers Observability query.
- The roll: `PUT /accounts/<a>/tokens/<id>/value` with an account token holding Account API Tokens Write returned a new value; the old value then failed to verify (code 1000), the new one verified with the same ID, and the token kept its name, groups and expiry. Updating a token's expiry in place (`PUT …/tokens/<id>`) kept its value working.
- Members: with Account Settings Read, `PUT …/members/<id>` and `POST …/members` are refused (10000); with Account Settings Write, `PUT` of an unknown member answers 1003 "Member not found for account" and `POST` without an email answers 1001 "Value required for parameter 'email'", so both accept an account token with that group.
- The role list has 184 roles on 4 pages of 50; "Administrator" (on page 4), "Super Administrator - All Privileges" and "HTTP Applications Read" exist. The previous runner read only the first page in S9; it now reads every page.

**Not verified** (the pass itself shows them): that R2 cannot be enabled by API, and whether a new free account needs a payment method for it; the R2 overview link above; that the dashboard pre-fills Account Settings and Workers Observability from their IDs (DEC-0563's check covered the other six), and that the starter-token link in the form `dash.cloudflare.com/<account ID>/api-tokens?permissionGroupKeys=…&name=…` pre-fills as the `?to=/:account/api-tokens` form does; an invitation actually sent to and accepted by a real email, and a role change of a real member (the request bodies `{"email","roles":[<id>]}` and `{"roles":[{"id"}]}` follow Cloudflare's API reference); rolling a token that an OAuth grant made (the everyday token) rather than one an API token made; and whether a dashboard-made token holding only Account API Tokens Write could make the runner's other tokens, which the pass does not rely on.

Already confirmed, so not an open point of this pass: a token holding only Secrets Store Read lists the stores and a store's secrets and is refused writes (DEC-0788). Not in this pass (owner decisions on PR #171): U1, whether the admin app's grant updates an everyday token it did not create (the name matching it probed is being redesigned in the 0.2.0 cleanup), and E-10, the "Clean up v0.1.x email" page (the owner has no v0.1.x installs). Not checked: S1, a starter token with no expiry being deleted at once, is dropped from this pass (owner decision on PR #171), so no such token is ever asked for; the rule itself is being removed in the 0.2.0 cleanup. Also not checked: F-5 (needs a 0.1.x stage) and the removal of a member at the next sign-in (E2E-007 step 4 covers it locally).

## 5. Cost and cleanup

**Made by the pass and kept for the analyst:** OAuth clients `prototype-framework-admin` and `prototype-framework-sign-in`; Workers `prototype-admin` and `prototype-auth`; D1 `prototype-auth`; R2 buckets `prototype-logs`, `sst-state`, `prototype-backups` (with the `prodcheck` backup) and `live-pass-records`; Secrets Store `prototype-framework` with six entries; API tokens `prototype-framework`, `prototype-r2-signing` and `live-pass-owner`; the primary account login's membership in the test Cloudflare account. All within the Free plan's allowances at this scale.

**Removed by the pass itself:** the starter tokens (they delete themselves), both stages (S17), the probe Worker and token of U3.

**Cleanup** is the analyst's, with `live-pass-owner`, after the records are read (`live-pass-analysis.md` §4). What remains in the test Cloudflare account afterwards: the test account login (its Super Administrator), its `workers.dev` subdomain and Workers Logs history, which expire on their own.

---

## For the agent in the session

You run the live pass's runner for the owner. Read only this section.

**Exception to `CLAUDE.md` (owner decisions DEC-0789 and DEC-0793).** In the live-pass session only, you, the session's main agent, run `scripts/live-pass/` yourself and relay its prompts to the owner live. This overrides the orchestrator rule in `CLAUDE.md` (the main agent runs nothing and delegates) for this purpose only: do not spawn subagents for the runner, and do nothing else that the rule forbids.

1. **Save the owner's first message, then start.** The message holds the test Cloudflare account's ID, the token `live-pass-owner` and the primary account login's email. With your file-writing tool (never a shell command that holds the value), write the ID as the only content of `~/.live-pass-secrets/CLOUDFLARE_ACCOUNT_ID` and the token as the only content of `~/.live-pass-secrets/LIVE_PASS_OWNER_TOKEN`. Then run `chmod 700 ~/.live-pass-secrets && chmod 600 ~/.live-pass-secrets/*`, and start with `node scripts/live-pass/live-pass.mjs start --primary-login <the email>` (after an interruption: save the same two files, then run `node scripts/live-pass/live-pass.mjs resume`). The runner reads nothing from this sandbox's own `CLOUDFLARE_*` variables: they belong to the primary Cloudflare account.
2. **Run the runner's commands yourself**, from the repository root, with the Bash tool's timeout at its maximum (600000 ms). They are the pass's procedure, not a test suite: run them directly, do not delegate them, and change no file in the repository.
3. **Act on the exit code:**
   - **10**: an owner step. Relay the runner's prompt (the text between `=== OWNER STEP … ===` and the line that starts "When the owner replies") to the owner **word for word**, and wait for the reply. Then do what that line says: usually `node scripts/live-pass/live-pass.mjs answer "<the reply, word for word>"`. When it asks for a pasted value, write the value the owner pasted, and nothing else, with your file-writing tool to the file it names (if that file already exists, delete it first with `rm`, so that you never read it), run the `chmod 600` it names, then run `answer saved`; if the owner replied `skip`, run `answer skip`.
   - **11**: the runner's time budget is used. Run `node scripts/live-pass/live-pass.mjs next`.
   - **1**: BLOCKED. Relay the message to the owner word for word. On their decision run `retry`, or `skip <step> "<their reason>"`. Never skip on your own.
   - **3**: the secrets directory is not as step 1 says. Fix what the message names (a missing file, a file others can read) from the owner's message, or ask the owner for the value it names; then run the same command again.
   - **0**: "THE LIVE PASS IS FINISHED". Relay the closing text to the owner word for word, then run `rm -rf ~/.live-pass-secrets` and stop.
   - Any other exit, or the Bash tool timed out: run `node scripts/live-pass/live-pass.mjs next` once; if it fails again, relay the output and stop.
4. If the owner corrects an earlier reply or tells you something the records should hold, run `node scripts/live-pass/live-pass.mjs note "<their words>"`.
5. **Never print, echo, log or commit a token's value**, and never put one in a command (`answer`, `note`, `echo`, `cat`, `env`, `printenv`, `set`). Do not read the secrets directory's files back. The owner may paste tokens for the test Cloudflare account into this chat (DEC-0793); a value of any other account is exposed, so tell the owner to make a new one.
6. Do not diagnose or fix anything during the pass. The runner records everything for the analyst.
7. `node scripts/live-pass/live-pass.mjs status` prints where the run is, at any time.
