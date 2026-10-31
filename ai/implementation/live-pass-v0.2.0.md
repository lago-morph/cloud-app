# Live pass — v0.2.0 runbook

The once-per-release live pass of plan `plan-v0.2.0-testing-auth.md` §7 "Live", which the run could not do (no token, owner away; owner question 1). The owner runs it by hand, top to bottom, in one sitting of about 90 minutes. It also settles every *unverified* point the run left behind (§3).

Rules: **never write a token value** in this file, a decision entry, a commit or a chat. Tokens live only in `apps/reference/.env.cloudflare` (git-ignored) and in shell variables (`$BOOT`, `$TOKEN`, `$NOSSR`). Record what you saw (status codes, error codes, names, counts) in the results table, §6. Anything that confirms or changes a DEC or PAR also goes in `ai/implementation/decisions/v020-live.md` (new file, one `### <ID> — confirmed|changed by live check <check>` entry each; a change takes a new ID from the spare range DEC-0790–0799 / PAR-485–499).

## 1. Preconditions

### 1.1 Merged first (in `main`, CI green)
1. **Staged workflows applied** (owner question 9, DEC-0637). On `v0.2.0/17-ci-no-duplicates` (#76): `cp scripts/ci/workflows/ci.yml scripts/ci/workflows/release.yml .github/workflows/ && git rm -r scripts/ci/workflows && git commit -m "Apply staged v0.2.0 workflows" && git push`. Then A's CI step #95 and E's #120 land on top of it.
2. **Every v0.2.0 PR in `ai/implementation/v0.2.0-pr-stack.md`**, merged bottom-up as that file says: A (#60–#84), B (40–47), C (#72 #73 #82 #86 #88), D (#74 #81 #83 #85 #92), E (#98–#125), F (#101–#103), the merge-only PRs (#94 #96 #107 #125), the T4/T7 fixes.
3. **Release blockers (owner question 39, DEC-0716): C `34a-remove-email-files` and E 57z (#121).** Do not start without both. Before 57z, page 2 strips Zone Read from a 0.1.x token while `cloudflare-setup`'s check still looks up the email zone; before 34a, a production deploy still runs the email-domain check (DEC-0553).
4. **Owner question 18 decided:** accept or reject the "Testers" amendment in #92 (DEC-0699). Accepted: the owner's admin-app steps below are tester steps under the rule. Rejected: SETUP-AC-011 and SKILL-AC-006 shrink to the agent's steps; record only those as their evidence.
5. No tag yet. V (#97, version bump) may be merged; tag only after §6 passes.

### 1.2 Accounts (plan §2.1a)
- One Cloudflare account; the Free plan is enough (plan §1). Secrets Store is on all plans (open beta).
- **Owner:** you, role "Super Administrator - All Privileges".
- **Tester:** a second person (or your second login) invited to the account with only **"HTTP Applications Read"**, invitation accepted, signed in in a separate browser profile or private window. In step S14 you briefly give them "Administrator".
- If the account has a token named `prototype-framework` that must not change (the owner's protected-token rule, SETUP-AC-011): **stop**. Page 2 updates every token of that name and has no protected-ID list (DEC-0715). Rename or retire it first, or skip U1.

### 1.3 Tools and shell
Git, Node 22 with npm, `curl`, `jq`, a text editor, a browser with a second profile. No Java or Docker.
```bash
git clone https://github.com/lago-morph/cloud-app.git && cd cloud-app && git checkout main && git pull
npm ci && npm run build -w packages/framework
cd apps/reference                                     # every command below runs here
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_BOOTSTRAP_TOKEN  # env beats .env.cloudflare
export CLOUDFLARE_ACCOUNT_ID=<account ID from the dashboard address bar>
cf() { curl -sS -H "Authorization: Bearer $TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID$1" "${@:2}"; }
git check-ignore -q .env.cloudflare && echo ignored   # must print "ignored"
```

## 2. Steps, in order

Each step: do it, compare with **Expected**, write the row in §6. A check ID (U1, C-1, …) means "run that check from §3 now".

**S1 — Long-lived bootstrap token is refused (SETUP-AC-011).** Open the bootstrap link, pick the account, leave **TTL empty**, Continue to summary, Create Token, copy:
```
https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22e086da7e2179491d91ee5f35b3ca210a%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%2250fc2f43318f40e4855a35d8de5bf643%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22adc8fa2bc6124928a8b3314dc63a1235%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%225bc3f8b21c554832afc660159ab75fa4%22%2C%22type%22%3A%22edit%22%7D%5D&name=prototype-framework-bootstrap
```
The page shows four permissions, all account-scoped: Workers Scripts Edit, OAuth Client Edit, Secrets Store Edit, Account API Tokens Edit. Put `CLOUDFLARE_BOOTSTRAP_TOKEN=<value>` in `.env.cloudflare` with the editor, then:
```bash
read -rsp 'Bootstrap token: ' BOOT; echo
npx prototype-framework cloudflare-setup 2>&1 | tee /tmp/pf-s1.log; echo "exit ${PIPESTATUS[0]}"
curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" -H "Authorization: Bearer $BOOT" | jq -c '{success, errors}'
grep -cF "$BOOT" /tmp/pf-s1.log; unset BOOT
```
**Expected:** "…: it has no expiry, and a bootstrap token may live 1 day at most. Setup deleted it at once and used it for nothing else.", the link again, exit 1; verify answers `success:false` (invalid token); the `grep -c` prints 0; the `.env.cloudflare` line is commented out.

**S2 — Bad paste (SETUP-AC-011).** `CLOUDFLARE_BOOTSTRAP_TOKEN=not-a-token npx prototype-framework cloudflare-setup; echo "exit $?"`. **Expected:** names `CLOUDFLARE_BOOTSTRAP_TOKEN`, says Cloudflare does not accept it, gives the bootstrap link; exit 1; nothing created.

**S3 — Bootstrap token, 1 day.** Same link; under **TTL set the end date to tomorrow**; create, copy, put it in `.env.cloudflare` (replace the commented line). `read -rsp 'Bootstrap token: ' BOOT; echo`. Run **C-1**.

**S4 — Bootstrap.**
```bash
npx prototype-framework cloudflare-setup 2>&1 | tee /tmp/pf-s4.log; echo "exit ${PIPESTATUS[0]}"
curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" -H "Authorization: Bearer $BOOT" | jq -c '{success}'
grep -cF "$BOOT" /tmp/pf-s4.log; grep -n BOOTSTRAP .env.cloudflare; unset BOOT
```
**Expected:** "OAuth clients: created prototype-framework-admin and prototype-framework-sign-in; their IDs and secrets are in Secrets Store", "admin app: deployed (Worker prototype-admin), bound to …", "the bootstrap token deleted itself", "commented out CLOUDFLARE_BOOTSTRAP_TOKEN in .env.cloudflare", "The Cloudflare bootstrap is complete.", `admin app: https://prototype-admin.<subdomain>.workers.dev`, exit 0. Verify: `success:false`. `grep -c`: 0. The bootstrap line is commented. Note the URL: `export ADMIN=https://prototype-admin.<subdomain>.workers.dev SUB=<subdomain>`.

**S5 — Bootstrap re-run (settles C-2's list fields and C-3).** Repeat S3 and S4 with a new 1-day token. **Expected:** "OAuth clients: prototype-framework-admin and prototype-framework-sign-in already exist, with their secrets in Secrets Store"; admin app redeployed; token deleted; exit 0. "created" again means the list or comment did not round-trip (C-2/C-3 fail) and the old clients were deleted and remade.

**S6 — Admin-app sign-in.** Open `$ADMIN`, press **Sign in with Cloudflare**. Consent shows client `prototype-framework-admin`, fixed rows Profile Information, User Details Read, Memberships Read; no optional toggles are expected, since the sign-in asks for none (record what you see). Approve. **Expected:** "Signed in as <your email>", links Account setup, Everyday token, Status, Clean up v0.1.x email, a Sign out button. Then the **tester**, in their own profile: same steps. **Expected:** 403 "Only an administrator of this Cloudflare account can use the admin app." and no session.

**S7 — Page 1, Account setup.** Account setup → **Continue at Cloudflare**. Consent offers five optional toggles (Workers Scripts, D1, Workers R2, Secrets Store, Account API Tokens; all write); keep all ticked. **Expected:** "The auth app is deployed at https://prototype-auth.<subdomain>.workers.dev, with its new D1 database.", one "Created …"/"… was already there." line per shared resource (log, state, backup buckets, lifecycle, subdomain), "Created the … signing … in Secrets Store." (or "Moved …" on a 0.1.x account, then "redeploy each deployed stage"), "Recorded account setup version 2.". Run **E-8** (release-blocking), **E-9**, **F-3**.

**S8 — Page 2, Everyday token (needs 57z).** First prepare U1: if the account has no 0.1.x token named `prototype-framework`, create one from the 0.1.x link (no TTL; 7 groups including 4 zone ones; delete first any `prototype-framework` token whose value you do not hold) and save its value as `CLOUDFLARE_API_TOKEN=<value>` in `.env.cloudflare`:
```
https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22e086da7e2179491d91ee5f35b3ca210a%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22bf7481a1826f439697cb59a20b22293e%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%2209b2857d1c31407795e75e3fed8617a1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%222d5b4b1f6c89487bb7184c2c1dcd3bf1%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22c8fed203ed3043cba015a93ad1616f1f%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%229c88f9c5bce24ce7af9a958ba9c504db%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%221b600d9d8062443e986a973f097e728a%22%2C%22type%22%3A%22read%22%7D%5D&name=prototype-framework
```
Then run **E-1** (unticked scope) and **U1** (the real run), then **U2**. Afterwards `.env.cloudflare` holds the working everyday token; load it:
```bash
export TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' .env.cloudflare)"
cf /tokens/verify | jq -c '{success, status: .result.status}'      # true, "active"
STORE=$(cf /secrets_store/stores | jq -r '.result[0].id')
```

**S9 — "continue prototype setup".** `npx prototype-framework cloudflare-setup; echo "exit $?"`. **Expected:** no question about an email domain; "account setup: current (setup version 2)", "everyday token: passed the quick check …", next step `npm run deploy -- --target cloudflare --stage test-first`; exit 0. Then run **A-1** (role string, part a), **A-2**, **C-3**, **C-4**, **E-2**, **F-6**, **U3**, **F-7**.

**S10 — Page 3, Status.** Status → Continue at Cloudflare (three optional toggles, keep ticked). **Expected:** sections Workers (`prototype-admin`, `prototype-auth` deployed), Account setup (version 2, framework version, applied time), Registered apps (none yet), Recent sign-ins (none yet); no section shows a warning. Optional: **E-10** (cleanup page).

**S11 — Test stage.** `npx prototype-framework deploy --target cloudflare --stage test-live; echo "exit $?"`. **Expected:** exit 0, prints `https://reference-test-live.<subdomain>.workers.dev`. Open it, press **Log in**: mock login, "Logged in as … (user)". No auth app involved (plan §4.3).

**S12 — Production stage `prodcheck`.** If it exists from 0.1.x, first run the "before" line of **F-5**. Then:
```bash
npx prototype-framework deploy --target cloudflare --stage prodcheck 2>&1 | tee /tmp/pf-s12.log; echo "exit ${PIPESTATUS[0]}"
export APP=https://reference-prodcheck.$SUB.workers.dev
R=$(jq -rn --arg u "$APP/api/auth/callback" '$u|@uri')
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://prototype-auth.$SUB.workers.dev/start?app=reference-prodcheck&return=$R&state=x"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://prototype-auth.$SUB.workers.dev/start?app=reference-prodcheck&return=https%3A%2F%2Fexample.com%2Fapi%2Fauth%2Fcallback&state=x"
```
**Expected:** exit 0; the registered return gets `302 https://dash.cloudflare.com/oauth2/auth?…`; the foreign one `400` with no redirect. Run **F-1**, **F-4**, **F-5**.

**S13 — Real sign-ins.** Owner: open `$APP`, **Log in**. Consent shows client `prototype-framework-sign-in`, fixed rows only. **Expected:** back on `$APP`, "Logged in as u_… (admin)"; `$APP/api/auth/me` shows `"level":"admin"`. Tester, own profile: **Expected** `(user)` and `"level":"user"`. Then run **F-8** as the owner.

**S14 — Role refresh (PAR-425 = 300 s, owner question 25).** Tester stays signed in. Owner: dashboard → Manage account → Members → the tester → change role to **Administrator**. Wait 6 minutes. Tester reloads `$APP/api/auth/me` with DevTools → Network open. **Expected:** still `"level":"user"`, the response carries a new `set-cookie: __Host-session=…` (the refresh ran and succeeded; the auth app answers the role saved at the last sign-in). Tester presses **Log out**, then **Log in**. **Expected:** `(admin)`: this is **A-1 part b**. Owner sets the tester back to "HTTP Applications Read"; tester logs out and in. **Expected:** `(user)`.

**S15 — Sign-out.** Owner on `$APP`: **Log out**. **Expected:** "You are not logged in.", `$APP/api/auth/me` shows `"level":"anonymous"`, no `__Host-session` cookie. Admin app: **Sign out** → the sign-in page. The Cloudflare dashboard session stays (no `end_session` link, DEC-0660).

**S16 — Page 3 again.** **Expected:** Registered apps lists `reference-prodcheck` → `$APP/api/auth/callback`; Recent sign-ins lists the owner (admin) and the tester (user). This is **E-4**.

**S17 — Remove.** Removes the probe stage and `prodcheck` (the next `npm run compliance -- --target cloudflare` run redeploys it; skip the second line to keep it):
```bash
npx prototype-framework remove --target cloudflare --stage test-live; echo "exit $?"
npx prototype-framework remove --target cloudflare --stage prodcheck --confirm-production prodcheck; echo "exit $?"
curl -sS -o /dev/null -w '%{http_code}\n' "https://prototype-auth.$SUB.workers.dev/start?app=reference-prodcheck&return=$R&state=x"
cf /workers/scripts | jq -r '.result[].id' | grep -E -- '-test-' || echo "no test- stages"
```
**Expected:** both exit 0; `/start` now `400` (registry cleared, DEC-0725); for every `<app>-test-<id>` Worker still listed, run `npx prototype-framework remove --target cloudflare --stage test-<id>` from that app's folder (`apps/<app>`, with `.env.cloudflare` copied there) until the last line prints "no test- stages". Then do §5's deletions.

## 3. Checks of the unverified points

Each check: run, compare, record in §6, and in `decisions/v020-live.md` when it settles a DEC/PAR. §4 says what to change when one fails.

### 3.1 Plan §5.2 page 2 (all three) and the role string
- **U1 (E-5): can the grant update a token it did not create?** On Everyday token → Continue at Cloudflare, all ticked. **Expected, either:** "The existing everyday token was updated in place …; its value did not change" with "Removed (only v0.1.x email code used them): Email Sending Read, Zone Read, Analytics Read, Email Routing Rules Read" → **yes**; or "Cloudflare did not let this sign-in change the existing everyday token, so a new one was created …" → **no**: copy the shown value into `.env.cloudflare` as `CLOUDFLARE_API_TOKEN`, then press "I have saved the new token: delete the old one", approve, expect "Deleted 1 old everyday token(s)." Record which.
- **U2 (E-6/E-7): does each scope cover its group, and does the token hold exactly four?** If U1 said "updated", also test creation: dashboard → Manage account → Account API Tokens → delete `prototype-framework`, run page 2 again, expect "The everyday token `prototype-framework` was created with exactly these permissions", save the shown value. A create or update refused with code 1001 ("does not include the scopes required") names an uncovered group. Then in Account API Tokens open `prototype-framework`. **Expected:** exactly Workers Scripts Edit, Workers R2 Storage Edit, D1 Edit, Secrets Store Read; resource: this account; no zone. And each group answers with `$TOKEN`:
  ```bash
  for p in /workers/scripts /r2/buckets /d1/database /secrets_store/stores; do echo "$p $(cf $p -o /dev/null -w '%{http_code}')"; done   # four 200s
  ```
- **U3 (also F-2): does a deploy with a Secrets Store binding need Secrets Store Read?** Make a 1-day token with the three other groups only, name `pf-live-no-ssr` (TTL tomorrow), and probe an upload that binds a store secret:
  ```
  https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22e086da7e2179491d91ee5f35b3ca210a%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22bf7481a1826f439697cb59a20b22293e%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%2209b2857d1c31407795e75e3fed8617a1%22%2C%22type%22%3A%22edit%22%7D%5D&name=pf-live-no-ssr
  ```
  ```bash
  read -rsp 'pf-live-no-ssr token: ' NOSSR; echo
  printf 'export default { fetch() { return new Response("ok"); } };\n' > /tmp/pf-probe.js
  probe() { curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/pf-live-probe" \
    -H "Authorization: Bearer $NOSSR" -F "metadata={\"main_module\":\"pf-probe.js\",\"compatibility_date\":\"2026-10-01\",\"bindings\":$1};type=application/json" \
    -F "pf-probe.js=@/tmp/pf-probe.js;type=application/javascript+module" | jq -c '{success, errors}'; }
  probe "[{\"type\":\"secrets_store_secret\",\"name\":\"PROBE\",\"store_id\":\"$STORE\",\"secret_name\":\"PROTOTYPE_ADMIN_CLIENT_ID\"}]"
  probe '[]'                                            # control: the token can upload at all
  cf /workers/scripts/pf-live-probe -X DELETE | jq -c '{success}'
  ```
  **Record:** first probe `success:true` → Secrets Store Read is **not** needed at deploy (it stays in the set for the setup check, plan §5.2); `success:false` with the control `true` → it **is** needed. Keep `$NOSSR` for F-7, then delete `pf-live-no-ssr` in Account API Tokens and `unset NOSSR`.
- **A-1 (PAR-413): the "Administrator" role string.** Part a:
  ```bash
  curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/roles" -H "Authorization: Bearer $TOKEN" \
    | jq -r '.success, (.errors[]? | "\(.code) \(.message)"), (.result[]?.name)'
  ```
  **Expected:** `true` and the role names; one of them is exactly `Administrator`, as PAR-413 lists it beside "Super Administrator - All Privileges". If the everyday token is refused (it has no Account Settings Read), make a 1-day custom token with only Account → Account Settings → Read, rerun with it, and delete it. Part b is S14: a tester holding only "Administrator" signs in as admin. Record the exact string.

### 3.2 Remaining items from the progress file
- **A-2 (DEC-0653): Cloudflare's issuer string.** `curl -sS https://dash.cloudflare.com/.well-known/openid-configuration | jq -r .issuer`. Record it (the auth app does not compare it yet).
- **C-1 (PAR-435, DEC-0681): what the TTL picker sets.** Before S4:
  ```bash
  curl -sS "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" -H "Authorization: Bearer $BOOT" | jq -r '.result.status, .result.expires_on'; date -u +%FT%TZ
  ```
  **Expected:** `active`, and `expires_on` at most 24 h after now. Record the picked date, `expires_on` and now. If it is more than 24 h away, S4 deletes the token at once: record that, make a new one with **today** as the end date, and redo S3.
- **C-2 (DEC-0684): OAuth client fields.** S4's "created" line proves the answer held `client_id` and `client_secret`. S6 proves `name`, `scopes`, `response_types` and `client_secret_post` (the consent names the client; the ID token arrives); S7 succeeding proves `optional_scopes`, because Cloudflare refuses a scope the client does not offer. S5's "already exist" proves the list's `client_id`/`name`. If S5 said "created", it also exercised `DELETE …/oauth_clients/<id>`.
- **C-3 (DEC-0685, PAR-437): Secrets Store comment and store-create.**
  ```bash
  cf "/secrets_store/stores/$STORE/secrets?per_page=100" | jq -r '.result[] | "\(.name)\t\(.comment)"'
  ```
  **Expected:** `PROTOTYPE_ADMIN_CLIENT_ID` and `PROTOTYPE_ADMIN_CLIENT_SECRET` carry the same non-empty comment (the admin client's ID); the two `PROTOTYPE_SIGNIN_*` share another. Store-create: `cf /secrets_store/stores | jq -r '.result[].name'`. Only `prototype-framework` (PAR-437) listed means the bootstrap created it: pass. Another, older store means the account had one (plan §2.1b): n/a.
- **C-4 and E-2 (DEC-0686, DEC-0711, DEC-0720): the admin app upload made with the bootstrap token.**
  ```bash
  cf /workers/scripts/prototype-admin/settings | jq -c '.result | {compatibility_flags, bindings: [.bindings[] | {type, name}]}'
  ```
  **Expected:** `nodejs_compat`; `ADMIN_CLIENT_ID` and `ADMIN_CLIENT_SECRET` as `secrets_store_secret` (C-4); `ADMIN_ACCOUNT_ID` and `ADMIN_APP_ORIGIN` as `plain_text` (E-2). S6 working proves the bundle runs.
- **E-1 (DEC-0714): the token answer's `scope` leaves out unticked scopes.** On Everyday token → Continue at Cloudflare, **untick Secrets Store** and approve. **Expected:** "Nothing was done: at Cloudflare these permissions were not granted, and this step needs them: `secrets-store.read`" and no token changed. A "That step failed: … 1001/9109" page instead means `scope` was absent or listed unticked scopes.
- **E-4 (DEC-0717): D1 query answer shape with a grant token.** S16: both D1 sections show rows, not a warning.
- **E-8 (DEC-0719, PAR-447) — RELEASE-BLOCKING FOR PAGE 1: does `workers-r2.write` cover the signing token's group ("Workers R2 Storage Bucket Item Write")?** S7 **Expected:** the signing line appears and "Recorded account setup version 2.". A "That step failed: creating … signing … 400 … 1001" page after the auth app line means **no**: do not release; follow §4. Then in Account API Tokens open `prototype-r2-signing` and record its permission groups.
- **E-9 and F-3 (DEC-0719, DEC-0725): the auth app upload and the D1 field name.**
  ```bash
  cf /workers/scripts/prototype-auth/settings | jq -c '.result.bindings[] | {type, name, id, database_id}'
  ```
  **Expected:** `DB` as `d1`; record whether it carries `id` or `database_id` (F-3); `AUTH_APP_CLIENT_ID`/`_SECRET` as `secrets_store_secret`; `AUTH_APP_ACCOUNT_ID`/`AUTH_APP_ORIGIN` as `plain_text`.
- **E-10 (DEC-0718): R2 object and bucket deletes with a grant token.** If `cf /r2/buckets | jq -r '.result.buckets[].name' | grep -x prototype-mailsink` prints nothing, make a stand-in: `cf /r2/buckets -X POST -H 'content-type: application/json' -d '{"name":"prototype-mailsink"}'` and `cf /r2/buckets/prototype-mailsink/objects/probe.txt -X PUT --data-binary probe`. Only on an account with no 0.1.x app still sending mail: Clean up v0.1.x email → Continue at Cloudflare. **Expected:** "Deleted the Worker …" or "… was already gone.", "Deleted the R2 bucket prototype-mailsink and its 1 stored test messages." (or more), and the dashboard steps.
- **F-1 (DEC-0726): Pulumi `service` binding with `entrypoint`.** `cf /workers/scripts/reference-prodcheck/settings | jq -c '.result.bindings[] | select(.name=="AUTH")'`. **Expected:** `{"type":"service",…,"service":"prototype-auth","entrypoint":"AuthApp"}`; S13 then proves `redeem` over it.
- **F-4 (DEC-0725): D1 `/query` on the auth app's DB with the everyday token.**
  ```bash
  DB=$(cf '/d1/database?name=prototype-auth' | jq -r '.result[0].uuid')
  cf "/d1/database/$DB/query" -X POST -H 'content-type: application/json' -d '{"sql":"SELECT app, return_url FROM registry"}' | jq -c '.result[0].results'
  ```
  **Expected:** a row `reference-prodcheck` → `$APP/api/auth/callback` (deploy wrote it with this token).
- **F-5 (DEC-0727): delete-then-bind on a live Worker.** Before S12, only if `prodcheck` exists from 0.1.x: `cf /workers/scripts/reference-prodcheck/secrets | jq -r '.result[].name' | grep R2`. **Expected** `SECRET_FRAMEWORK_R2_ACCESS_KEY_ID` and `…_SECRET_ACCESS_KEY` as Worker secrets. After S12: the same line prints nothing, and the settings call of F-1 lists both names as `secrets_store_secret`. Without a 0.1.x `prodcheck`, record "n/a: no Worker secret to switch". The switch back to Worker secrets needs a failing Secrets Store and is not checked here (§6 note).
- **F-6 (DEC-0729): the signing entries' comment.** In C-3's listing, `PROTOTYPE_R2_ACCESS_KEY_ID` and `PROTOTYPE_R2_SECRET_ACCESS_KEY` carry the same comment, the ID of `prototype-r2-signing` (Account API Tokens shows it).
- **F-7 (DEC-0729): what a store listing answers without Secrets Store.** With `$NOSSR` from U3:
  ```bash
  curl -sS -o /tmp/pf-ss.json -w '%{http_code}\n' "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/secrets_store/stores" -H "Authorization: Bearer $NOSSR"; jq -c '.errors' /tmp/pf-ss.json
  ```
  **Expected:** 403 with an error code (10000 was seen for D1/R2 in §2.1a). Record status and code.
- **F-8 (DEC-0729): a store-bound stage signs R2 tickets.** S13, owner on `$APP`: in the Photos part choose a small image, **Upload** → "Uploaded."; open it from the list → it loads.

## 4. If a check fails

DEC and PAR entries are drafted in `ai/implementation/decisions/v020-<item>.md`; once I1/I2 have run they also live in `docs/decisions/decision-log.md` and `docs/parameters/parameters.md`. Change both, and the code named.

| Check | Change | Where |
|---|---|---|
| S1, S2, S4, C-1 | DEC-0681, DEC-0683, PAR-435 (and the TTL wording `PAGE_CHOICES`) | `decisions/v020-C.md`; `packages/framework/src/provision/cloudflare/cloudflare-setup.ts` |
| S5, C-2 | DEC-0684 (create body, list fields, re-run rule) | `decisions/v020-C.md`; `provision/cloudflare/oauth-clients.ts` |
| C-3 | DEC-0685, PAR-436, PAR-437 | `decisions/v020-C.md`; `provision/cloudflare/secrets-store.ts`, `oauth-clients.ts` |
| C-4, E-2 | DEC-0686, DEC-0711, DEC-0720 | `decisions/v020-C.md`, `v020-E.md`; `provision/cloudflare/admin-app-deploy.ts` |
| S6 | DEC-0710, PAR-413 (admin gate) | `decisions/v020-E.md`; `admin-app/grant.ts` |
| E-1 | DEC-0714 | `decisions/v020-E.md`; `admin-app/grant.ts` |
| U1 | DEC-0715 (fallback becomes the normal path if "no"); plan §5.2 page 2 | `decisions/v020-E.md`; `provision/cloudflare/everyday-token.ts` |
| U2 | DEC-0715, PAR-447 `everyday` row, admin client scopes (DEC-0684) | `decisions/v020-E.md`, `v020-C.md`; `admin-app/scopes.ts`, `provision/cloudflare/oauth-clients.ts` (`ADMIN_OPTIONAL_SCOPES`) |
| U3 | DEC-0727; plan §5.2 page 2's "why" for Secrets Store Read (the set stays) | `decisions/v020-F.md`; `plan-v0.2.0-testing-auth.md` §5.2 |
| E-8 | DEC-0719, PAR-447 `setup` row, DEC-0684 `ADMIN_OPTIONAL_SCOPES` (find the covering scope with the call below the table) | `decisions/v020-E.md`, `v020-C.md`; `admin-app/scopes.ts`, `provision/cloudflare/oauth-clients.ts` |
| E-9, F-3 | DEC-0719 (upload), DEC-0725 (`id` vs `database_id`) | `decisions/v020-E.md`, `v020-F.md`; `provision/cloudflare/auth-app-deploy.ts`, `worker.ts` |
| E-4, S10, S16 | DEC-0717, PAR-448 | `decisions/v020-E.md`; `admin-app/status-page.ts` |
| E-10 | DEC-0718, PAR-449 | `decisions/v020-E.md`; `admin-app/cleanup-page.ts` |
| A-1 | PAR-413 (exact strings), DEC-0652 | `decisions/v020-A.md`; `packages/framework/src/auth-app/params.ts` (`ADMIN_ROLE_NAMES`) |
| A-2 | DEC-0653 (add the issuer comparison) | `decisions/v020-A.md`; `auth-app/upstream.ts` |
| S12, F-1 | DEC-0726 (else the script-upload fallback) | `decisions/v020-F.md`; `provision/cloudflare/sst.ts` |
| F-4, S17 | DEC-0725 (registry write and clear) | `decisions/v020-F.md`; `provision/cloudflare/worker.ts`, `target.ts` |
| F-5 | DEC-0727 | `decisions/v020-F.md`; `provision/cloudflare/sst.ts`, `worker.ts` |
| F-6, F-7, F-8 | DEC-0729, PAR-455 | `decisions/v020-F.md`; `provision/cloudflare/r2-token.ts` |
| S13, S14 | DEC-0668, DEC-0669, PAR-425–427; owner question 25 | `decisions/v020-B.md`; `packages/framework/src/auth/role-refresh.ts` |
| S15 | DEC-0660 (`end_session`), AUTH-REQ-006 | `decisions/v020-A.md`; `docs/components/auth.md` |
| S9 | DEC-0716 (57z), C 34a | `decisions/v020-E.md`, `v020-C.md`; `provision/cloudflare/cloudflare-setup.ts` |

E-8's covering scope (the scope list's shape is unrecorded, so the filter is loose):
```bash
curl -sS https://api.cloudflare.com/client/v4/oauth/scopes -H "Authorization: Bearer $TOKEN" | jq '.result[]? | select(tostring | test("r2"; "i"))'
```
Add that scope to `ADMIN_OPTIONAL_SCOPES` and PAR-447's `setup` row. An existing admin client keeps its old scopes, so delete `PROTOTYPE_ADMIN_CLIENT_ID` in Secrets Store (dashboard) before the next bootstrap: the bootstrap then replaces the client. Re-run S3, S4, S6, S7.

## 5. Cost and cleanup

**Created and kept** (this is the account setup itself; all within Free-plan allowances at this scale): OAuth clients `prototype-framework-admin` and `prototype-framework-sign-in`; Workers `prototype-admin` and `prototype-auth`; D1 `prototype-auth`; R2 buckets `prototype-logs`, `sst-state`, `prototype-backups`; six Secrets Store entries (`PROTOTYPE_ADMIN_CLIENT_ID/_SECRET`, `PROTOTYPE_SIGNIN_CLIENT_ID/_SECRET`, `PROTOTYPE_R2_ACCESS_KEY_ID/_SECRET_ACCESS_KEY`); API tokens `prototype-framework` and `prototype-r2-signing`.

**Can bill** if usage grows: R2 storage and operations past the free tier (the three account buckets, and each stage's `<app>-<stage>-files`), D1 storage past the free tier, Workers requests past the free daily limit. Stages hold data and cost until removed.

**Removed by the pass:** both bootstrap tokens (self-deleted), stages `test-live` and `prodcheck` (S17), the probe Worker `pf-live-probe` (U3), the stand-in `prototype-mailsink` (E-10). **Delete by hand:** `pf-live-no-ssr` and any Account Settings Read token from A-1 (Account API Tokens → … → Delete), and local files:
```bash
rm -f /tmp/pf-s1.log /tmp/pf-s4.log /tmp/pf-s12.log /tmp/pf-probe.js /tmp/pf-ss.json; unset TOKEN NOSSR BOOT
cf /workers/scripts | jq -r '.result[].id'           # expect only prototype-admin, prototype-auth (+ your own apps)
cf /tokens -o /dev/null -w '%{http_code}\n'           # 403 is fine: the everyday token cannot list tokens; check in the dashboard instead
```
**Full teardown** (not normally wanted; it undoes the account setup): with a temporary token holding the bootstrap permissions plus D1 Write and Workers R2 Storage Write, `DELETE /accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/prototype-admin` and `…/prototype-auth`, `DELETE …/d1/database/$DB`, then in the dashboard delete the two OAuth clients, the six Secrets Store entries, the three buckets (empty first) and the two tokens.

## 6. Results

Fill in during the pass. Result: `pass`, `fail` or `n/a`, plus what you saw (codes, names; never a value). Decision: the `v020-live.md` entry, if any.

| ID | What | Result | Seen | Decision |
|---|---|---|---|---|
| S1 | Long-lived bootstrap token deleted at once | | | |
| S2 | Bad paste names the setting | | | |
| S3 | 1-day bootstrap token made | | | |
| S4 | Bootstrap: clients, admin app, self-delete, no value in output | | | |
| S5 | Re-run keeps both clients | | | |
| S6 | Admin sign-in: owner admitted, tester refused | | | |
| S7 | Page 1 complete, setup version 2 | | | |
| S8 | Page 2 done, everyday token saved | | | |
| S9 | "continue prototype setup" exits 0 | | | |
| S10 | Page 3 before sign-ins | | | |
| S11 | Test stage with mock login | | | |
| S12 | Production deploy; `/start` registered vs foreign | | | |
| S13 | Owner admin, tester user | | | |
| S14 | Refresh keeps saved role; re-sign-in shows Administrator as admin | | | |
| S15 | Sign-out | | | |
| S16 | Page 3 after sign-ins | | | |
| S17 | Remove; registry cleared; no `test-` stages | | | |
| U1 | E-5 grant updates a token it did not create | | | |
| U2 | E-6/E-7 scopes cover groups; exactly four | | | |
| U3 | Secrets Store Read needed at deploy (F-2) | | | |
| A-1 | "Administrator" role string vs PAR-413 | | | |
| A-2 | Issuer string | | | |
| C-1 | TTL picker `expires_on` | | | |
| C-2 | OAuth client create/answer/list fields | | | |
| C-3 | Secrets Store comment; store-create | | | |
| C-4 | Upload with `secrets_store_secret` by bootstrap token | | | |
| E-1 | Unticked scope left out of `scope` | | | |
| E-2 | Admin app `plain_text` + `nodejs_compat` | | | |
| E-4 | D1 query answer shape | | | |
| E-8 | **Release-blocking (page 1):** `workers-r2.write` covers the signing group | | | |
| E-9 | Auth app upload, `d1` + `plain_text` | | | |
| E-10 | R2 object and bucket deletes | | | |
| F-1 | `service` binding with `entrypoint` | | | |
| F-3 | Settings D1 field `id` or `database_id` | | | |
| F-4 | D1 `/query` with the everyday token | | | |
| F-5 | Delete-then-bind (switch back not checked) | | | |
| F-6 | Signing entries' comment | | | |
| F-7 | Store listing status without Secrets Store | | | |
| F-8 | Store-bound stage signs R2 tickets | | | |

Not checkable in this pass: C-3's store-create (the account already has a store) and F-5's fallback to Worker secrets (needs a Secrets Store failure). Both stay *unverified* in DEC-0685 and DEC-0727.
