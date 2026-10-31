# Owner tasks

Read this when the app's owner (or an agent acting for them) must do something outside the code: set up Cloudflare (the bootstrap token, then the admin app), set secrets, create a production stage, sign in, make someone an admin, or keep costs down. Give the owner these steps as written. The owner does not read code.

Commands run in a terminal, in the app's directory, on macOS or Linux with Node 22.22.0. Replace `<…>` parts. Never paste a secret value or a token into a command line, a file in the repository, or a chat.

## 1. Before anything else (once per checkout)

In this repository the framework is built from source. Run this at the repository root. The last line goes back to the app's directory (here the template's), where every later command runs:

```sh
npm ci
npm run build -w packages/framework
cd apps/template
```

An app made with `npm create` is already installed.

Set the stage's name in `STAGE` once in each new terminal (`<stage>` is for example `test-abc` or `prod`):

```sh
STAGE='<stage>'
```

## 2. Cloudflare: one link, one command, then the admin app

Any Cloudflare account works, on the free Workers plan too. No domain is needed. The steps, in order:

1. **Run the setup.** It prints no token value and does only what is missing:
   ```sh
   npm run cloudflare-setup
   ```
   With no tokens yet, it prints the bootstrap token's link, a three-line template, where the values go, and the next prompt.
2. **Make the bootstrap token** `prototype-framework-bootstrap` from that link, logged in to the dashboard. Its permissions and name are filled in. Pick your account if asked, and under TTL set an end date **no more than 1 day away** (PAR-435): setup deletes a token that lives longer, or has no end date, at once. Then Continue to summary, Create Token, and copy it: Cloudflare shows it only once.
3. **Put it where setup reads it**, as `CLOUDFLARE_BOOTSTRAP_TOKEN` (add `CLOUDFLARE_ACCOUNT_ID` only if setup asks for it):
   - **In a Claude Code cloud session:** the environment's settings (environment menu → Edit → Environment variables), then start a new session.
   - **On your computer:** the file `.env.cloudflare` in the app's folder (setup writes the template there; git ignores it), in your editor; or the environment. The environment wins when both are set.
4. **Run `npm run cloudflare-setup` again** (in Claude Code, say **"continue prototype setup"**). With the bootstrap token it creates the admin app's client and the sign-in client, stores their secrets in Cloudflare's Secrets Store, deploys the **admin app**, and deletes the bootstrap token. It prints the admin app's address and "open the admin app and sign in". In a cloud session you may then delete the bootstrap variable: it is already invalid.
5. **In the admin app** (the owner, in a browser), sign in with your Cloudflare account. You need one of the administrator roles of PAR-413 in it: "Super Administrator - All Privileges" or "Administrator". Then:
   - **Account setup:** press its button and allow what Cloudflare asks. It deploys the account's **auth app** (it signs people in to every app) and creates the shared resources (§3).
   - **Everyday token:** make the token `prototype-framework` that every command uses. The page shows its value **once**: copy it into `CLOUDFLARE_API_TOKEN`, where step 3 says. Never paste it into the chat: the agent never sees it.
6. **Say "continue prototype setup"** (or run `npm run cloudflare-setup`). Without a bootstrap token it checks the everyday token, the account setup and the network, and says "everything is set up" with the next step, a `deploy` of a `test-` stage. Copy `.env.cloudflare` into another app's folder to start that one: it needs no bootstrap token and no admin app visit.

**When setup stops** (exit status 1), it says what is missing with the link, page or command to use. Do that, then run it again; it exits 0 only when all is set up:

| It says | Do this |
| --- | --- |
| no everyday token, and no bootstrap token | steps 2–4, then 5 |
| the bootstrap token expires more than 1 day from now, or has none; it was deleted | make a new one with a shorter TTL (step 2) |
| a setting's token is not accepted, not active, the same in both settings, a user token, or of another account | the bootstrap token: make it again from the link. The everyday token: make it again on the admin app's Everyday token page. Replace its line |
| something the admin app does is missing (with the page) | open that admin app page. If the admin app is not deployed yet, steps 2–4 first |
| the everyday token lacks a permission | the admin app's Everyday token page updates it; its value stays the same. If the page shows a new value instead, save it as `CLOUDFLARE_API_TOKEN`, then press its button to delete the old token |
| several accounts, by name | copy the chosen account's ID from the dashboard into `CLOUDFLARE_ACCOUNT_ID` |
| the tokens belong to another account than this project's | remove the old account's stages first if you want, with its everyday token, then `npm run cloudflare-setup -- --switch-account` |
| a host is blocked | allow `api.cloudflare.com`, `*.r2.cloudflarestorage.com` and `*.workers.dev` in the environment's network access settings |
| `.env.cloudflare` is not ignored, or is tracked | setup adds the `.gitignore` line unless it holds `# keep-env-cloudflare-tracked`. Tracked: delete the tokens, `git rm --cached .env.cloudflare`, commit, make new ones |

The git warnings never stop a command. Setup never updates or deletes a token whose ID is in `PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS` (comma-separated).

## 3. What the account setup creates

