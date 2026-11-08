# Live pass v0.2.0 — analysis and cleanup

For the agent who analyses the live pass after the owner has run it (`live-pass-v0.2.0.md`). You work from the records alone; the owner describes nothing. The run was in the **test Cloudflare account**, a new account made for the pass. Two logins took part: the **test account login**, the new login whose sign-up created the test Cloudflare account (its Super Administrator), and the **primary account login**, the login that owns the primary Cloudflare account, invited into the test Cloudflare account with "HTTP Applications Read". The records name them `owner` and `tester` (for example `facts.owner`, `facts.tester`, `facts.testerEmail`); in this guide they are always the test account login and the primary account login. You never touch the primary Cloudflare account: this sandbox's own `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (if set) belong to it, and nothing below uses them.

You receive, in one message: the **records bucket and prefix** (`live-pass-records`, `runs/lp-<yyyymmdd>-<hhmmss>/`), the **test Cloudflare account's ID**, and the token **`live-pass-owner`**, the same token the runner used (DEC-0793: no new token is made for the analysis). Its eight permissions (API names; the dashboard says Edit for Write): Account API Tokens Write, Account Settings Write, D1 Write, OAuth Client Write, Secrets Store Write, Workers Observability Write, Workers R2 Storage Write, Workers Scripts Write. It reads every record and log, deletes everything the run made, and removes the primary account login from the test Cloudflare account.

Never print, log or commit the token; the owner may paste it into the chat (it is for the test Cloudflare account only). The records hold both logins' emails and Cloudflare user IDs (the owner allowed that); they hold no token value.

## 1. Fetch the records

1. Keep the two values where the runner reads them: with your file-writing tool (never a shell command that holds the value), write the test Cloudflare account's ID as the only content of `~/.live-pass-secrets/CLOUDFLARE_ACCOUNT_ID` and the token as the only content of `~/.live-pass-secrets/LIVE_PASS_OWNER_TOKEN`, then run `chmod 700 ~/.live-pass-secrets && chmod 600 ~/.live-pass-secrets/*`. Every shell call below reads them from there.
2. Check the token (expect `true active`):
   ```bash
   ACC=$(cat ~/.live-pass-secrets/CLOUDFLARE_ACCOUNT_ID)
   curl -sS -H "Authorization: Bearer $(cat ~/.live-pass-secrets/LIVE_PASS_OWNER_TOKEN)" "https://api.cloudflare.com/client/v4/accounts/$ACC/tokens/verify" | jq -r '"\(.success) \(.result.status)"'
   ```
