# Owner tasks

Read this when the app's owner (or an agent acting for them) must do something outside the code: set up Cloudflare (one token, one command), set secrets, create a production stage, sign in, make someone an admin, or keep costs down. Give the owner these steps as written. The owner does not read code.

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

## 2. Cloudflare: one token, one command

Any Cloudflare account works, on the free Workers plan too. No domain is needed. You need one Cloudflare API token and your account ID. The steps, in order:

1. **Run the setup.** It prints no token value and does only what is missing:
   ```sh
   npm run cloudflare-setup
   ```
   With no token yet, it prints this two-line template, where the lines go, the token's pre-filled link and the next prompt:
   ```
   CLOUDFLARE_API_TOKEN=
   CLOUDFLARE_ACCOUNT_ID=
   ```
2. **Make the token** `prototype-framework-cli` from that link, logged in to the dashboard. Its permissions and name are filled in; keep them (more is fine). Pick your account if asked and choose any end date, or none. Then Continue to summary, Create Token, and copy it: Cloudflare shows it only once. A token you already have with more permissions (an account admin token, say) works too. Your **account ID** is on the account's home page in the dashboard.
3. **Fill in the two lines and put them in one place** (the environment wins when both are set):
   - **On your computer:** the file `~/.secrets/cloudflare` in your home directory, then `chmod 600 ~/.secrets/cloudflare`. Every app, worktree and Claude Code session on the machine shares it. `CLOUDFLARE_SECRETS_FILE` names another path if you want one.
   - **In a Claude Code cloud session:** the environment's settings (environment menu → Edit → Environment variables), the same two lines; then start a new session.
   Never paste the token into the chat or into a file in the repository.
4. **Run `npm run cloudflare-setup` again** (in Claude Code, say **"continue prototype setup"**). It says where each value came from (the variable or the file, never the value), checks the token's permissions, and sets the account up in one run: the admin app's client and the sign-in client with their secrets in Cloudflare's Secrets Store, the **admin app**, the account's **auth app** (it signs people in to every app) and the shared resources (§3). It ends with "Cloudflare setup is complete" and the next step, a `deploy` of a `test-` stage. Run again, it says everything is already set up.

**The framework never deletes, rolls or changes your token.** It makes and replaces only the tokens it needs for itself (the file-signing token `prototype-r2-signing`). The admin app (its address is printed once) is optional: it has status and cleanup pages.

**When setup stops** (exit status 1), it says what is missing with the link or command to use. Do that, then run it again; it exits 0 only when all is set up:

| It says | Do this |
| --- | --- |
| no Cloudflare credential, or one of the two settings is not set | steps 2–3 |
| the token is not accepted or not active | make a token from the link (step 2) and replace `CLOUDFLARE_API_TOKEN` |
| the token lacks these permissions (named) | add them to the token in the dashboard (Manage account → Account API tokens → the token → Edit), or make a new one from the link |
| the token cannot read its own permissions | it lacks Account API Tokens Edit: add it, or make a new token from the link |
| the token cannot see the account `CLOUDFLARE_ACCOUNT_ID` names (accounts listed by name) | set `CLOUDFLARE_ACCOUNT_ID` to the right account's ID, or make the token on that account |
| the secrets file can be read by other users | `chmod 600 ~/.secrets/cloudflare` (a warning only) |
| `.env.cloudflare` or `CLOUDFLARE_BOOTSTRAP_TOKEN` is no longer used | move the token and account ID to `~/.secrets/cloudflare` (or the environment), then delete the old file or variable |
| a host is blocked | allow `api.cloudflare.com`, `*.r2.cloudflarestorage.com` and `*.workers.dev` in the environment's network access settings |
| an old `.env.cloudflare` is not ignored, or is tracked | setup adds the `.gitignore` line unless it holds `# keep-env-cloudflare-tracked`. Tracked: delete the tokens it held, `git rm --cached .env.cloudflare`, commit |

The git warnings never stop a command. Setup also never touches a token whose ID is in `PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS` (comma-separated).

