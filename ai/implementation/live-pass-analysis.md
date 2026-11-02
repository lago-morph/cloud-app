# Live pass v0.2.0 — analysis and cleanup

For the agent who analyses the live pass after the owner has run it (`live-pass-v0.2.0.md`). You work from the records alone; the owner describes nothing. You receive, in one message: the **records bucket and prefix** (`live-pass-records`, `runs/lp-<yyyymmdd>-<hhmmss>/`), the **account ID**, and the **analysis token** `live-pass-analysis`. Its eight permissions (API names; the dashboard says Edit for Write): Account API Tokens Write, Account Settings Read, D1 Write, OAuth Client Write, Secrets Store Write, Workers Observability Write, Workers R2 Storage Write, Workers Scripts Write. It reads every record and log, and deletes everything the run made.

Never print, log or commit the token. The records hold the owner's and the tester's emails and Cloudflare user IDs (the owner allowed that); they hold no token value.

## 1. Fetch the records

1. Keep the token in a file outside the repository, readable only by you, written once without echoing it, for example with your file-writing tool to `~/.live-pass-analysis-token` followed by `chmod 600 ~/.live-pass-analysis-token`. Every shell call below reads it from there.
2. Check the token (expect `true active`):
   ```bash
   ACC=<account ID>
   curl -sS -H "Authorization: Bearer $(cat ~/.live-pass-analysis-token)" "https://api.cloudflare.com/client/v4/accounts/$ACC/tokens/verify" | jq -r '"\(.success) \(.result.status)"'
   ```
