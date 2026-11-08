# Live pass — v0.2.0 runbook

The once-per-release live pass (plan `plan-v0.2.0-testing-auth.md` §7 "Live") of the published release candidate **`0.2.0-rc01`** (npm dist-tag `next`), in a **brand-new, empty Cloudflare account** that is set up for the first time during the pass. It also settles the points the v0.2.0 run left *unverified* (section 6).

**What you do, and what the agent does.** The pass runs in two Claude cloud sessions. In each, the agent runs the runner, `scripts/live-pass/live-pass.mjs`, which runs every command itself and records everything. You do only what needs a browser: making tokens in the dashboard, signing in and approving at Cloudflare, changing a member's role, and the second Cloudflare user ("the tester") in another browser profile. After each browser step the agent asks you for one short reply, usually `ok`. You never describe what happened: the runner records it, and after the run an analyst works it out from the records alone (`ai/implementation/live-pass-analysis.md`).

**Time:** about 20 minutes of preparation, then about 60 minutes per session.

**The owner's answers (2026-11-02, DEC-0789).**
- **(a)** In the live-pass sessions only, the session's main agent runs `scripts/live-pass/` itself and relays its prompts to you live. This is an exception to the orchestrator rule in `CLAUDE.md` (the main agent otherwise runs nothing and delegates); the session prompts below and "For the agent in the session" say so.
- **(b)** The optional starter tokens for S1 and S5 (1.4.3 and 1.4.4) stay.
- **(c)** R2 is enabled before session 1 (1.2), and the runner may turn on Workers Logs for every Worker in the test account.

**Rules.**
- **Never paste a token value into a chat**, a file, a commit or this runbook. Token values go only into the cloud environment's settings (environment variables), and the last one only to the analyst.
- A cloud session sees environment variables only as they were when it started. A change takes effect in the **next new session**.
- The runner may create, change and delete anything in the test account. Use an account that holds nothing else.