## 3. What the account setup creates

`cloudflare-setup` creates, once per account: the admin app and the sign-in clients, the **auth app** with its database, the log bucket `prototype-logs`, the deploy-state bucket `sst-state`, the backup bucket `prototype-backups` (a removed production stage's data, kept 30 days), and the file-signing credential every stage uses, kept in Secrets Store. It records what it did in `framework/account.json` in `sst-state`. `deploy` never creates these resources; if they are missing, it says so. When setup replaces the file-signing credential, redeploy every deployed stage (`npm run deploy -- --target cloudflare --stage <stage>`): until then its file uploads and downloads fail. The admin app's Account setup page does the same and is optional.

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

The deploy registers the stage with the auth app and prints its address. Without the account's auth app it names it and stops before creating anything: run `npm run cloudflare-setup` (§2) first.

## 6. Signing in

**Only members of your Cloudflare account can sign in**, with their Cloudflare login. Anyone else is refused. No list in the app decides who may log in.

1. Open the stage's address and press the login button (or open `<stage address>/api/auth/login`).
2. Sign in on Cloudflare's page, and allow the app to see your user details and memberships.
3. You are back on the app. `<stage address>/api/auth/me` shows `"level":"user"` or `"level":"admin"`.

To let someone sign in, invite them to the account (Manage Account → Members). A read-only role works, for example "HTTP Applications Read" (plan-v0.2.0 §2.1a). Locally and on `test-` stages there is no real sign-in: the login button signs in a test user.

## 7. Admins

**A member whose account role is "Super Administrator - All Privileges" or "Administrator" (PAR-413) is the app's admin**; every other member is a user. To make someone an admin, give them one of those roles in the dashboard (Manage Account → Members); to make them a user again, give them another role. No file edit, no commit and no deploy.

The apps learn a role change when the person **next signs in**, to any app on the account; their other open sessions pick it up within 5 minutes (PAR-425). Until then they keep their old level: ask them to log out and in again. Removing someone from the account stops new sign-ins, but a session they already have lasts until it expires (12 hours, PAR-250) or they log out.

## 8. Checking the real sign-in (optional)

`npm run check-login -- --target cloudflare --stage "$STAGE"` checks, on a production stage and with no sign-in, that the stage sends people to the auth app with its own address. It needs no input. The real sign-in itself needs a person: sign in once (§6).

## 9. Cost

- Stopped or idle stages cost nothing for compute, but storage remains: the stage's D1 database and R2 file bucket, the shared `prototype-logs` bucket, the `sst-state` bucket, and the auth app's database. Log entries are never deleted automatically.
- Keep test stages small: a few rows of data, one test stage at a time, and `remove` it right after use. An account holds at most **10 D1 databases** (the auth app uses one), and a deploy that changes the schema briefly uses two per stage.
- See [deploying.md](deploying.md) for deploy, stop/start and remove.

## 10. Coming from 0.1.x

`npm run upgrade` to 0.2.0 says Cloudflare setup needs re-running. Once per account, do §2: put one token with the listed permissions (your old everyday token lacks some) and the account ID in `~/.secrets/cloudflare` or the environment, delete `.env.cloudflare`, and run `npm run cloudflare-setup`. Password accounts and sessions are gone, so everyone signs in again with Cloudflare; the old sign-in and test-mail tables are dropped on the next `dev` or `deploy`, and the app's own data stays. Remove `framework.email` from values files if you like: it is no longer used. The admin app's **Clean up v0.1.x email** page optionally removes the old email resources (sending domain, routing rules, test mailbox); nothing is removed automatically.

## Examples

- [examples/configuration.md](../examples/configuration.md): the template's committed values files (`config/<target>/<stage>.json`), which hold the app's values and no admins.

## Stopping condition

Stop reading when the owner has done the task they needed. Deploying and removing stages are in [deploying.md](deploying.md); reading logs is in [troubleshooting.md](troubleshooting.md).
