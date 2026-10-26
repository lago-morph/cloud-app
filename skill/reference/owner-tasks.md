# Owner tasks

Read this when the app's owner (or an agent acting for them) must do something outside the code: set up Cloudflare (its two tokens and the email domain), set secrets, create a production stage, sign up and sign in, make someone an admin, or keep costs down. Give the owner these steps as written. The owner does not read code.

Commands run in a terminal, in the app's directory, on macOS or Linux with Node 22.22.0. Replace `<…>` parts; `<domain>` is the account's email domain. Never paste a secret value into a command line, a file in the repository, or a chat.

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

## 2. Cloudflare: two links and one command

You need a Cloudflare account on the **Workers Paid** plan (sign-in sends email, which needs it), and a **domain on that account with Cloudflare DNS active** (Websites → Add a site). Its mail can stay where it is.

1. Run the setup. It prints no token value and does only what is missing:
   ```sh
   npm run cloudflare-setup
   ```
   With no tokens yet, it prints two links, a template, where the values go, and the next prompt.
2. Open each link while logged in to the dashboard. The permissions and name are filled in. Pick your account if asked and keep the email domain's zone included; for the bootstrap token, under TTL set an end date 7 days away or sooner (PAR-380). Then Continue to summary, Create Token, and copy it: Cloudflare shows it only once.
   - **Everyday token** `prototype-framework` (7 permissions), kept for every command. It cannot create tokens and has no zone write permission.
   - **Bootstrap token** `prototype-framework-bootstrap` (12 permissions), used once: setup deletes it when done.

   Both permission lists are in the framework repository's [QUICKSTART.md](https://github.com/lago-morph/cloud-app/blob/main/QUICKSTART.md). Setup names any permission a token lacks.
3. Put the values where setup reads them, in the four lines of the template (`CLOUDFLARE_BOOTSTRAP_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_EMAIL_DOMAIN`, and `CLOUDFLARE_ACCOUNT_ID` only if your tokens see more than one account):
   - **In a Claude Code cloud session:** the environment's settings (environment menu → Edit → Environment variables), then start a new session.
   - **On your computer:** the file `.env.cloudflare` in the app's folder (setup writes the template there; git ignores it), in your editor; or the environment. The environment wins when both are set.
4. Run `npm run cloudflare-setup` again (in Claude Code, say **"continue prototype setup"**), until it says everything is set up. On success it deletes the bootstrap token, comments out its line, and fills in an empty account and email domain: copy `.env.cloudflare` into another app's folder to start that one. In a cloud session you may then remove the bootstrap variable.

**When setup stops** (exit status 1), it says what is missing with the link or command to use. Do that, then run it again; it exits 0 only when all is set up:

| It says | Do this |
| --- | --- |
| two tokens are needed (no everyday token) | steps 2–4 |
| a setting's token is not accepted, not active, the same in both settings, of another account, or lacks a permission | make it again from the link it prints; replace its line |
| the bootstrap token cannot read API tokens ("was the everyday token pasted there?"), or is a user token | make it from the bootstrap link (an account token) |
| several accounts, by name | copy the chosen account's ID from the dashboard into `CLOUDFLARE_ACCOUNT_ID` |
| which domain should the emails come from | set `CLOUDFLARE_EMAIL_DOMAIN`, or run `npm run cloudflare-setup -- --email-domain <domain>`; with no domain, add one |
| the plan is Workers Free | upgrade it (Workers & Pages → Plans) |
| this needs the bootstrap token once (with the reasons) | make it from the link and set `CLOUDFLARE_BOOTSTRAP_TOKEN`; the everyday token keeps its value |
| the everyday token must be made again (wrong zone or account, a denied permission) | make it from the everyday link; setup kept the bootstrap token to check it |
| the tokens belong to another account than this project's | remove the old account's stages first if you want, with its everyday token, then `npm run cloudflare-setup -- --switch-account` |
| a host is blocked | allow `api.cloudflare.com`, `*.r2.cloudflarestorage.com` and `*.workers.dev` in the environment's network access settings |
| `.env.cloudflare` is not ignored, or is tracked | setup adds the `.gitignore` line unless it holds `# keep-env-cloudflare-tracked`. Tracked: delete both tokens, `git rm --cached .env.cloudflare`, commit, make new ones |

The git warnings never stop a command. Setup never updates or deletes a token whose ID is in `PROTOTYPE_FRAMEWORK_PROTECTED_TOKEN_IDS` (comma-separated). `npm run setup-account -- --target cloudflare --email-domain <domain>` is the account-setup step alone, for scripts.

## 3. What the account setup creates