The admin app's Account setup page creates, once per account: the **auth app** with its database, the log bucket `prototype-logs`, the deploy-state bucket `sst-state`, the backup bucket `prototype-backups` (a removed production stage's data, kept 30 days), and the file-signing credential every stage uses, kept in Secrets Store. It records what it did in `framework/account.json` in `sst-state`. `deploy` never creates these resources; if they are missing, it says so. When the page replaces the file-signing credential, redeploy every deployed stage (`npm run deploy -- --target cloudflare --stage <stage>`): until then its file uploads and downloads fail.

## 4. Secrets

A secret is read from standard input. Run the command, paste the value, press Enter, then press Ctrl-D. The app declares its secret names in `src/server/env.ts`; the template declares `apiKey`. The framework generates its own keys.

- **Local** (needed before the template's admin page works):
  ```sh
  npm run secrets -- set apiKey --target local --stage local
  ```
  The value goes into `.dev.vars`, which git ignores. Restart `npm run dev` after you set it.
- **Cloudflare:** a stage's secrets live on its Worker, so the stage must have been deployed once. The first `deploy` stops and names the secrets that are not set yet. Set each one, then run `deploy` again:
  ```sh
  npm run secrets -- set apiKey --target cloudflare --stage "$STAGE"
  ```

## 5. A production stage

Every stage not named `test-…` is a production stage, for example `prod`. It needs its own committed values file, copied from the skill's `templates/production-stage.json` (it holds no admins and no login settings). In this repository, from the template's directory:

```sh
STAGE=prod
mkdir -p config/cloudflare
cp ../../skill/templates/production-stage.json "config/cloudflare/$STAGE.json"
```

`"values"` may set the app's configuration keys; ask the developer which. Then check, commit and deploy, setting the secrets the first deploy names ([deploying.md](deploying.md)):

```sh
npm run build -- --target cloudflare --stage "$STAGE"
git add "config/cloudflare/$STAGE.json" && git commit -m "Add the values file of stage $STAGE"
npm run deploy -- --target cloudflare --stage "$STAGE"
```

The deploy registers the stage with the auth app and prints its address. Without the account's auth app it names it and stops before creating anything: do the admin app's Account setup (§2 step 5) first.

## 6. Signing in

**Only members of your Cloudflare account can sign in**, with their Cloudflare login. Anyone else is refused. No list in the app decides who may log in.

1. Open the stage's address and press the login button (or open `<stage address>/api/auth/login`).
2. Sign in on Cloudflare's page, and allow the app to see your user details and memberships.
3. You are back on the app. `<stage address>/api/auth/me` shows `"level":"user"` or `"level":"admin"`.

To let someone sign in, invite them to the account (Manage Account → Members). A read-only role works, for example "HTTP Applications Read" (plan-v0.2.0 §2.1a). Locally and on `test-` stages there is no real sign-in: the login button signs in a test user.

## 7. Admins

**A member whose account role is "Super Administrator - All Privileges" or "Administrator" (PAR-413) is the app's admin**; every other member is a user. To make someone an admin, give them one of those roles in the dashboard (Manage Account → Members); to make them a user again, give them another role. No file edit, no commit and no deploy.

The apps learn a role change when the person **next signs in**, to any app on the account; their other open sessions pick it up within 5 minutes (PAR-425). Until then they keep their old level: ask them to log out and in again. Removing someone from the account stops new sign-ins, but a session they already have lasts until it expires (7 days, PAR-250) or they log out.

## 8. Checking the real sign-in (optional)

`npm run check-login -- --target cloudflare --stage "$STAGE"` checks, on a production stage and with no sign-in, that the stage sends people to the auth app with its own address. It needs no input. The real sign-in itself needs a person: sign in once (§6).

## 9. Cost

- Stopped or idle stages cost nothing for compute, but storage remains: the stage's D1 database and R2 file bucket, the shared `prototype-logs` bucket, the `sst-state` bucket, and the auth app's database. Log entries are never deleted automatically.
- Keep test stages small: a few rows of data, one test stage at a time, and `remove` it right after use. An account holds at most **10 D1 databases** (the auth app uses one), and a deploy that changes the schema briefly uses two per stage.
- See [deploying.md](deploying.md) for deploy, stop/start and remove.

## 10. Coming from 0.1.x

`npm run upgrade` to 0.2.0 says Cloudflare setup needs re-running. Once per account, do §2 steps 2–6: a new bootstrap token, `npm run cloudflare-setup`, then the admin app's Account setup and Everyday token pages (the existing everyday token is updated to the new permissions). Password accounts and sessions are gone, so everyone signs in again with Cloudflare; the old sign-in and test-mail tables are dropped on the next `dev` or `deploy`, and the app's own data stays. Remove `framework.email` from values files if you like: it is no longer used. The admin app's **Clean up v0.1.x email** page optionally removes the old email resources (sending domain, routing rules, test mailbox); nothing is removed automatically.

## Examples

- [examples/configuration.md](../examples/configuration.md): the template's committed values files (`config/<target>/<stage>.json`), which hold the app's values and no admins.

## Stopping condition

Stop reading when the owner has done the task they needed. Deploying and removing stages are in [deploying.md](deploying.md); reading logs is in [troubleshooting.md](troubleshooting.md).
