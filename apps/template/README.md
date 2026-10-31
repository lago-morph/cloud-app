# Template app

This is the smallest app built on the prototype framework. It uses each capability once: database tables (notes, and one row per finalized upload), key-value storage, file upload with a finalize check and download, a configuration value (`greeting`), one secret (`apiKey`), a tested HMAC signing helper (`src/server/signing.ts`), log entries, and the three access levels (anonymous, user, admin). The scaffolder copies this folder to start a new app. A copied app has its own name: §1 step 2 prints it into `APP`, and the commands below use `$APP`. Where an address below says `template`, read the app's name instead.

This page lists everything the owner does by hand, as copy-and-paste steps. Run the commands in a terminal, in this app's folder, on macOS or Linux with Node 22.22.0. Replace the `<…>` parts. Never paste a secret value into a command line, a committed file or a chat.

This release runs apps locally (§1) and on Cloudflare (§2 on). The short version of everything here is the framework's [QUICKSTART.md](https://github.com/lago-morph/cloud-app/blob/main/QUICKSTART.md).

People sign in with Cloudflare. **Only members of the owner's Cloudflare account can sign in**, and every member is a user. Members with the account role "Super Administrator - All Privileges" or "Administrator" are admins (§8). Nothing about people is kept in configuration.

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
3. The app's secret `apiKey`, which the admin page checks, needs a local value. An app made with `npm create @lago-morph/prototype-app` already has a random one, set when it was made (and `npm run cloudflare-setup` sets any that is missing). `npm run dev` generates only the framework's own development keys. To set or change the value yourself (in the framework's repository, do this once), run the command, paste any value, press Enter, then press Ctrl-D:
   ```sh
   npm run secrets -- set apiKey --target local --stage local
   ```
   The value is stored in `.dev.vars`, which git ignores.
4. Start the app, and open the address it prints (`http://localhost:<port>/`):
   ```sh
   npm run dev
   ```
   Press Ctrl-C to stop. Locally there is no real sign-in: the login button signs you in as a test user. Tests choose any level with the authentication mock.
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

## 2. Cloudflare setup (once per account)

Any Cloudflare account works, on the free Workers plan too; no domain is needed. Run, in this app's folder (in Claude Code, say "set up Cloudflare"):

```sh
npm run cloudflare-setup
```

1. It prints one pre-filled dashboard link, for the **bootstrap token**, and where to put it (`.env.cloudflare` in this folder, or the environment). Make the token with an end date under TTL **no more than 1 day away**, put it there, and run the command again.
2. It deploys the account's **admin app**, deletes the bootstrap token, and prints the admin app's address.
3. Open the admin app and sign in with your Cloudflare account (you need the role "Super Administrator - All Privileges" or "Administrator"). Do **Account setup**, then make the **Everyday token** and save it as `CLOUDFLARE_API_TOKEN`, as in step 1. The page shows it once; never paste it into a chat.
4. Run `npm run cloudflare-setup` again (in Claude Code, "continue prototype setup") until it says everything is set up.

Coming from framework 0.1.x: `npm run upgrade` says setup needs re-running; do steps 1–4 once per account. Everyone signs in again, with Cloudflare (QUICKSTART, "Coming from 0.1.x?").

It never prints a token value, and every later command reads the tokens itself. The steps, and what to do when it stops: [QUICKSTART.md](https://github.com/lago-morph/cloud-app/blob/main/QUICKSTART.md) and the skill's `reference/owner-tasks.md` §2 (in this app, `.claude/skills/prototype-framework/reference/owner-tasks.md`).

## 3. What the account setup creates

The admin app's Account setup page creates the account's shared resources once: the **auth app**, which signs people in to every app, with its database; the log bucket `prototype-logs`; the deploy-state bucket `sst-state`; the backup bucket `prototype-backups` (a removed production stage's data, kept 30 days); and the file-signing credential every stage uses. `deploy` never creates these resources; if any is missing, it says so.

## 4. Deploy a test stage, test it, remove it

A stage whose name starts with `test-` is a test stage. It uses `config/cloudflare/test.json`, has only the mock login for tests, and holds no real data. Stage names are at most 20 lowercase letters, digits and hyphens.

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

`remove` deletes the stage's Worker and secrets, its databases, its file bucket and files, and its deploy state. The file-signing credential belongs to the account and stays. It keeps the log entries. If it prints leftovers and exits with an error, run it again. If a leftover stays, delete it in the dashboard by the exact name printed.

## 5. The production stage's values file

Every stage that does not start with `test-` is a production stage, for example `prod`. It needs its own committed values file. Copy the skill's template (in the framework's repository: `skill/templates/production-stage.json`):

```sh
STAGE=prod
mkdir -p config/cloudflare
cp ../../skill/templates/production-stage.json "config/cloudflare/$STAGE.json"
npm run build -- --target cloudflare --stage "$STAGE"
git add "config/cloudflare/$STAGE.json"
git commit -m "Add the values file of stage $STAGE"
```

`build` must print `built …`. The file's `"values"` may also set the app's configuration keys, for example `"greeting": "Hi"`. It holds no admins and no login settings.

## 6. Deploy a production stage

```sh
STAGE=prod
npm run deploy -- --target cloudflare --stage "$STAGE"
npm run secrets -- set apiKey --target cloudflare --stage "$STAGE"
npm run deploy -- --target cloudflare --stage "$STAGE"
```

The first `deploy` stops and names the unset secrets. Set them as above, pasting each value and then pressing Ctrl-D, and deploy again. The framework generates its own keys. The second deploy registers the stage with the auth app and prints its address. Without the account's auth app it stops before creating anything: do the admin app's Account setup (§2) first.

To change the stage later (code or configuration), commit the change and run the same `deploy` again:

```sh
git add -A
git commit -m "<what you changed>"
npm run deploy -- --target cloudflare --stage "$STAGE"
```

## 7. Sign in

1. Open `https://template-prod.<subdomain>.workers.dev/` and press the login button.
2. Sign in on Cloudflare's page with a member of the account, and allow what it asks.
3. Back on the app, `https://template-prod.<subdomain>.workers.dev/api/auth/me` shows `"level":"user"` or `"level":"admin"`.

To let someone sign in, invite them to the Cloudflare account (Manage Account → Members); a read-only role, for example "HTTP Applications Read", is enough. `npm run check-login -- --target cloudflare --stage "$STAGE"` checks, with no sign-in, that the stage sends people to the auth app with its own address.

## 8. Admins

A member whose Cloudflare account role is "Super Administrator - All Privileges" or "Administrator" is admin; every other member is a user. Change a person's role in the dashboard (Manage Account → Members). No file edit, no commit and no deploy: the change shows when they next sign in (ask them to log out and in again). Removing someone from the account does not end a session they already have; it lasts until it expires (12 hours) or they log out.

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
- **Command line, only where both values are in the environment:** these commands need `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the shell's environment, for example in a cloud session whose environment settings hold them. With the tokens only in `.env.cloudflare` (§2), the variables are empty and the requests fail: use the dashboard route above. Never `source` or `cat` `.env.cloudflare` to fill them in. List today's entries of a stage, and keep only the line with the request ID. `APP` must be set (§1 step 2):
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
- **No entry?** Watch the Worker's output while you repeat the request: `npx wrangler tail "$APP-$STAGE" --format pretty` (it too needs both values in the environment; otherwise open the Worker's logs in the dashboard, Workers & Pages → `template-<stage>` → Logs, menu names not yet verified). More help is in the skill's troubleshooting reference, `skill/reference/troubleshooting.md` in the framework repository.

## 11. Cost: what stays billable while idle

Cloudflare charges for requests and storage. An idle stage has no requests, but its storage remains:

| Billable while idle | How to remove it |
| --- | --- |
| Each stage's D1 database and R2 file bucket | `remove` the stage (§9). |
| Leftover test stages: Workers named `template-test-…`, D1 databases `template-test-…-db-<n>` | `remove` each by its stage name. Check Workers & Pages and D1 in the dashboard (menu names not yet verified). |
| The shared `prototype-logs` bucket, which grows with every entry and is never emptied by `remove` | Delete old entries in the dashboard. To do it automatically, open R2 → `prototype-logs` → Settings → Object lifecycle rules (not yet verified), and delete objects after, for example, 30 days. |
| The shared `sst-state` bucket, which is small | Keep it while any stage exists. Delete it in the dashboard only after the last stage is removed. |

**Keeping test stages small.** On Cloudflare's free plan, D1 allows about **100,000 rows written per day** per account; reads have a larger limit. When a daily limit is used up, database requests fail until it resets at 00:00 UTC. So keep test data to a few rows, never load data in loops, run one test stage at a time, and remove it right after its smoke test. An account holds at most **10 D1 databases**, and a deploy that changes the schema briefly holds two per stage.
