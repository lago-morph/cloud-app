# Quickstart

Build a small web app on [`@lago-morph/prototype-framework`](packages/framework/README.md), run it on your computer, then put it on Cloudflare. Apps run locally and on Cloudflare.

## Run it locally: one line

Needs Node 22.22.0 and git. No account of any kind.

```sh
npm create @lago-morph/prototype-app@latest my-app
```

This makes the folder `my-app` from the template app, with the Claude Code skill in `.claude/skills/prototype-framework/`, installs it, gives each secret a random local value, and makes a git repository with a first commit. Then `cd my-app` and `npm run dev`, or open the folder in Claude Code and say what to build.

**In a Claude Code cloud session**, start the session on a repository made this way (push `my-app` to an empty repository), or on an empty repository with the setup script below, and ask Claude to make the app.

## Put it on Cloudflare: one token, one command

Any Cloudflare account works, on the free Workers plan too. No domain is needed. You need **one Cloudflare API token** and your **account ID**. In the app's folder run (in Claude Code, say **"set up Cloudflare"**):

```sh
npm run cloudflare-setup
```

1. With no token yet, it prints this template, a pre-filled dashboard link for the token, and where the lines go:
   ```
   CLOUDFLARE_API_TOKEN=
   CLOUDFLARE_ACCOUNT_ID=
   ```
   Open the link, pick your account if asked, keep the ticked permissions, choose any end date (or none), create the token and copy it. Your account ID is on the account's home page in the dashboard.
2. Fill in the two lines and put them in **one** of these places:
   - **On your computer:** the file `~/.secrets/cloudflare` in your home directory (`chmod 600 ~/.secrets/cloudflare`). Every app and every Claude Code session on the machine uses it. Set `CLOUDFLARE_SECRETS_FILE` to use another path.
   - **In a cloud session:** the environment's settings (environment menu → Edit → Environment variables), the same two lines; then start a new session.
   Environment variables win over the file.
3. Run `npm run cloudflare-setup` again (or say **"continue prototype setup"**). It checks the token, then sets the account up in one go: the sign-in clients, the **auth app** that signs people in to every app, the shared buckets and the admin app. It ends with the next step, `npm run deploy -- --target cloudflare --stage test-first`.

Already have a token with more permissions, such as an account admin token? Use it: setup says nothing about extra permissions, and if one is missing it names exactly which and gives the link. **The framework never deletes, rolls or changes your token**; it makes and manages only the tokens it needs for itself.

Setup never prints a token value or an account ID, and asks nothing on the keyboard: when it needs you it stops with exit status 1 and says what to do. It does only what is missing: re-run it after a bad paste or after a framework release that needs more. A second app on the same machine needs nothing new. Only members of your Cloudflare account can sign in to your apps; members with the role "Super Administrator - All Privileges" or "Administrator" are the apps' admins, from their next sign-in. The **admin app** that setup deploys is optional (status and cleanup pages). Every step, and what to do when setup stops: [skill/reference/owner-tasks.md](skill/reference/owner-tasks.md).

**Coming from 0.1.x or 0.2.0-rc01?** `.env.cloudflare` and the bootstrap token are no longer used: put your token and account ID in `~/.secrets/cloudflare` (or the environment), delete `.env.cloudflare`, and run `npm run cloudflare-setup` once per account. From 0.1.x, password accounts and sessions are gone: everyone signs in again, with Cloudflare. The framework's old sign-in and test-mail tables are dropped on the next `dev` or `deploy`; the app's own data stays. The admin app offers an optional **Clean up v0.1.x email** page for the old email resources.

The token's permissions (the link ticks them all):
<!-- permission-table: token -->
| Scope | On the dashboard | API name | Permission group ID |
| --- | --- | --- | --- |
| Account | Workers Scripts Edit | Workers Scripts Write | `e086da7e2179491d91ee5f35b3ca210a` |
| Account | Workers R2 Storage Edit | Workers R2 Storage Write | `bf7481a1826f439697cb59a20b22293e` |
| Account | D1 Edit | D1 Write | `09b2857d1c31407795e75e3fed8617a1` |
| Account | Secrets Store Edit | Secrets Store Write | `adc8fa2bc6124928a8b3314dc63a1235` |
| Account | OAuth Client Edit | OAuth Client Write | `50fc2f43318f40e4855a35d8de5bf643` |
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