What changed since the previous version of this runbook (written before PRs #161, #163 and #164): the pass uses the published release candidate instead of a checkout; the runner executes the commands; the blockers it listed (staged workflows, 34a, 57z) are done; the email-binding checks are gone (no email binding was ever used); the first production deploy must show no email-domain stop and must register with the auth app; sessions last 12 hours (PAR-250, DEC-0791) and a role change takes effect at the next sign-in (DEC-0703), which changes S14; U1 now uses a stand-in token the runner makes; C-3's store-create is now checkable (the account is empty); F-5 is n/a (no 0.1.x stage).

## 1. Before you start (once, in the browser)

The pass needs **one** new Cloudflare account and **two different Cloudflare logins (users)** on it: a new login, which owns the account (1.1), and the tester (1.3).

1. **The test account.** Sign up at Cloudflare with a **new email address** (the Free plan is enough). That makes a new login and its own new account; this new login is the owner (Super Administrator) for the pass, and "you" in this runbook. Do not make the test account from the login that will be the tester. Copy the **account ID**: dashboard → the account's home page → Account ID (or from the address bar, `dash.cloudflare.com/<account ID>/…`).
2. **Turn on R2, before session 1.** Dashboard → R2 Object Storage → enable it (Cloudflare may ask for a payment method; this pass stays within the free allowances). Create no bucket: the runner and the framework create their own.
3. **The tester.** This can be your **existing main Cloudflare login**. Signed in as the new login, invite the main login's email address to the test account (Manage Account → Members → Invite, role **"HTTP Applications Read"**), now or when the agent asks (step P3). Then open a second browser profile (or a private window), sign in to Cloudflare there with the main login, and accept the invitation.
   - This only makes the main login a member of the test account; nothing in your main account changes.
   - S14's change to Administrator, and back, applies only in the test account.
   - The records hold both logins' email address and user ID (owner-approved).
4. **Make the tokens.** All are **account API tokens**: Manage Account → Account API Tokens → Create Token, or the pre-filled links below. Choose this account under Account Resources. Copy each value once, straight into the environment settings (step 5).
   1. **Admin token** `live-pass-admin`, for the runner only (snapshots, logs, its records bucket, cleanup of its probes). This link pre-fills six of its eight permissions:
      ```
      https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22e086da7e2179491d91ee5f35b3ca210a%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22bf7481a1826f439697cb59a20b22293e%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%2209b2857d1c31407795e75e3fed8617a1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22adc8fa2bc6124928a8b3314dc63a1235%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%225bc3f8b21c554832afc660159ab75fa4%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%2250fc2f43318f40e4855a35d8de5bf643%22%2C%22type%22%3A%22edit%22%7D%5D&name=live-pass-admin
      ```
      On the page, **add by hand**: Account → **Account Settings → Read**, and Account → **Workers Observability → Edit**. Check it lists exactly the eight of section 2's table. TTL: end date **7 days** from today (it must outlast both sessions).
   2. **Starter token** (the framework's bootstrap token), for session 1. The framework's own link (four permissions, all Edit: Workers Scripts, OAuth Client, Secrets Store, Account API Tokens):
      ```
      https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22e086da7e2179491d91ee5f35b3ca210a%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%2250fc2f43318f40e4855a35d8de5bf643%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22adc8fa2bc6124928a8b3314dc63a1235%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%225bc3f8b21c554832afc660159ab75fa4%22%2C%22type%22%3A%22edit%22%7D%5D&name=prototype-framework-bootstrap
      ```
      TTL: start today, **end date tomorrow**. Make it shortly before session 1. (The framework refuses a starter token that has more than 24 hours left and deletes it at once. The runner checks every starter token's expiry first, before anything uses it; if it says the expiry is too far away, see section 5.)
   3. **Second starter token** (optional, recommended; kept by the owner, DEC-0789; step S5, the re-run): the same link, the same TTL, the same name.
   4. **Long-lived starter token** (optional, recommended; kept by the owner, DEC-0789; step S1): the same link, the same name, **TTL left empty**. The framework must delete it at once.

   If you leave out 3 or 4, steps S5 or S1 are recorded as "n/a".
5. **The cloud environment.** In Claude Code on the web, use (or make) an environment for the repository `lago-morph/cloud-app`:
   - **Network access:** allow at least `api.cloudflare.com`, `dash.cloudflare.com`, `*.workers.dev`, `*.r2.cloudflarestorage.com` and `registry.npmjs.org` (or allow all hosts).
   - **Environment variables:** session 1's column of section 2. Save.

## 2. Tokens and environment variables

The framework keeps reading the variables it always has: `CLOUDFLARE_BOOTSTRAP_TOKEN`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The runner's own variables start with `LIVE_PASS_`; the runner never passes them to a framework command.

| Variable | Session 1 | Session 2 | What it holds | Permissions (dashboard names) |
|---|---|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | set | set (unchanged) | the account ID | — |
| `LIVE_PASS_ADMIN_TOKEN` | set | set (unchanged) | admin token `live-pass-admin` (1.4.1), 7-day expiry | Account API Tokens Edit, Account Settings Read, D1 Edit, OAuth Client Edit, Secrets Store Edit, Workers Observability Edit, Workers R2 Storage Edit, Workers Scripts Edit |
| `CLOUDFLARE_BOOTSTRAP_TOKEN` | set | **delete** | starter token (1.4.2), at most 1 day left | Workers Scripts Edit, OAuth Client Edit, Secrets Store Edit, Account API Tokens Edit |
| `LIVE_PASS_BOOTSTRAP_RERUN` | set (recommended) | **delete** | second starter token (1.4.3) | the same four |
| `LIVE_PASS_BOOTSTRAP_LONG` | set (recommended) | **delete** | starter token with no expiry (1.4.4) | the same four |
| `CLOUDFLARE_API_TOKEN` | **must not be set** | set | the everyday token `prototype-framework` that the admin app's Everyday token page makes and shows once (step S8) | made by the admin app: Workers Scripts Edit, Workers R2 Storage Edit, D1 Edit, Secrets Store Read |

After the run you make one more token, for the analyst (section 4, step 11). It is not an environment variable: it holds the admin token's eight permissions.

Optional variables: `LIVE_PASS_BUCKET` (the records bucket; default `live-pass-records`), `LIVE_PASS_WORKDIR` (where the runner creates the app; default `~/live-pass`).

## 3. Session 1: the starter token and the setup (about 60 minutes)

1. Check the environment variables are session 1's column of section 2, and the starter tokens were made today (1.4).
2. Start a **new** cloud session in that environment, on the branch that has the runner (`main` once this runbook's PR is merged), and paste:
   ```
   Run session 1 of the v0.2.0 live pass. Read only the section "For the agent in the session" of ai/implementation/live-pass-v0.2.0.md and follow it exactly. In this live-pass session you, the main agent, run the runner's commands yourself and relay its owner prompts to me live, word for word: this is an exception to the orchestrator rule in CLAUDE.md, for the live-pass sessions only (owner decision DEC-0789). Start with: node scripts/live-pass/live-pass.mjs start
   ```
3. The agent asks you, in this order. Each prompt says exactly what to open and what you should see. Reply `ok` when it matched, or say in a few words what differed.
   1. **P3, the tester** (only if not yet a member): invite the tester with "HTTP Applications Read"; the tester accepts the invitation in their profile.
   2. **S6, admin app sign-in**: you open the admin app, "Sign in with Cloudflare", approve; you see "Signed in as …". The tester does the same in their profile and is refused (403).
   3. **S7, Account setup** (admin app page 1): "Continue at Cloudflare", keep all five optional toggles ticked, approve. You see the auth app line, one line per shared resource, the signing line and "Recorded account setup version 2."
   4. **E-1, Everyday token with Secrets Store unticked**: "Continue at Cloudflare", untick Secrets Store, approve. You see "Nothing was done: …" naming `secrets-store.read`.
   5. **S8, Everyday token** (page 2): "Continue at Cloudflare", all ticked, approve. You see "The everyday token `prototype-framework` was created with exactly these permissions" and the token's value, once. **Copy the value straight into the environment settings now** (environment menu → Edit → Environment variables):
      - add `CLOUDFLARE_API_TOKEN` = the value;
      - delete `CLOUDFLARE_BOOTSTRAP_TOKEN`, `LIVE_PASS_BOOTSTRAP_LONG` and `LIVE_PASS_BOOTSTRAP_RERUN`;
      - leave `CLOUDFLARE_ACCOUNT_ID` and `LIVE_PASS_ADMIN_TOKEN` as they are. Save.

      This session keeps its old values; only session 2 sees the change. Then reply `ok` (never the value).
   6. **S10, Status** (page 3): "Continue at Cloudflare", approve. Four sections, nothing registered and no sign-in yet, no warning.
4. The agent then says **"SESSION 1 IS DONE: STOP HERE"**. The checkpoint is stored in the test account (R2 bucket `live-pass-records`), so nothing is lost when this session ends. Check the environment variables match session 2's column of section 2 (step 3.5 did it), then end the session.

## 4. Session 2: stages, sign-ins and the hand-over (about 60 minutes)

1. Start a **new** cloud session in the same environment, on the same branch, and paste this prompt (use it rather than the shorter one the runner prints at the end of session 1, which does not carry the `CLAUDE.md` exception):
   ```
   Run session 2 of the v0.2.0 live pass. Read only the section "For the agent in the session" of ai/implementation/live-pass-v0.2.0.md and follow it exactly. In this live-pass session you, the main agent, run the runner's commands yourself and relay its owner prompts to me live, word for word: this is an exception to the orchestrator rule in CLAUDE.md, for the live-pass sessions only (owner decision DEC-0789). Start with: node scripts/live-pass/live-pass.mjs resume
   ```
2. The runner checks that only the everyday and admin tokens are there, makes the app again from the release candidate, runs "continue prototype setup", probes a deploy without Secrets Store Read (U3), and deploys a test stage and the production stage `prodcheck`. This takes 10–20 minutes without you.
3. **S13, real sign-ins.** You open the app's URL (the prompt gives it), "Log in", approve (the consent names `prototype-framework-sign-in`): "Logged in as u_… (admin)". On the Files page you upload a small PNG or JPEG and open it. The tester logs in in their profile: "(user)". The tester **stays signed in**.
4. **S14, a role change takes effect at the next sign-in.** Four short prompts:
   1. You change the tester's role to exactly **Administrator** (Manage Account → Members). Reply `ok`.
   2. Wait until the time the prompt names (about 6 minutes), then the tester reloads `<app>/api/auth/me`. Expected: still `"level":"user"`. Reply with the level: `user` or `admin`.
   3. The tester logs out and in. Expected: `(admin)`. Reply with the level.
   4. You set the tester back to their first role; the tester logs out and in. Expected: `(user)`. Reply with the level.
5. **S15, sign-out.** You log out of the app ("You are not logged in.") and sign out of the admin app.
6. **S16, Status again.** You sign in to the admin app, open Status: Registered apps lists `livepass-prodcheck`, Recent sign-ins lists you (admin) and the tester (user).
7. **U1, Everyday token again.** The runner has made a second token named `prototype-framework`. You run the Everyday token page with everything ticked. Reply `updated` if it says the existing token was updated in place, or `new` if it says a new one was created. **If it says a new one was created, do not press "I have saved the new token: delete the old one"** (that would delete the token this session runs on), and do not save the new value.
8. **E-10, Clean up v0.1.x email.** The runner has made a stand-in bucket `prototype-mailsink`. You run that page: "Deleted the R2 bucket prototype-mailsink and its 1 stored test messages."
9. The runner removes both stages and collects every log.
10. The agent says **"THE LIVE PASS IS FINISHED"** and prints a link and a list of permissions.
11. **The last step: the analysis token.** Open the printed link (Manage Account → Account API Tokens; it pre-fills what it can) and make the token `live-pass-analysis` with exactly these eight permissions, on this account: **Account API Tokens Edit, Account Settings Read, D1 Edit, OAuth Client Edit, Secrets Store Edit, Workers Observability Edit, Workers R2 Storage Edit, Workers Scripts Edit**. Expiry: 7 days. It reads every record and log, and can delete everything the run created (Workers, D1, R2 buckets and objects, Secrets Store, API tokens, OAuth clients).
12. Give the analyst, in one message: the records' **bucket and prefix** as the agent printed them (`live-pass-records`, `runs/lp-…/`), the **account ID**, and the token's value. Nothing else is needed. Then you may delete the session's environment variables; the analyst deletes the tokens themselves when cleaning up.

## 5. If something goes wrong

- **The agent says BLOCKED** (exit code 1): a step that the rest depends on failed, for example the admin token lacks a permission, or the bootstrap stopped. The message says what to do. When it is fixed, the agent runs `retry`; if you decide to go on without the step, tell the agent and it runs `skip <step> "<your reason>"`.
- **A starter token's expiry is too far away** (step C-1 blocks before anything used it): make the starter tokens again with **today** as the end date, put them in the environment settings, start a new session and paste the session-1 prompt with `resume` instead of `start`.
- **The session or its container ended** in the middle (any session): nothing is lost. Start a new session in the same environment and paste the prompt of the session you were in, with `resume` instead of `start`. The runner continues where it stopped; a waiting question is asked again.
- **The environment variables are not as section 2 says** (exit code 3): the message names the variable. Fix it in the environment settings and start a new session with the `resume` prompt.
- **The admin app asks you to sign in again** (its session lasts 15 minutes): sign in, then repeat the page.
- **You replied something wrong**: tell the agent; it runs `note "<your correction>"`, which goes into the records.
- **R2 is not enabled** (the runner says so at `start`): section 1.2, then start again.
- **The dashboard offers no "Workers Observability" permission** for the admin token: make it with the other seven. The run goes on and records that the Workers logs could not be collected (the framework's own log bucket and the auth app's records still are).
- **The release candidate has another version string** than `0.2.0-rc01` (for example `0.2.0-rc.1`): tell the agent before `start`; it adds `--version <the version>` (or `--version next`).

## 6. What the run checks

Every step records expected against observed; IDs are kept from the previous runbook. Results go to `results.md` in the records. Owner steps are marked (you).

| ID | Session | What is expected |
|---|---|---|
| P1 | 1 | Tools and network; the admin token holds its eight permissions; every starter token active; the account empty. |
| P2 | 1 | `npm create @lago-morph/prototype-app@0.2.0-rc01` makes the app `livepass`; the installed framework is that version; a committed `config/cloudflare/prodcheck.json`. |
| P3 (you) | 1 | The owner (Super Administrator) and the tester (no administrator role) are accepted members. |
| S2 | 1 | A non-token value in `CLOUDFLARE_BOOTSTRAP_TOKEN`: names the setting and the link, exit 1, nothing created. |
| S1 | 1 | A starter token with no expiry: "… Setup deleted it at once …", exit 1, the token no longer verifies, no token value in the output. |
| C-1 | 1 | What the TTL picker set: each starter token has at most 24 h left (PAR-435); the starter token holds exactly its four groups. |
| S4 | 1 | Bootstrap: both OAuth clients created, Secrets Store `prototype-framework` with four entries, Worker `prototype-admin`, the token deleted itself, exit 0, no token value in the output; C-2, C-3 (comments; the store created by the bootstrap), C-4, E-2. |
| S5 | 1 | Re-run: "already exist", both client IDs kept, the admin app redeployed, the token deleted itself. |
| S6 (you) | 1 | Owner admitted, tester refused with 403; the admin app logs "admin signed in". |
| S7 (you) | 1 | Page 1: Worker and D1 `prototype-auth`, buckets `prototype-logs`, `sst-state`, `prototype-backups` with its lifecycle rule, setup record version 2; E-8 (release-blocking: the signing token is made), E-9 and F-3 (the auth app's bindings, `id` or `database_id`), F-6 (the signing entries' comment). |
| E-1 (you) | 1 | Page 2 with Secrets Store unticked: nothing was done; no token made. |
| S8 (you) | 1 | Page 2: one `prototype-framework` token with exactly the four everyday groups, on this account only (U2). |
| S10 (you) | 1 | Page 3 before sign-ins: no app registered, no sign-in. |
| CP | 1 | Logs, records and a snapshot collected; the checkpoint stored. |
| R1, R2 | 2 | Only the everyday and admin tokens reach the runner's commands; the app made again. |
| S9 | 2 | "continue prototype setup" with the everyday token: no email-domain question, account setup current, exit 0; the everyday token reads Workers, R2, D1 and the store list (U2); A-1 part a (the role names); A-2 (the issuer). |
| U3 | 2 | A token without Secrets Store Read uploads a Worker binding a store secret, or not (recorded); F-7 (the store list answers 403). |
| S11 | 2 | Test stage `test-live`: deploys (after `apiKey` is set), health 200, mock login gives level `user`. |
| S12 | 2 | Production stage `prodcheck`: no email-domain stop, exit 0; F-1 (service binding `AUTH` → `prototype-auth`, entrypoint `AuthApp`); F-4 (registry row via the everyday token); `/start` 302 for the registered return, 400 for a foreign one; no mock login; F-5 n/a. |
| S13 (you) | 2 | The auth app records the owner as `admin` and the tester as `user`; F-8 (an uploaded object in the stage's bucket). |
| S14 (you) | 2 | After the role change and the refresh interval, the existing session stays `user` (DEC-0703); after signing in again, `admin` (A-1 part b: "Administrator" is an admin role); set back, `user` again. |
| S15 (you) | 2 | Signed out of the app and the admin app. |
| S16 (you) | 2 | Page 3: the registered app and both sign-ins (E-4). |
| U1 (you) | 2 | The grant updates a token it did not create (yes), or makes a new one (no); the everyday token in use keeps working. |
| E-10 (you) | 2 | The cleanup page deletes the stand-in bucket and its object. |
| S17 | 2 | Both stages removed (production after its backup); `/start` 400 and no registry row; no stage resource left; the shared resources kept. |
| FIN | 2 | All logs and records uploaded; the analysis token's link printed. |

Recorded throughout, without your help: every command with its arguments, exit code, timing and output (secrets scrubbed); an API snapshot of the account after every step; every API call's method, path and status; the Workers logs of the admin app, the auth app and the stages (the runner turns on Workers Logs for every Worker); the shared log bucket; the auth app's records of who signed in with which role.

Already confirmed, so not an open point of this pass: a token holding only Secrets Store Read lists the stores and a store's secrets and is refused writes (owner's check of 2026-11-02, DEC-0788). S9 still records the everyday token's own store-list read (U2); U3 stays open.

Not checked in this pass: F-5 (needs a 0.1.x stage with Worker secrets) and its fallback; the removal of a member at the next sign-in (E2E-007 step 4 covers it locally).

## 7. Cost and cleanup

**Made by the pass and kept for the analyst:** OAuth clients `prototype-framework-admin` and `prototype-framework-sign-in`; Workers `prototype-admin` and `prototype-auth`; D1 `prototype-auth`; R2 buckets `prototype-logs`, `sst-state`, `prototype-backups` (with the `prodcheck` backup) and `live-pass-records`; Secrets Store `prototype-framework` with six entries; API tokens `prototype-framework`, `prototype-r2-signing`, `live-pass-admin` and `live-pass-analysis`. All within the Free plan's allowances at this scale.

**Removed by the pass itself:** the starter tokens (they delete themselves), both stages (S17), the probe Worker and token of U3, the stand-in token of U1 (and any copy page 2 made of it), the stand-in bucket of E-10.

**Cleanup** is the analyst's, with the analysis token, after the records are read (`live-pass-analysis.md` §4). What remains in the account afterwards: its members, its `workers.dev` subdomain and Workers Logs history, which expire on their own.

---

## For the agent in the session

You run the live pass's runner for the owner. Read only this section.

**Exception to `CLAUDE.md` (owner decision DEC-0789).** In the live-pass sessions only, you, the session's main agent, run `scripts/live-pass/` yourself and relay its prompts to the owner live. This overrides the orchestrator rule in `CLAUDE.md` (the main agent runs nothing and delegates) for this purpose only: do not spawn subagents for the runner, and do nothing else that the rule forbids.

1. **Run the runner's commands yourself**, from the repository root, with the Bash tool's timeout at its maximum (600000 ms). They are the pass's procedure, not a test suite: run them directly, do not delegate them, and change no file in the repository.
2. Start with the command the owner's prompt names (`start` in session 1, `resume` in session 2 or after an interruption). Then act on the exit code:
   - **10**: an owner step. Relay the runner's prompt (the text between `=== OWNER STEP … ===` and the line "When the owner replies…") to the owner **word for word**, wait for the reply, then run `node scripts/live-pass/live-pass.mjs answer "<the reply, word for word>"`.
   - **11**: the runner's time budget is used. Run `node scripts/live-pass/live-pass.mjs next`.
   - **1**: BLOCKED. Relay the message to the owner word for word. On their decision run `retry`, or `skip <step> "<their reason>"`. Never skip on your own.
   - **3**: the environment variables are not as the runbook says. Relay the message; the owner fixes the settings and starts a new session.
   - **0**: the session is done ("SESSION 1 IS DONE" or "THE LIVE PASS IS FINISHED"). Relay the closing text to the owner word for word and stop.
   - Any other exit, or the Bash tool timed out: run `node scripts/live-pass/live-pass.mjs next` once; if it fails again, relay the output and stop.
3. If the owner corrects an earlier reply or tells you something the records should hold, run `node scripts/live-pass/live-pass.mjs note "<their words>"`.
4. **Never print, echo, log or write an environment variable's value**, and never run a command that would (`env`, `printenv`, `set`, `echo $…`). If the owner pastes a token value into the chat, tell them to make a new token, since that one is exposed.
5. Do not diagnose or fix anything during the pass. The runner records everything for the analyst.
6. `node scripts/live-pass/live-pass.mjs status` prints where the run is, at any time.
