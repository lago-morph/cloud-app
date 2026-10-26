# Template app

This is the smallest app built on the prototype framework. It uses each capability once: database tables (notes, and one row per finalized upload), key-value storage, file upload with a finalize check and download, a configuration value (`greeting`), one secret (`apiKey`), a tested HMAC signing helper (`src/server/signing.ts`), log entries, and the three access levels (anonymous, user, admin). The scaffolder copies this folder to start a new app. A copied app has its own name: §1 step 2 prints it into `APP`, and the commands below use `$APP`. Where an address below says `template`, read the app's name instead.

This page lists everything the owner does by hand, as copy-and-paste steps. Run the commands in a terminal, in this app's folder, on macOS or Linux with Node 22.22.0. Replace the `<…>` parts. Never paste a secret value into a command line, a committed file or a chat.

**What is verified in this phase.** Local development (§1) is verified. Every Cloudflare step (§2–§9) is **not yet verified on Cloudflare in this phase**: the framework's cloud commands have run only against a simulated Cloudflare. The Google steps (§5) have never been run, because Google login is mocked in this phase. AWS is a future release: this release targets local and Cloudflare only.

## 1. Run it on your computer

1. Get the framework ready (once per checkout):
   - In the framework's own repository, run this at the repository root. The last line goes back to this app's folder:
     ```sh
     npm ci
     npm run build -w packages/framework
     cd apps/template
     ```
   - In an app made with the scaffolder, run `npm install` in the app's folder.
2. Print the app's name and keep it in `APP`. Run this again in each new terminal:
   ```sh
   APP=$(npm run --silent build -- --target local --stage local | sed -n 's/^built \([^ ]*\) for .*/\1/p'); echo "$APP"
   ```
3. Set the local value of the app's secret, which the admin page checks. `npm run dev` creates only the framework's own development keys, not the app's secrets. Run the command, paste any value, press Enter, then press Ctrl-D:
   ```sh
   npm run secrets -- set apiKey --target local --stage local
   ```
   The value is stored in `.dev.vars`, which git ignores.
4. Start the app, and open the address it prints (`http://localhost:<port>/`):
   ```sh
   npm run dev
   ```
   Locally you log in with the built-in mock login; no Google account is involved. Press Ctrl-C to stop.
5. Check everything before you call a change done:
   ```sh
   npm run verify
   ```
6. Read the local log. Entries are JSON lines, one file per UTC day:
   ```sh
   cat .logs/$(date -u +%F).log
   grep '<requestId>' .logs/$(date -u +%F).log
   ```
7. To start again from empty local data (the database, files and logs), run `npm run reset-local`. Your code, configuration and `.dev.vars` stay.

## 2. Cloudflare account and API token (once)

1. Sign up or log in at https://dash.cloudflare.com.
2. Copy your **Account ID**. Open Account home, choose your account, and copy the Account ID from its overview page. The Cloudflare dashboard menu names on this page are **not yet verified**.
3. Create an **account API token**: go to Manage Account → Account API Tokens → Create Token → Create Custom Token (not yet verified). Name it `prototype-framework`. Add these **Account** permissions:
   - Workers Scripts: Edit
   - Workers R2 Storage: Edit
   - D1: Edit
   - Account API Tokens: Edit (each stage gets its own file-signing token)

   Under Account Resources, include only your account. Create the token, then copy it. Cloudflare shows it only once. This permission list is the framework's reading of the calls it makes. It is not yet verified on Cloudflare in this phase. If `deploy` names a missing permission, add it to the token.
4. In every new terminal where you deploy, set both values. `read` keeps the token out of your shell history. Paste the token when it waits, then press Enter:
   ```sh
   export CLOUDFLARE_ACCOUNT_ID='<your Account ID>'
   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
   ```
5. Check the token. The output must contain `"success":true`:
   ```sh
   curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify"
   ```

If a command says it needs `NODE_USE_ENV_PROXY=1`, you are behind an HTTPS proxy. Put `NODE_USE_ENV_PROXY=1 ` in front of that command.

## 3. One-time account setup

```sh
npm run setup-account -- --target cloudflare
```

This creates the account's shared resources once: the log bucket `prototype-logs`, the deploy-state bucket `sst-state`, and the account's `workers.dev` address. Running it again changes nothing. `deploy` never creates them.

## 4. Deploy a test stage, test it, remove it

A stage whose name starts with `test-` is a test stage. It uses `config/cloudflare/test.json` and the mock login, and holds no real data. Stage names are at most 20 lowercase letters, digits and hyphens.

