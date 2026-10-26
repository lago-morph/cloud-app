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

It prints two pre-filled dashboard links, one for each token, and a template of four lines. Open each link, choose your account (and, for the bootstrap token, an expiry of 7 days or less), create the token and copy it. Then:
- **Command line:** paste the values into `.env.cloudflare` in the app's folder with your editor (or set them in the environment), and run `npm run cloudflare-setup` again.
- **Cloud session:** paste the four lines into the environment's settings (environment menu → Edit → Environment variables), start a new session, and say **"continue prototype setup"**.

Setup never prints a token value. It does only what is missing: re-run it after a bad paste, after a framework release that needs more permissions, or on another account; it says exactly what to fix. When it is done it deletes the bootstrap token, and the next step is `npm run deploy -- --target cloudflare --stage test-<name>`. For a second app on the same account, copy `.env.cloudflare` into its folder. Every step, and what to do when setup stops: [skill/reference/owner-tasks.md](skill/reference/owner-tasks.md).

What the two links ask for:

**Everyday token** `prototype-framework` (every command):
<!-- permission-table: everyday -->
| Scope | On the dashboard | API name | Permission group ID |
| --- | --- | --- | --- |
| Account | Workers Scripts Edit | Workers Scripts Write | `e086da7e2179491d91ee5f35b3ca210a` |
| Account | Workers R2 Storage Edit | Workers R2 Storage Write | `bf7481a1826f439697cb59a20b22293e` |
| Account | D1 Edit | D1 Write | `09b2857d1c31407795e75e3fed8617a1` |
| Account | Email Sending Read | Email Sending Read | `2d5b4b1f6c89487bb7184c2c1dcd3bf1` |
| Zone | Zone Read | Zone Read | `c8fed203ed3043cba015a93ad1616f1f` |
| Zone | Analytics Read | Analytics Read | `9c88f9c5bce24ce7af9a958ba9c504db` |
| Zone | Email Routing Rules Read | Email Routing Rules Read | `1b600d9d8062443e986a973f097e728a` |
<!-- /permission-table -->

**Bootstrap token** `prototype-framework-bootstrap` (once; setup deletes it):
<!-- permission-table: bootstrap -->
| Scope | On the dashboard | API name | Permission group ID |
| --- | --- | --- | --- |
| Account | Workers Scripts Edit | Workers Scripts Write | `e086da7e2179491d91ee5f35b3ca210a` |
| Account | Workers R2 Storage Edit | Workers R2 Storage Write | `bf7481a1826f439697cb59a20b22293e` |
| Account | Account API Tokens Edit | Account API Tokens Write | `5bc3f8b21c554832afc660159ab75fa4` |
| Account | Email Sending Edit | Email Sending Write | `5df633d6b41c42bcaf5b4a62b9d14b64` |
| Account | Email Routing Addresses Edit | Email Routing Addresses Write | `e4589eb09e63436686cd64252a3aebeb` |
| Account | Billing Read | Billing Read | `7cf72faf220841aabcfdfab81c43c4f6` |
| Account | D1 Edit | D1 Write | `09b2857d1c31407795e75e3fed8617a1` |
| Zone | Email Routing Rules Edit | Email Routing Rules Write | `79b3ec0d10ce4148a8f8bdc0cc5f97f2` |
| Zone | DNS Edit | DNS Write | `4755a26eedb94da69e1066d98aa820be` |
| Zone | Zone Settings Edit | Zone Settings Write | `3030687196b94b638145a3953da2b699` |
| Zone | Zone Read | Zone Read | `c8fed203ed3043cba015a93ad1616f1f` |
| Zone | Analytics Read | Analytics Read | `9c88f9c5bce24ce7af9a958ba9c504db` |
<!-- /permission-table -->

## The skill in every cloud session: the setup script

Add this to your cloud environment's **Setup script** (environment menu → Edit → Setup script). Replace `<version>` with the exact framework version your apps use, for example `0.1.0`, never `latest`: the script never upgrades by itself. `npm pack` only downloads the archive, so nothing is installed and no package scripts run.

```sh
set -euo pipefail
d=$(mktemp -d); cd "$d"
npm pack -q @lago-morph/prototype-framework-skill@<version>
tar xzf ./*.tgz
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/prototype-framework
cp -r package/skill ~/.claude/skills/prototype-framework
```

The skill's first step in each session, `npx prototype-framework version-check`, says when this line or the app needs a newer version; `npm run upgrade` moves the app and prints the new line. Apps made with `npm create` also carry their own copy of the skill, and command-line users can install it as a plugin: `/plugin marketplace add lago-morph/cloud-app`, then `/plugin install prototype-framework@lago-morph`.