Setup creates the shared resources once per account, including the file-signing credential every stage uses: the log bucket `prototype-logs`, the deploy-state bucket `sst-state`, the backup bucket `prototype-backups` (a removed production stage's data, kept 30 days), the `workers.dev` address, sending from `no-reply@<domain>`, and the test mailbox: mail to `sink+<tag>@t.<domain>` is stored for a day, so an agent can read it. It records what it did in `framework/account.json` in `sst-state`. When it creates the mailbox rule it waits about a minute. To change the domain, set the new `CLOUDFLARE_EMAIL_DOMAIN` and run it again (it needs the bootstrap token). `deploy` never creates these resources; if they are missing, it says to run the setup. When a run replaces the file-signing credential, it says so: then redeploy every deployed stage (`npm run deploy -- --target cloudflare --stage <stage>`), because each one keeps the old key, and its file uploads and downloads fail, until its next deploy.

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

Replace `REPLACE-WITH-THE-SENDER-NAME` with the display name of the sign-up and reset mail (or delete the `email` entry to use the app's name). `"values"` may set the app's configuration keys; ask the developer which. Then check, commit and deploy, setting the secrets the first deploy names ([deploying.md](deploying.md)):

```sh
npm run build -- --target cloudflare --stage "$STAGE"
git add "config/cloudflare/$STAGE.json" && git commit -m "Add the values file of stage $STAGE"
npm run deploy -- --target cloudflare --stage "$STAGE"
```

The deploy prints the stage's address, its sign-in page and the sender address.

## 6. Signing up and signing in

**Anyone who signs up and verifies their address is a user.** No list decides who may log in.

1. Open the stage's sign-in page (`<stage address>/api/auth/sign-in`; locally the app's login button). Choose "Create an account", and enter an email address, a password of 12 to 128 characters, and a display name.
2. Open the link in the "Confirm your email address" mail, and press the button.
3. Sign in. `<stage address>/api/auth/me` now shows `"level":"user"`.

Reading the mail without a mailbox (an agent, or local development):

- **Locally** the mail is not sent; it is written to `.mail/`. Read the latest message to an address:
  ```sh
  npm run mail -- last --to '<address>'
  ```
- **On Cloudflare**, sign up with a test address `sink+<tag>@t.<domain>` (`<tag>`: lowercase letters, digits, hyphens), then read it:
  ```sh
  npm run mail -- last --to 'sink+<tag>@t.<domain>' --target cloudflare
  ```
- Without a browser, post the link's token (the value after `token=`) instead of pressing the button:
  ```sh
  curl -sS -X POST '<stage address>/api/auth/password/verify' -H 'Origin: <stage address>' -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"token":"<token>"}'
  ```

A forgotten password: "Forgot your password?" on the sign-in page mails a reset link, valid for one hour. "Send a new confirmation link" there mails a new verification link.

## 7. Admins

Admins hold the `admin` role in the stage's own database. Granting or revoking it needs no file edit, no commit and no deploy: it applies from the person's next request. The person must have signed up and verified their address on that stage first (§6).

- **Grant** (on a production stage, repeat its name with `--confirm-production`):
  ```sh
  npm run admins -- grant '<address>' --target cloudflare --stage "$STAGE" --confirm-production "$STAGE"
  ```
- **Revoke:** the same with `revoke`. The person is a user again.
- **List** the stage's admins:
  ```sh
  npm run admins -- list --target cloudflare --stage "$STAGE" --confirm-production "$STAGE"
  ```
- On a test stage, leave out `--confirm-production`. Locally, use `--target local` (no `--stage`); it works whether or not `npm run dev` runs.

It prints the account's user ID (as `/api/auth/me` shows it) and its roles, never a password or token. An address with no verified account is refused and nothing changes.

## 8. Checking the real login (optional)

`npm run check-login -- --target cloudflare --stage "$STAGE"` checks sign-up with real mail, sign-in, the admin grant, a password reset and the rate limit on a production stage. It needs no input, prints no address or password, writes an evidence record under `validation/`, and leaves one test account (no role).

## 9. Cost

- Stopped or idle stages cost nothing for compute, but storage remains: the stage's D1 database and R2 file bucket, the shared `prototype-logs` bucket, and the `sst-state` bucket. Log entries are never deleted automatically. Test mail in the sink is deleted after a day.
- Keep test stages small: a few rows of data, one test stage at a time, and `remove` it right after use. An account holds at most **10 D1 databases**, and a deploy that changes the schema briefly uses two per stage.
- See [deploying.md](deploying.md) for deploy, stop/start and remove.

## Examples

- [examples/configuration.md](../examples/configuration.md): the template's committed values files (`config/<target>/<stage>.json`), which hold the app's values and `framework.email`, and no admins.

## Stopping condition

Stop reading when the owner has done the task they needed. Deploying and removing stages are in [deploying.md](deploying.md); reading logs is in [troubleshooting.md](troubleshooting.md).