Set the stage name once, in the first line, and deploy. In a new terminal, set `STAGE` again:

```sh
STAGE=test-<initials><number>
npm run deploy -- --target cloudflare --stage "$STAGE"
```

On the first deploy, `deploy` stops after creating the Worker and names the secrets that are not set yet. Set each one, paste the value, press Enter, then press Ctrl-D. Then deploy again:

```sh
npm run secrets -- set apiKey --target cloudflare --stage "$STAGE"
npm run deploy -- --target cloudflare --stage "$STAGE"
```

A successful deploy prints the stage's address, `https://template-<stage>.<subdomain>.workers.dev`. Commit your work, because `smoke` refuses to run with uncommitted changes (if git says there is nothing to commit, carry on). Then run the smoke test against the stage, and remove the stage when you are done:

```sh
git add -A
git commit -m "Changes before the smoke test"
npm run smoke -- --target cloudflare --stage "$STAGE"
npm run remove -- --target cloudflare --stage "$STAGE"
```

`remove` deletes the stage's Worker and secrets, its databases, its file bucket and files, its file-signing token and its deploy state. It keeps the log entries. If it prints leftovers and exits with an error, run it again. If a leftover stays, delete it in the dashboard by the exact name printed.

## 5. Google login client (production stages only)

Production stages log in with Google. Nothing here is needed for local development or test stages. No Google client exists yet; these steps are written for later.

1. Print your `workers.dev` subdomain and the callback URL of the production stage. `APP` must be set (§1 step 2); the stage here is `prod`:
   ```sh
   STAGE=prod
   SUB=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!r.success){console.error(JSON.stringify(r.errors));process.exit(1)}console.log(r.result.subdomain)})'); echo "$SUB"
   echo "https://$APP-$STAGE.$SUB.workers.dev/api/auth/callback"
   ```
2. Open https://console.cloud.google.com, then create or choose a project.
3. Go to Google Auth Platform (older consoles call it "OAuth consent screen"). Set the app name and a support email, and choose the **External** audience. While the app is in **Testing**, only the Google accounts you add as test users can log in. The framework asks only for `openid` and `profile`.
4. Go to Clients (or APIs & Services → Credentials), then Create client (or Create credentials → OAuth client ID). Choose the application type **Web application**. Under **Authorized redirect URIs**, add the callback URL from step 1, one for each production stage. Create the client.
5. Copy the **Client ID**; §6 puts it in the stage's values file. It is not a secret.
6. The **Client secret** is a secret. Set it after the stage's first deploy (§7).

## 6. The production stage's values file

Every stage that does not start with `test-` is a production stage, for example `prod`. These commands create `config/cloudflare/prod.json`, check it, and commit it. Paste the Client ID from §5 step 5 into the first line, then run all the lines. `build` must print `built …`. Run this only once: it replaces the file, and with it any admins and users.

```sh
CLIENT_ID='<paste the Client ID>'; STAGE=prod
mkdir -p config/cloudflare
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({values:{},framework:{google:{clientId:process.argv[2]},admins:[]}},null,2)+"\n")' "config/cloudflare/$STAGE.json" "$CLIENT_ID"
npm run build -- --target cloudflare --stage "$STAGE"
git add "config/cloudflare/$STAGE.json"
git commit -m "Add the values file of stage $STAGE"
```

The file's `"values"` may also set the app's configuration keys, for example `"greeting": "Hi"`.

## 7. Deploy a production stage

```sh
STAGE=prod
npm run deploy -- --target cloudflare --stage "$STAGE"
npm run secrets -- set frameworkGoogleClientSecret --target cloudflare --stage "$STAGE"
npm run secrets -- set apiKey --target cloudflare --stage "$STAGE"
npm run deploy -- --target cloudflare --stage "$STAGE"
```

The first `deploy` stops and names the unset secrets. Set them as above, pasting each value and then pressing Ctrl-D, and deploy again. The second deploy prints `Google callback URL to register: …`. It must match the URL you added in §5 step 4.

To change the stage later (code, configuration, admins, users), commit the change and run the same `deploy` again:

```sh
git add -A
git commit -m "<what you changed>"
npm run deploy -- --target cloudflare --stage "$STAGE"
```

## 8. Admins and allowed users