3. Download every record with the runner (read-only; in a cloud session behind a proxy it sets `NODE_USE_ENV_PROXY=1` itself):
   ```bash
   LIVE_PASS_ADMIN_TOKEN="$(cat ~/.live-pass-analysis-token)" CLOUDFLARE_ACCOUNT_ID=<account ID> \
     node scripts/live-pass/live-pass.mjs download --run lp-<id> --to ~/live-pass-analysis/lp-<id>
   ```
   It prints how many files it wrote. Without `--run` it takes the newest run (`latest.json` at the bucket's root). Without the runner, list `GET /accounts/<A>/r2/buckets/live-pass-records/objects?prefix=runs/lp-<id>/&per_page=1000` (follow `result_info.cursor` while `is_truncated`) and fetch each `…/objects/<url-encoded key>`.

## 2. What each file holds

All times are UTC ISO strings; `NNN` is one sequence across the run, so sorting by file name orders everything in time. Every text passed the runner's scrubber: a known token shows as `[REDACTED:<variable name>]`, a pattern match as `[REDACTED]`, `[REDACTED:jwt]`, `[REDACTED:token-like]`, `[REDACTED:hex64]` or `[REDACTED:<field>]`.

| File | What it holds |
|---|---|
| `results.md`, `results.json` | Start here. Each step's result (`pass`, `fail`, `n/a`, `info`, `skipped`, or `in progress`/`not run` for an unfinished run), with the reason of an n/a or a skip; each check ID's result over the steps that tag it (fail beats pass beats info). |
| `state.json` | The runner's durable state, which is also the checkpoint between the sessions: `phase` (`session-1`, `checkpoint`, `session-2`, `finished`), `sessions` (start and end of each session and container), `done` (per step: result, end time, reason, per-check results), `pending` (a step in progress or waiting for the owner; its `record` is that step's evidence so far), `facts`. |
| `run.json` | The run's identity: bucket, prefix, account, release-candidate version asked for, app name (`livepass`), runner commit, sessions, and `facts`: subdomain, admin and auth app URLs, owner and tester (email, user ID, member ID, the tester's first role), OAuth client IDs, store ID, auth database ID, everyday token ID, signing token ID, the starter tokens' IDs, the U1 and U3 answers, the role-change time, the installed framework version. |
| `handover.json` | Bucket, prefix, account, the analysis token's permission groups and the link the owner used. |
| `steps/NNN-<step>.json` | One step: `expected` (the runbook's expectations), `observations` (`id`, `check`, `expected`, `observed`, `pass`: true, false, or null for a fact recorded without a verdict, `note`, `at`), `owner` (each prompt, when it was asked, the owner's reply word for word, when they answered), `commands` (the command records of the step), `notes`, `snapshot` (the snapshot taken after the step) and `snapshotDiff` (`added`, `removed`, `changed`, and `unreadable` sections), `observability` (each Worker's Workers Logs setting before the step's end and what the runner did). A step that blocked has an extra file per attempt with `result: "blocked"`, `attempt` and `error`. |
| `commands/NNN-<step>-<label>.json` | One command the runner ran: `argv`, `cwd`, `env` (which token variables were set, never their values), `startedAt`, `endedAt`, `durationMs`, `exitCode` (null when it could not start), `timedOut`, `stdout`, `stderr`, and `rawSecretHits`: which known token values the raw output contained before scrubbing. **Any non-empty `rawSecretHits` is a finding** (SETUP-REQ-007). |
| `snapshots/NNN-after-<step>.json` | The account after the step, read with the admin token: `account`, `members` (email, user ID, status, role names), `tokens` (name, ID, status, issue, change and expiry times, last use, permission group names and resources per policy), `oauthClients` (as listed; a secret field would be redacted), `workers` (each script: times, compatibility date and flags, bindings, observability, Worker secret names), `subdomain`, `d1`, `r2` (each bucket: object keys and sizes, lifecycle, CORS; for `sst-state` also the framework's `framework/*.json` records), `secretsStore` (stores; secret names, comments, status, times; the API returns no values). A section the token could not read holds `ok: false` and the error. |
| `api-calls.jsonl` | Every Cloudflare API call the runner made: time, which token (`admin`, `everyday`, `verify`, `pf-live-no-ssr`), method, path, status, duration. Bodies are never recorded. |
| `http.jsonl` | Every request to an app (`*.workers.dev`), npm and dash.cloudflare.com: method, URL, status, `location`, `set-cookie` (values redacted) and the first 2,000 characters of the body. |
| `events.jsonl` | The run's timeline: each runner invocation (command, session, phase, runner commit, Node version), each step's end and result, the owner's notes (`note`), environment warnings, runner errors with their stack. |
| `observability.jsonl` | After every step: each Worker's Workers Logs setting as found, and whether the runner turned it on. A Worker found off right after a framework deploy shows that the framework's upload resets the setting (S5 records this for the admin app). |
| `server/workers-logs-checkpoint.json`, `server/workers-logs-final.json` | Every Workers Logs event of the run up to the checkpoint and to the end, from the Workers Observability query API (`view: events`): the admin app's and the auth app's JSON log lines (`admin signed in`, `grant refused: …`, `sign-in refused: …`, `… failed`, `token revocation failed …`) and each invocation (URL, status, outcome, timing; the auth app's `AuthApp` RPC calls `redeem` and `role`). `windows` shows how the run's time was split to stay under the query limit. |
| `server/workers-logs/NNN-<step>.json` | The events the runner read while verifying one owner step (from a minute before the step to the check). |
| `server/log-bucket/<app>/<stage>/<yyyy>/<mm>/<dd>/<time>-<severity>-<requestId>.json` | Copies of the framework's own log entries (LOG-REQ-004) from `prototype-logs`: stage failures and app `log.write` calls, each with its request ID. |
| `server/auth-db-checkpoint.json`, `server/auth-db-final.json`, `server/auth-db/NNN-<step>.json` | The auth app's D1 rows: `users` (sub = Cloudflare user ID, email, role recorded at the last sign-in, time), `registry` (app, return URL), `codes` (without the code hash) and `sign_ins` (without state hash, PKCE verifier and nonce). |

The runner turned Workers Logs on for every Worker of the account (script settings, no redeploy) so the admin app's and the auth app's console lines were kept; that is the runner's doing, not the framework's. Workers Logs keeps events for 3 days on the Free plan: query again within that time if you need more than the records hold (`POST /accounts/<A>/workers/observability/telemetry/query`, body as in `scripts/live-pass/lib/server.mjs`).

## 3. How to analyse

1. Read `results.md`. A run that did not reach `finished` shows where it stopped: `state.json`'s `pending` holds the step's evidence so far, and `events.jsonl` the last invocations.
2. For each `fail`, open the step's file in `steps/`: the failed observations say what was expected and what was seen. Then follow the time: its commands (`commands/`), the HTTP and API calls in that window (`http.jsonl`, `api-calls.jsonl`), the Workers logs and the snapshot diff.
3. The observations with `pass: null` are facts to judge, not verdicts: U3 (does a deploy that binds a store secret need Secrets Store Read?), U1 (did the grant update the stand-in, `facts.u1`), F-3 (`id` or `database_id`), A-2 (the issuer string), C-1 (what the TTL picker set; compare `expires_on` with the time the owner made the token, from the token's `issued_on` in the snapshots), whether a framework upload keeps Workers Logs on, and the starter variables left set in session 2 (R1).
4. The owner's replies are word for word in each step's `owner` list. A reply other than `ok` (or the level or `updated`/`new` the prompt asked for) is what the owner saw differ; the API, database and log observations of the same step say what the account shows.
5. Settle each point as `live-pass-v0.2.0.md` section 6 and the table below say. Record what confirms or changes a decision or parameter in `ai/implementation/decisions/v020-live.md` (one `### <ID> — confirmed|changed by live check <check>` entry each; a change takes the next free ID per `docs/CONVENTIONS.md`).

| Check | What to change when it fails | Where |
|---|---|---|
| S1, S2, S4, C-1 | DEC-0681, DEC-0683, PAR-435 (and the TTL wording) | `decisions/v020-C.md`; `packages/framework/src/provision/cloudflare/cloudflare-setup.ts` |
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

Only after the download is complete (step 1.3 printed the file count, and `results.md` opens). The order matters: Workers before the D1 database and Secrets Store they bind, buckets emptied before they are deleted, the records bucket after the records are safe, and the analysis token last.

Each shell call starts with the same two lines:
```bash
ACC=<account ID>
cf() { curl -sS -H "Authorization: Bearer $(cat ~/.live-pass-analysis-token)" "https://api.cloudflare.com/client/v4/accounts/$ACC$1" "${@:2}"; }
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
6. **API tokens** other than the analysis token (`prototype-framework`, `prototype-r2-signing`, `live-pass-admin`, anything left from the run):
   ```bash
   ME=$(cf /tokens/verify | jq -r .result.id)
   for t in $(cf '/tokens?per_page=100' | jq -r --arg me "$ME" '.result[] | select(.id != $me) | .id'); do echo "$t $(cf "/tokens/$t" -X DELETE | jq -c .success)"; done
   ```
7. **The records bucket**, once your analysis no longer needs the bucket itself: empty and delete `live-pass-records` as in step 3.
8. **Check**: `cf /workers/scripts`, `cf /d1/database`, `cf /r2/buckets`, `cf /secrets_store/stores`, `cf /oauth_clients` and `cf /tokens` list nothing but the analysis token.
9. **Last, the analysis token deletes itself**: `cf "/tokens/$(cf /tokens/verify | jq -r .result.id)" -X DELETE | jq -c .success`. After this the token answers 401.

Left in the account, and not deletable with the token: its members (the tester; the owner removes them in Manage Account → Members), its `workers.dev` subdomain, and the Workers Logs history, which expires on its own. Tell the owner the cleanup is done and what remains.
