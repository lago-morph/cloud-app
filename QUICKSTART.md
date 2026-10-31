# Quickstart

Build a small web app on [`@lago-morph/prototype-framework`](packages/framework/README.md), run it on your computer, then put it on Cloudflare. Apps run locally and on Cloudflare.

## Run it locally: one line

Needs Node 22.22.0 and git. No account of any kind.

```sh
npm create @lago-morph/prototype-app@latest my-app
```

This makes the folder `my-app` from the template app, with the Claude Code skill in `.claude/skills/prototype-framework/`, installs it, gives each secret a random local value, makes a git repository with a first commit, and keeps `.env.cloudflare` out of git. Then `cd my-app` and `npm run dev`, or open the folder in Claude Code and say what to build.

**In a Claude Code cloud session**, start the session on a repository made this way (push `my-app` to an empty repository), or on an empty repository with the setup script below, and ask Claude to make the app.

## Put it on Cloudflare: one link, one command, then the admin app

Any Cloudflare account works, on the free Workers plan too. No domain is needed. In the app's folder run (in Claude Code, say **"set up Cloudflare"**):

```sh
npm run cloudflare-setup
```

1. It prints one pre-filled dashboard link, for the **bootstrap token**, and a template of three lines. Open the link, pick your account if asked, and under TTL set an end date **no more than 1 day away** (setup deletes a longer-lived token at once); then create the token and copy it.
2. Put it in `CLOUDFLARE_BOOTSTRAP_TOKEN`:
   - **Command line:** in `.env.cloudflare` in the app's folder, with your editor (or in the environment), then run `npm run cloudflare-setup` again.
   - **Cloud session:** in the environment's settings (environment menu → Edit → Environment variables), then start a new session and say **"continue prototype setup"**.
3. Setup creates the account's sign-in clients, deploys the **admin app**, deletes the bootstrap token, and prints the admin app's address.
4. **Open the admin app and sign in** with your Cloudflare account (you need the role "Super Administrator - All Privileges" or "Administrator" in it). On **Account setup**, set the account up: this deploys the **auth app**, which signs people in to every app, and the shared buckets. On **Everyday token**, make the token every command uses; the page shows it once. Put it in `CLOUDFLARE_API_TOKEN` the same way as step 2. The agent never sees it.
5. Run `npm run cloudflare-setup` again (or say **"continue prototype setup"**). It checks everything and gives the next step, `npm run deploy -- --target cloudflare --stage test-first`.

Setup never prints a token value or an account ID, and asks nothing on the keyboard: when it needs you it stops with exit status 1 and says what to do (`--switch-account` answers its one question). It does only what is missing: re-run it after a bad paste, after a framework release that needs more, or on another account. For a second app on the same account, copy `.env.cloudflare` into its folder: it needs no bootstrap token. Only members of your Cloudflare account can sign in to your apps; members with those two roles are the apps' admins, from their next sign-in. Every step, and what to do when setup stops: [skill/reference/owner-tasks.md](skill/reference/owner-tasks.md).

**Coming from 0.1.x?** `npm run upgrade` says that setup needs re-running: do steps 1–5 once per account. Password accounts and sessions are gone: everyone signs in again, with Cloudflare. The framework's old sign-in and test-mail tables are dropped on the next `dev` or `deploy`; the app's own data stays. The admin app offers an optional **Clean up v0.1.x email** page for the old email resources.

What each token holds:

**Everyday token** `prototype-framework` (every command; the admin app makes it):
<!-- permission-table: everyday -->
| Scope | On the dashboard | API name | Permission group ID |
| --- | --- | --- | --- |
| Account | Workers Scripts Edit | Workers Scripts Write | `e086da7e2179491d91ee5f35b3ca210a` |
| Account | Workers R2 Storage Edit | Workers R2 Storage Write | `bf7481a1826f439697cb59a20b22293e` |
| Account | D1 Edit | D1 Write | `09b2857d1c31407795e75e3fed8617a1` |
| Account | Secrets Store Read | Secrets Store Read | `5e33b7d77788455c9fdf18cbd38ee5a0` |
<!-- /permission-table -->

**Bootstrap token** `prototype-framework-bootstrap` (once; setup deletes it):
<!-- permission-table: bootstrap -->
| Scope | On the dashboard | API name | Permission group ID |
| --- | --- | --- | --- |
| Account | Workers Scripts Edit | Workers Scripts Write | `e086da7e2179491d91ee5f35b3ca210a` |
| Account | OAuth Client Edit | OAuth Client Write | `50fc2f43318f40e4855a35d8de5bf643` |
| Account | Secrets Store Edit | Secrets Store Write | `adc8fa2bc6124928a8b3314dc63a1235` |
| Account | Account API Tokens Edit | Account API Tokens Write | `5bc3f8b21c554832afc660159ab75fa4` |
<!-- /permission-table -->

## The skill in every cloud session: the setup script

Add this to your cloud environment's **Setup script** (environment menu → Edit → Setup script). Replace `<version>` with the exact framework version your apps use, for example `0.2.0`, never `latest`: the script never upgrades by itself. `npm pack` only downloads the archive, so nothing is installed and no package scripts run.

```sh
set -euo pipefail
d=$(mktemp -d); cd "$d"
npm pack -q @lago-morph/prototype-framework-skill@<version>
tar xzf ./*.tgz
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/prototype-framework
cp -r package/skill ~/.claude/skills/prototype-framework
```

The skill's first step in each session, `npm run version-check`, says when this line or the app needs a newer version; `npm run upgrade` moves the app and prints the new line. Apps made with `npm create` also carry their own copy of the skill, and command-line users can install it as a plugin: `/plugin marketplace add lago-morph/cloud-app`, then `/plugin install prototype-framework@lago-morph`.