1. The person opens `https://template-prod.<subdomain>.workers.dev`, logs in with Google, then opens `https://template-prod.<subdomain>.workers.dev/api/auth/me`.
2. They copy the value of `"id"`. If they see `"level":"anonymous"` with an `"unlistedId"`, they copy that value instead. It starts with `u_`. They send it to the owner.
3. The owner adds it to `config/cloudflare/prod.json`. Set `LIST=admins` to make the person an admin, or `LIST=users` to admit only known people. While `"users"` is present, a login on neither list is anonymous. Without `"users"`, every Google account that logs in counts as a user. Admins need not also be in `"users"`. Paste the ID into the first line, then run both lines; the last command prints the file:
   ```sh
   ID='<user ID>'; LIST=admins; OP=add; STAGE=prod
   node -e 'const fs=require("fs"),[f,op,list,id]=process.argv.slice(1),c=JSON.parse(fs.readFileSync(f,"utf8")),l=(c.framework[list]??[]).filter(x=>x!==id);c.framework[list]=op==="add"?[...l,id]:l;fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")' "config/cloudflare/$STAGE.json" "$OP" "$LIST" "$ID" && cat "config/cloudflare/$STAGE.json"
   ```
4. Check the file, commit it, and deploy again:
   ```sh
   npm run build -- --target cloudflare --stage "$STAGE"
   git add "config/cloudflare/$STAGE.json"
   git commit -m "Update admins and users"
   npm run deploy -- --target cloudflare --stage "$STAGE"
   ```

To take access away, run step 3 with `OP=remove`, then step 4.

## 9. Stop, start and remove

- **Stop or start** a stage in the dashboard (menu names not yet verified). Open Workers & Pages → `template-<stage>` → Settings → Domains & Routes, and disable or enable `workers.dev`. A stopped stage keeps its code, data and secrets, and its address answers 404. Every `deploy` starts the stage again.
- **Remove a test stage:** `npm run remove -- --target cloudflare --stage "$STAGE"`, with `STAGE` set to the test stage's name (§4).
- **Remove a production stage.** This deletes its database with no backup. Repeat the stage's name to confirm:
  ```sh
  npm run remove -- --target cloudflare --stage prod --confirm-production prod
  ```

## 10. Reading the logs on Cloudflare

Every error response has a `requestId`. A failed login returns to `/?authError=login_failed&requestId=<id>`. Each log entry is a file in the R2 bucket `prototype-logs`, under `template/<stage>/<yyyy>/<mm>/<dd>/`. The date is UTC, and the file name ends in `-<requestId>.json`.

- **Dashboard** (menu names not yet verified)**:** open Storage & databases → R2 → `prototype-logs`, then the folders `template` / `<stage>` / year / month / day. Open the file whose name ends in the request ID.
- **Command line:** list today's entries of a stage, and keep only the line with the request ID. `APP` must be set (§1 step 2):
  ```sh
  STAGE='<stage>'; DAY=$(date -u +%Y/%m/%d)
  curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/prototype-logs/objects?per_page=1000&prefix=$APP/$STAGE/$DAY/" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!r.success){console.error(JSON.stringify(r.errors));process.exit(1)}for(const o of r.result)console.log(o.key)})' \
    | grep '<requestId>'
  ```
  Then read that entry:
  ```sh
  KEY='<paste the key here>'
  curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/prototype-logs/objects/$(node -p 'encodeURIComponent(process.argv[1])' "$KEY")"
  ```
- **No entry?** Watch the Worker's output while you repeat the request: `npx wrangler tail "$APP-$STAGE" --format pretty`. More help is in the skill's troubleshooting reference, `skill/reference/troubleshooting.md` in the framework repository.

## 11. Cost: what stays billable while idle

Cloudflare charges for requests and storage. An idle stage has no requests, but its storage remains:

| Billable while idle | How to remove it |
| --- | --- |
| Each stage's D1 database and R2 file bucket | `remove` the stage (§9). |
| Leftover test stages: Workers named `template-test-…`, D1 databases `template-test-…-db-<n>` | `remove` each by its stage name. Check Workers & Pages and D1 in the dashboard (menu names not yet verified). |
| The shared `prototype-logs` bucket, which grows with every entry and is never emptied by `remove` | Delete old entries in the dashboard. To do it automatically, open R2 → `prototype-logs` → Settings → Object lifecycle rules (not yet verified), and delete objects after, for example, 30 days. |
| The shared `sst-state` bucket, which is small | Keep it while any stage exists. Delete it in the dashboard only after the last stage is removed. |

**Keeping test stages small.** On Cloudflare's free plan, D1 allows about **100,000 rows written per day** per account; reads have a larger limit. When a daily limit is used up, database requests fail until it resets at 00:00 UTC. So keep test data to a few rows, never load data in loops, run one test stage at a time, and remove it right after its smoke test. An account holds at most **10 D1 databases**, and a deploy that changes the schema briefly holds two per stage.
