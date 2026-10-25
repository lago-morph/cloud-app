# Template app

This is the smallest app built on the prototype framework. It uses each capability once: database tables (notes, and one row per finalized upload), key-value storage, file upload with a finalize check and download, a configuration value (`greeting`), one secret (`apiKey`), a tested HMAC signing helper (`src/server/signing.ts`), log entries, and the three access levels (anonymous, user, admin). The scaffolder copies this folder to start a new app. A copied app has its own name: §1 step 2 prints it into `APP`, and the commands below use `$APP`. Where an address below says `template`, read the app's name instead.

This page lists everything the owner does by hand, as copy-and-paste steps. Run the commands in a terminal, in this app's folder, on macOS or Linux with Node 22.22.0. Replace the `<…>` parts. Never paste a secret value into a command line, a committed file or a chat.

**What is verified in this phase.** Local development (§1) is verified. The Cloudflare steps (§2–§11) have run against a simulated Cloudflare, and the email setup (§3) once against the real account; treat the rest as **not yet verified on Cloudflare**. AWS is a future release: this release targets local and Cloudflare only.

People sign in with an email address and a password. **Anyone who signs up and verifies their address is a user.** Admins are users holding the `admin` role, granted with the `admins` command (§8); nothing about people is kept in configuration. `<domain>` below is the account's email domain.

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
   Press Ctrl-C to stop. The login button opens the sign-in page: create an account with any address. Locally no mail is sent; it is written to `.mail/`. Read the latest message to the address, open its link, and press the button:
   ```sh
   npm run mail -- last --to '<address>'
   ```
   To make yourself an admin locally, run `npm run admins -- grant '<address>' --target local` (`revoke` takes it away). Your next request is admin.
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
   - Email Sending: Edit, and Email Routing Addresses: Edit

   Then add these **Zone** permissions for the email domain's zone: Email Routing Rules: Edit, DNS: Edit, Zone Settings: Edit, Zone: Read. The email domain must be a zone on this account with Cloudflare DNS active.

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
npm run setup-account -- --target cloudflare --email-domain <domain>
```

This creates the account's shared resources once: the log bucket `prototype-logs`, the deploy-state bucket `sst-state`, the account's `workers.dev` address, sending from `no-reply@<domain>`, and a test mailbox for agents: mail to `sink+<tag>@t.<domain>` is kept for a day. When it creates the mailbox rule, it waits about a minute before it finishes. Running it again changes nothing; to change the domain, run it again with the new `--email-domain`. `deploy` never creates these resources.

## 4. Deploy a test stage, test it, remove it

A stage whose name starts with `test-` is a test stage. It uses `config/cloudflare/test.json`, has the mock login for tests, never sends mail, and holds no real data. Stage names are at most 20 lowercase letters, digits and hyphens.

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

## 5. The production stage's values file

Every stage that does not start with `test-` is a production stage, for example `prod`. It needs its own committed values file. Copy the skill's template (in the framework's repository: `skill/templates/production-stage.json`) and set the display name of the sign-up and reset mail in it:

```sh
STAGE=prod
mkdir -p config/cloudflare
cp ../../skill/templates/production-stage.json "config/cloudflare/$STAGE.json"
SENDER='<the sender name, for example the app name>'
node -e 'const fs=require("fs"),f=process.argv[1],c=JSON.parse(fs.readFileSync(f,"utf8"));c.framework.email.senderName=process.argv[2];fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")' "config/cloudflare/$STAGE.json" "$SENDER"
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

The first `deploy` stops and names the unset secrets. Set them as above, pasting each value and then pressing Ctrl-D, and deploy again. The framework generates its own keys. The second deploy prints the stage's address, its sign-in page and the sender address `no-reply@<domain>`.

To change the stage later (code or configuration), commit the change and run the same `deploy` again:

```sh
git add -A
git commit -m "<what you changed>"
npm run deploy -- --target cloudflare --stage "$STAGE"
```

## 7. Sign up and sign in

1. Open the sign-in page `https://template-prod.<subdomain>.workers.dev/api/auth/sign-in` and choose "Create an account". Enter an email address, a password of 12 to 128 characters, and a display name.
2. Open the link in the "Confirm your email address" mail and press the button.
3. Sign in. `https://template-prod.<subdomain>.workers.dev/api/auth/me` now shows `"level":"user"`.

"Forgot your password?" on the sign-in page mails a reset link (valid for one hour); "Send a new confirmation link" mails a new confirmation link.

**An agent with no mailbox** signs up with a test address, `sink+<tag>@t.<domain>` (`<tag>`: lowercase letters, digits and hyphens), and reads the mail with:

```sh
npm run mail -- last --to 'sink+<tag>@t.<domain>' --target cloudflare
```

Without a browser, it posts the link's token (the value after `token=`) instead of pressing the button:

```sh
curl -sS -X POST 'https://template-prod.<subdomain>.workers.dev/api/auth/password/verify' -H 'Origin: https://template-prod.<subdomain>.workers.dev' -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"token":"<token>"}'
```

`npm run check-login -- --target cloudflare --stage "$STAGE"` runs this whole flow automatically on a production stage (with a password reset and the sign-in rate limit) and writes an evidence record under `validation/`.

## 8. Admins

The `admin` role is stored with the person's account in the stage's database. Granting or revoking it needs no file edit, no commit and no deploy: it applies from the person's next request. The person must have signed up and verified their address on that stage first (§7). On a production stage, repeat the stage's name with `--confirm-production`:

```sh
STAGE=prod
npm run admins -- grant '<their address>' --target cloudflare --stage "$STAGE" --confirm-production "$STAGE"
npm run admins -- list --target cloudflare --stage "$STAGE" --confirm-production "$STAGE"
```

`grant` prints the person's user ID (as `/api/auth/me` shows it) and roles. To take the role away, run the same command with `revoke`; the person is a user again. On a test stage, leave out `--confirm-production`. An address with no verified account is refused, and nothing changes.

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