3. Download every record with the runner (read-only; it reads the secrets directory, and in a cloud session behind a proxy it sets `NODE_USE_ENV_PROXY=1` itself):
   ```bash
   node scripts/live-pass/live-pass.mjs download --run lp-<id> --to ~/live-pass-analysis/lp-<id>
   ```
   It prints how many files it wrote. Without `--run` it takes the newest run (`latest.json` at the bucket's root). Without the runner, list `GET /accounts/<A>/r2/buckets/live-pass-records/objects?prefix=runs/lp-<id>/&per_page=1000` (follow `result_info.cursor` while `is_truncated`) and fetch each `…/objects/<url-encoded key>`.

## 2. What each file holds

All times are UTC ISO strings; `NNN` is one sequence across the run, so sorting by file name orders everything in time. Every text passed the runner's scrubber: a known token shows as `[REDACTED:<variable name>]`, a pattern match as `[REDACTED]`, `[REDACTED:jwt]`, `[REDACTED:token-like]`, `[REDACTED:hex64]` or `[REDACTED:<field>]`.

| File | What it holds |
|---|---|
| `results.md`, `results.json` | Start here. Each step's result (`pass`, `fail`, `n/a`, `info`, `skipped`, or `in progress`/`not run` for an unfinished run), with the reason of an n/a or a skip; each check ID's result over the steps that tag it (fail beats pass beats info). |
| `state.json` | The runner's durable state, which is also the checkpoint between the run's two parts (both in one Claude session since DEC-0793; the state calls them sessions 1 and 2): `phase` (`session-1` = part 1, `checkpoint`, `session-2` = part 2, `finished`), `sessions` (start and end of each part and container), `done` (per step: result, end time, reason, per-check results), `pending` (a step in progress or waiting for the owner; its `record` is that step's evidence so far), `facts`. |
| `run.json` | The run's identity: bucket, prefix, test Cloudflare account ID, release-candidate version asked for, app name (`livepass`), runner commit, sessions, and `facts`: the owner token's ID, `testerEmail` (the primary account login's email as given), subdomain, admin and auth app URLs, `owner` (the test account login) and `tester` (the primary account login), each with email, user ID and member ID, and for the primary account login its first roles and role IDs, OAuth client IDs, store ID, auth database ID, everyday token ID and whether the runner rolled its value (`everydayRolled`), signing token ID, the starter tokens' IDs, the U1 and U3 answers, the role-change time, the installed framework version. |
| `handover.json` | Bucket, prefix, test Cloudflare account ID, the token to use (`live-pass-owner`, its ID and groups). |
| `steps/NNN-<step>.json` | One step: `expected` (the runbook's expectations), `observations` (`id`, `check`, `expected`, `observed`, `pass`: true, false, or null for a fact recorded without a verdict, `note`, `at`), `owner` (each prompt, when it was asked, the owner's reply word for word, when they answered), `commands` (the command records of the step), `notes`, `snapshot` (the snapshot taken after the step) and `snapshotDiff` (`added`, `removed`, `changed`, and `unreadable` sections), `observability` (each Worker's Workers Logs setting before the step's end and what the runner did). A step that blocked has an extra file per attempt with `result: "blocked"`, `attempt` and `error`. |
| `commands/NNN-<step>-<label>.json` | One command the runner ran: `argv`, `cwd`, `env` (which token variables were set, never their values: a starter token only for S2, S4 and S5, the everyday token only for part-2 framework commands), `startedAt`, `endedAt`, `durationMs`, `exitCode` (null when it could not start), `timedOut`, `stdout`, `stderr`, and `rawSecretHits`: which known token values the raw output contained before scrubbing. **Any non-empty `rawSecretHits` is a finding** (SETUP-REQ-007). |
| `snapshots/NNN-after-<step>.json` | The test Cloudflare account after the step, read with the owner's token: `account`, `members` (email, user ID, status, role names and IDs), `tokens` (name, ID, status, issue, change and expiry times, last use, permission group names and resources per policy), `oauthClients` (as listed; a secret field would be redacted), `workers` (each script: times, compatibility date and flags, bindings, observability, Worker secret names), `subdomain`, `d1`, `r2` (each bucket: object keys and sizes, lifecycle, CORS; for `sst-state` also the framework's `framework/*.json` records), `secretsStore` (stores; secret names, comments, status, times; the API returns no values). A section the token could not read holds `ok: false` and the error. |
| `api-calls.jsonl` | Every Cloudflare API call the runner made: time, which token (`admin` = the owner's token `live-pass-owner`, `everyday`, `verify`, `pf-live-no-ssr`), method, path, status, duration. Bodies are never recorded. The invitation (`POST …/members`), the role changes (`PUT …/members/<id>`) and the roll (`PUT …/tokens/<id>/value`) are here. |
| `http.jsonl` | Every request to an app (`*.workers.dev`), npm and dash.cloudflare.com: method, URL, status, `location`, `set-cookie` (values redacted) and the first 2,000 characters of the body. |
| `events.jsonl` | The run's timeline: each runner invocation (command, session, phase, runner commit, Node version), each step's end and result, the owner's notes (`note`), environment warnings, runner errors with their stack. |
| `observability.jsonl` | After every step: each Worker's Workers Logs setting as found, and whether the runner turned it on. A Worker found off right after a framework deploy shows that the framework's upload resets the setting (S5 records this for the admin app). |
| `server/workers-logs-checkpoint.json`, `server/workers-logs-final.json` | Every Workers Logs event of the run up to the checkpoint and to the end, from the Workers Observability query API (`view: events`): the admin app's and the auth app's JSON log lines (`admin signed in`, `grant refused: …`, `sign-in refused: …`, `… failed`, `token revocation failed …`) and each invocation (URL, status, outcome, timing; the auth app's `AuthApp` RPC calls `redeem` and `role`). `windows` shows how the run's time was split to stay under the query limit. |
| `server/workers-logs/NNN-<step>.json` | The events the runner read while verifying one owner step (from a minute before the step to the check). |
| `server/log-bucket/<app>/<stage>/<yyyy>/<mm>/<dd>/<time>-<severity>-<requestId>.json` | Copies of the framework's own log entries (LOG-REQ-004) from `prototype-logs`: stage failures and app `log.write` calls, each with its request ID. |
| `server/auth-db-checkpoint.json`, `server/auth-db-final.json`, `server/auth-db/NNN-<step>.json` | The auth app's D1 rows: `users` (sub = Cloudflare user ID, email, role recorded at the last sign-in, time), `registry` (app, return URL), `codes` (without the code hash) and `sign_ins` (without state hash, PKCE verifier and nonce). |

The runner turned Workers Logs on for every Worker of the test Cloudflare account (script settings, no redeploy) so the admin app's and the auth app's console lines were kept; that is the runner's doing, not the framework's. Workers Logs keeps events for 3 days on the Free plan: query again within that time if you need more than the records hold (`POST /accounts/<A>/workers/observability/telemetry/query`, body as in `scripts/live-pass/lib/server.mjs`).

## 3. How to analyse

1. Read `results.md`. A run that did not reach `finished` shows where it stopped: `state.json`'s `pending` holds the step's evidence so far, and `events.jsonl` the last invocations.
2. For each `fail`, open the step's file in `steps/`: the failed observations say what was expected and what was seen. Then follow the time: its commands (`commands/`), the HTTP and API calls in that window (`http.jsonl`, `api-calls.jsonl`), the Workers logs and the snapshot diff.
3. The observations with `pass: null` are facts to judge, not verdicts: U3 (does a deploy that binds a store secret need Secrets Store Read?), U1 (did the grant update the stand-in, `facts.u1`), F-3 (`id` or `database_id`), A-2 (the issuer string), C-1 (what the TTL picker set; compare `expires_on` with the time the owner made the token, from the token's `issued_on` in the snapshots), whether a framework upload keeps Workers Logs on, and S8's roll of the everyday token (a `null` there means the roll was refused and the owner pasted the value; that settles the runbook's unverified point about rolling a token an OAuth grant made).
4. The points the runbook lists as **not verified** before the pass (section 4) are settled by the run: P3 (the invitation's request and the primary account login's acceptance), S14 (both role changes), S8 (the roll), and P1's group check (whether the dashboard pre-filled all eight). Record each in the decisions file of step 6.
5. The owner's replies are word for word in each step's `owner` list. A reply other than `ok` (or the level or `updated`/`new` the prompt asked for) is what the owner saw differ; the API, database and log observations of the same step say what the test Cloudflare account shows.
6. Settle each point as `live-pass-v0.2.0.md` section 6 and the table below say. Record what confirms or changes a decision or parameter in `ai/implementation/decisions/v020-live.md` (one `### <ID> — confirmed|changed by live check <check>` entry each; a change takes the next free ID per `docs/CONVENTIONS.md`).

| Check | What to change when it fails | Where |
|---|---|---|
| P1, P3, S8, S14 (the runner's own API use) | DEC-0793 (the runbook's "verified" and "not verified" lists, the runner's request bodies) | `docs/decisions/decision-log.md`; `scripts/live-pass/lib/context.mjs`, `lib/groups.mjs` |
| S2, S4, C-1 | DEC-0681, DEC-0683, PAR-435 (and the TTL wording; S1, the no-expiry check, is not in this pass: its rule is being removed in the 0.2.0 cleanup) | `decisions/v020-C.md`; `packages/framework/src/provision/cloudflare/cloudflare-setup.ts` |
| S5, C-2 | DEC-0684 (create body, list fields, re-run rule) | `decisions/v020-C.md`; `provision/cloudflare/oauth-clients.ts` |
| C-3 | DEC-0685, PAR-436, PAR-437 | `decisions/v020-C.md`; `provision/cloudflare/secrets-store.ts`, `oauth-clients.ts` |
| C-4, E-2 | DEC-0686, DEC-0711, DEC-0720 | `decisions/v020-C.md`, `v020-E.md`; `provision/cloudflare/admin-app-deploy.ts` |
| S6 | DEC-0710, PAR-413 (admin gate) | `decisions/v020-E.md`; `admin-app/grant.ts` |
| E-1 | DEC-0714 | `decisions/v020-E.md`; `admin-app/grant.ts` |
| U1 | DEC-0715 (the fallback becomes the normal path if "no"); plan §5.2 page 2 | `decisions/v020-E.md`; `provision/cloudflare/everyday-token.ts` |
| U2 | DEC-0715, PAR-447 `everyday` row, the admin client's scopes (DEC-0684) | `decisions/v020-E.md`, `v020-C.md`; `admin-app/scopes.ts`, `provision/cloudflare/oauth-clients.ts` |
| U3 | DEC-0727; plan §5.2 page 2's reason for Secrets Store Read | `decisions/v020-F.md`; `plan-v0.2.0-testing-auth.md` §5.2 |
| E-8 | DEC-0719, PAR-447 `setup` row, `ADMIN_OPTIONAL_SCOPES` (release-blocking for page 1) | `decisions/v020-E.md`, `v020-C.md`; `admin-app/scopes.ts`, `provision/cloudflare/oauth-clients.ts` |
| E-9, F-3 | DEC-0719 (upload), DEC-0725 (`id` or `database_id`) | `decisions/v020-E.md`, `v020-F.md`; `provision/cloudflare/auth-app-deploy.ts`, `worker.ts` |
| E-4, S10, S16 | DEC-0717, PAR-448 | `decisions/v020-E.md`; `admin-app/status-page.ts` |
| E-10 | DEC-0718, PAR-449 | `decisions/v020-E.md`; `admin-app/cleanup-page.ts` |
| A-1 | PAR-413 (exact role strings), DEC-0652 | `decisions/v020-A.md`; `auth-app/params.ts` (`ADMIN_ROLE_NAMES`) |
| A-2 | DEC-0653 (add the issuer comparison) | `decisions/v020-A.md`; `auth-app/upstream.ts` |
| S12, F-1 | DEC-0726 (else the script-upload fallback); DEC-0698 (no email-domain stop) | `decisions/v020-F.md`; `provision/cloudflare/sst.ts` |
| F-4, S17 | DEC-0725 (registry write and clear) | `decisions/v020-F.md`; `provision/cloudflare/worker.ts`, `target.ts` |
| F-6, F-7, F-8 | DEC-0729, PAR-455 | `decisions/v020-F.md`; `provision/cloudflare/r2-token.ts` |
| S13, S14 | DEC-0703, DEC-0791, PAR-250, PAR-425 (a role change shows at the next sign-in; the existing session keeps its role) | `docs/decisions/decision-log.md`; `packages/framework/src/auth/role-refresh.ts` |
| S15 | DEC-0660 (`end_session`), AUTH-REQ-006 | `decisions/v020-A.md`; `docs/components/auth.md` |
| S9 | DEC-0697 (the check run), DEC-0716 | `decisions/v020-E.md`; `provision/cloudflare/cloudflare-setup.ts` |

A failure found here is a defect to diagnose under the testing standards (`.claude/skills/testing-standards/SKILL.md`, `resources/failure-diagnosis.md`), with an evidence-based root cause before any change.

## 4. Clean up

Only after the download is complete (step 1.3 printed the file count, and `results.md` opens). Everything here is in the test Cloudflare account. The order matters: Workers before the D1 database and Secrets Store they bind, buckets emptied before they are deleted, the records bucket after the records are safe, and the token `live-pass-owner` last.

Each shell call starts with the same two lines:
```bash
ACC=$(cat ~/.live-pass-secrets/CLOUDFLARE_ACCOUNT_ID)
cf() { curl -sS -H "Authorization: Bearer $(cat ~/.live-pass-secrets/LIVE_PASS_OWNER_TOKEN)" "https://api.cloudflare.com/client/v4/accounts/$ACC$1" "${@:2}"; }
```

1. **Workers** (`prototype-admin`, `prototype-auth`, any `livepass-*` or `pf-live-probe` left):
   ```bash
   for w in $(cf /workers/scripts | jq -r '.result[].id'); do echo "$w $(cf "/workers/scripts/$w?force=true" -X DELETE | jq -c .success)"; done
   ```
2. **D1** (`prototype-auth`, any `livepass-*`):
   ```bash
   cf '/d1/database?per_page=100' | jq -r '.result[] | "\(.uuid) \(.name)"' | while read -r id name; do echo "$name $(cf "/d1/database/$id" -X DELETE | jq -c .success)"; done
   ```
3. **R2 buckets other than the records bucket** (`prototype-logs`, `sst-state`, `prototype-backups`, any `livepass-*-files`, `prototype-mailsink`): empty each, then delete it. Repeat the listing until it is empty (1,000 keys per page):
   ```bash
   for b in $(cf '/r2/buckets?per_page=1000' | jq -r '.result.buckets[].name' | grep -vx live-pass-records); do
     while keys=$(cf "/r2/buckets/$b/objects?per_page=1000" | jq -r '.result[]?.key'); [ -n "$keys" ]; do
       while IFS= read -r k; do cf "/r2/buckets/$b/objects/$(jq -rn --arg k "$k" '$k|@uri')" -X DELETE >/dev/null; done <<< "$keys"
     done
     echo "$b $(cf "/r2/buckets/$b" -X DELETE | jq -c .success)"
   done
   ```
4. **Secrets Store**: each secret, then the store.
   ```bash
   for s in $(cf /secrets_store/stores | jq -r '.result[].id'); do
     for x in $(cf "/secrets_store/stores/$s/secrets?per_page=100" | jq -r '.result[].id'); do cf "/secrets_store/stores/$s/secrets/$x" -X DELETE | jq -c .success; done
     cf "/secrets_store/stores/$s" -X DELETE | jq -c .success
   done
   ```
5. **OAuth clients** (`prototype-framework-admin`, `prototype-framework-sign-in`):
   ```bash
   for c in $(cf /oauth_clients | jq -r '.result[] | .client_id // .id'); do echo "$c $(cf "/oauth_clients/$c" -X DELETE | jq -c .success)"; done
   ```
   If the API refuses, delete them in the dashboard (Manage Account → OAuth clients) and tell the owner.
6. **API tokens** other than `live-pass-owner` (`prototype-framework`, `prototype-r2-signing`, anything left from the run):
   ```bash
   ME=$(cf /tokens/verify | jq -r .result.id)
   for t in $(cf '/tokens?per_page=100' | jq -r --arg me "$ME" '.result[] | select(.id != $me) | .id'); do echo "$t $(cf "/tokens/$t" -X DELETE | jq -c .success)"; done
   ```
7. **The primary account login's membership** in the test Cloudflare account (Account Settings Write). The test account login, its Super Administrator, stays:
   ```bash
   for m in $(cf '/members?per_page=50' | jq -r '.result[] | select([.roles[]?.name] | index("Super Administrator - All Privileges") | not) | .id'); do echo "$m $(cf "/members/$m" -X DELETE | jq -c .success)"; done
   ```
8. **The records bucket**, once your analysis no longer needs the bucket itself: empty and delete `live-pass-records` as in step 3.
9. **Check**: `cf /workers/scripts`, `cf /d1/database`, `cf /r2/buckets`, `cf /secrets_store/stores`, `cf /oauth_clients` and `cf /tokens` list nothing but `live-pass-owner`, and `cf /members` lists only the test account login.
10. **Last, `live-pass-owner` deletes itself**: `cf "/tokens/$(cf /tokens/verify | jq -r .result.id)" -X DELETE | jq -c .success`. After this the token answers 401. Then run `rm -rf ~/.live-pass-secrets`.

Left in the test Cloudflare account, and not deletable with the token: the test account login's own membership, its `workers.dev` subdomain, and the Workers Logs history, which expires on its own. Tell the owner the cleanup is done and what remains.
