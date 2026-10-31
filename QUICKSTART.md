# Quickstart

Build a small web app on [`@lago-morph/prototype-framework`](packages/framework/README.md), run it on your computer, then put it on Cloudflare. Release 1 runs apps locally and on Cloudflare.

## Run it locally: one line

Needs Node 22.22.0 and git. No account of any kind.

```sh
npm create @lago-morph/prototype-app@latest my-app
```

This makes the folder `my-app` from the template app, with the Claude Code skill in `.claude/skills/prototype-framework/`, installs it, gives each secret a random local value, makes a git repository with a first commit, and keeps `.env.cloudflare` out of git. Then `cd my-app` and `npm run dev`, or open the folder in Claude Code and say what to build.

**In a Claude Code cloud session**, start the session on a repository made this way (push `my-app` to an empty repository), or on an empty repository with the setup script below, and ask Claude to make the app.

## Put it on Cloudflare: one command

You need:
- a Cloudflare account on the **Workers Paid** plan: sign-in sends email, which needs it;
- a **domain on that account, with Cloudflare DNS active**. Its mail can stay where it is.

Then run, in the app's folder (in Claude Code, say **"set up Cloudflare"**):

```sh
npm run cloudflare-setup
```

It prints two pre-filled dashboard links, one for each token, and a template of four lines. Open each link, pick your account if asked, keep the email domain's zone included and, for the bootstrap token, set an end date under TTL 7 days away or sooner (PAR-380); then create the token and copy it. Then:
- **Command line:** paste the values into `.env.cloudflare` in the app's folder with your editor (or set them in the environment), and run `npm run cloudflare-setup` again.
- **Cloud session:** paste the four lines into the environment's settings (environment menu → Edit → Environment variables), start a new session, and say **"continue prototype setup"**.

Setup never prints a token value or an account ID, and asks nothing on the keyboard: when it needs you it stops with exit status 1 and says what to do (`--email-domain <domain>` and `--switch-account` answer its two questions). It does only what is missing: re-run it after a bad paste, after a framework release that needs more permissions, or on another account; it says exactly what to fix. When it is done it deletes the bootstrap token, and the next step is `npm run deploy -- --target cloudflare --stage test-first`. For a second app on the same account, copy `.env.cloudflare` into its folder. Every step, and what to do when setup stops: [skill/reference/owner-tasks.md](skill/reference/owner-tasks.md).

What the two links ask for:

**Everyday token** `prototype-framework` (every command):
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

Add this to your cloud environment's **Setup script** (environment menu → Edit → Setup script). Replace `<version>` with the exact framework version your apps use, for example `0.1.1`, never `latest`: the script never upgrades by itself. `npm pack` only downloads the archive, so nothing is installed and no package scripts run.

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
