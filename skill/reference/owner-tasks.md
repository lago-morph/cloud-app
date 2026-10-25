# Owner tasks

Read this when the app's owner (or an agent acting for them) must do something outside the code: set up the Cloudflare account, its token and its email domain, set secrets, create a production stage, sign up and sign in, make someone an admin, or keep costs down. Give the owner these steps as written. The owner does not read code.

Commands run in a terminal, in the app's directory, on macOS or Linux with Node 22.22.0. Replace `<…>` parts; `<domain>` is the account's email domain. Never paste a secret value into a command line, a file in the repository, or a chat.

**Status in this phase.** The local steps are verified. The Cloudflare steps have run against a simulated Cloudflare, and the email setup once against the real account; treat the rest as **not yet verified on Cloudflare**. If a step fails, follow [troubleshooting.md](troubleshooting.md).

## 1. Before anything else (once per checkout)

In this repository the framework is built from source. Run this at the repository root. The last line goes back to the app's directory (here the template's), where every later command runs:

```sh
npm ci
npm run build -w packages/framework
cd apps/template
```

An app made with the scaffolder already has the built framework. There, run `npm install` once in the app's directory.

Set the stage's name in `STAGE` once in each new terminal (`<stage>` is for example `test-abc` or `prod`):

```sh
STAGE='<stage>'
```

## 2. Cloudflare account and API token (once)

1. Sign up or log in at https://dash.cloudflare.com. The email domain must be a zone on this account, with Cloudflare DNS active (Websites → Add a site). Its mail need not be on Cloudflare: the framework uses the subdomain `t.<domain>` for test mail.
2. Copy your **Account ID** from the account's overview page (menu names here are not yet verified).
3. Create an **account API token**: Manage Account → Account API Tokens → Create Token → Create Custom Token. Name it `prototype-framework`. Add these permissions:
   - Account: Workers Scripts Edit, Workers R2 Storage Edit, D1 Edit, Account API Tokens Edit, Email Sending Edit, Email Routing Addresses Edit;
   - Zone (the email domain's zone): Email Routing Rules Edit, DNS Edit, Zone Settings Edit, Zone Read.

   Create the token and copy it now; Cloudflare shows it only once. `setup-account` and a production `deploy` name any permission that is missing; add it to the token.
4. In each new terminal where you deploy, set both values. `read` keeps the token out of your shell history. Paste the token when it waits, then press Enter:
   ```sh
   export CLOUDFLARE_ACCOUNT_ID='<your Account ID>'
   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
   ```
5. Check the token. The output must contain `"success":true`:
   ```sh
   curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify"
   ```

If a command says it needs `NODE_USE_ENV_PROXY=1`, you are behind an HTTPS proxy: put `NODE_USE_ENV_PROXY=1 ` in front of that command.

## 3. One-time account setup, with the email domain

```sh
npm run setup-account -- --target cloudflare --email-domain <domain>
```

This creates the shared resources once per account: the log bucket `prototype-logs`, the deploy-state bucket `sst-state`, the `workers.dev` address, sending from `no-reply@<domain>`, and the test mailbox: mail to `sink+<tag>@t.<domain>` is stored for a day, so an agent can read it. When it creates the mailbox rule it waits about a minute, so the first test mail does not arrive before the rule. Running it again changes nothing. To change the domain later, run it with the new `--email-domain`. `deploy` never creates these resources; if they are missing, it tells you to run this command.

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

`npm run check-login -- --target cloudflare --stage "$STAGE"` signs up a fresh test address on a production stage, reads the real mail, verifies, signs in, grants and revokes `admin`, resets the password and checks the sign-in rate limit. It needs no input, prints no address or password, and writes an evidence record under `validation/`. It leaves one test account (with no role) on the stage.

## 9. Cost

- Stopped or idle stages cost nothing for compute, but storage remains: the stage's D1 database and R2 file bucket, the shared `prototype-logs` bucket, and the `sst-state` bucket. Log entries are never deleted automatically. Test mail in the sink is deleted after a day.
- On Cloudflare's free plan, D1 allows about **100,000 rows written per day** per account. The limit for reads is larger. When a limit is used up, database requests fail until it resets at 00:00 UTC.
- Keep test stages small: a few rows of data, one test stage at a time, and `remove` it right after use. An account holds at most **10 D1 databases**, and a deploy that changes the schema briefly uses two per stage.
- See [deploying.md](deploying.md) for deploy, stop/start and remove.

## Examples

- [examples/configuration.md](../examples/configuration.md): the template's committed values files (`config/<target>/<stage>.json`), which hold the app's values and `framework.email`, and no admins.

## Stopping condition

Stop reading when the owner has done the task they needed. Deploying and removing stages are in [deploying.md](deploying.md); reading logs is in [troubleshooting.md](troubleshooting.md).
