# Plan: one-line local start and a re-runnable Cloudflare setup

Status: draft for owner review (2026-10-26). Nothing here is implemented yet.

## 1. Goal

Make the framework easy for people with little experience, and optimize it for Claude Code running in a cloud sandbox, while keeping the command line working.

- **Local development:** one command, no accounts at all.
- **Cloudflare:** one re-runnable setup command, whose state is kept in one file or two environment variables.
  - Users create **two tokens**, both from **pre-filled dashboard links**. Setup never prints a token value.
  - The same command works on:
    - a new project;
    - a project that has done a lot of local work first;
    - a project that is switching accounts;
    - a project after a bad paste;
    - a project after a framework release that needs more Cloudflare permissions.

Owner decisions this plan follows (2026-10-26):
- deep links for both tokens;
- a `.env.cloudflare` template;
- a trigger phrase to continue setup;
- setup adds the file to `.gitignore`;
- warn when not in a git repo;
- ask for the email domain;
- check the everyday token's permissions exactly once, before deleting the bootstrap token;
- the everyday token can tell whether the account is already set up;
- comment out the bootstrap line after use;
- copying `.env.cloudflare` into a new project is the way to start another one;
- check git-ignore status regularly;
- skip any step whose tokens are already set and valid.

## 2. Facts verified live (2026-10-26, account with Workers Paid)

| Fact | Result |
|---|---|
| A token with "Account API Tokens Write" can create the everyday token through the API, and gets its value in the reply | yes |
| The API can create a token that itself holds "Account API Tokens Write" | **no**: 400, code 1001, "sub-token is not allowed to have permissions to manage other tokens". So the bootstrap token must be made in the dashboard. |
| A token with "Account API Tokens Write" can delete itself | yes: DELETE 200, then 401 on use, and gone from the list |
| A token without token permissions can delete itself | no (403, 9109) |
| Updating a token's permissions (`PUT /accounts/{id}/tokens/{id}`) keeps its value | yes: the same value gained D1 access, with no new value returned |
| The plan can be read with "Billing Read" (`GET /accounts/{id}/subscriptions` shows "Workers Paid") | yes; without it, 403 |
| The account and zones can be found from a token (`GET /accounts`, `GET /zones`) | yes |
| An account-token deep link pre-fills permissions, including permission groups given by ID | yes, tested with "Account API Tokens Write" by ID ([docs](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/)) |
| A deep link can set an expiry, account or zone | no: the docs list only `permissionGroupKeys` and `name` for account tokens |
| A cloud session installs plugins from repo settings | no. Committed `.claude/skills/` are loaded; a setup script can't read environment secrets ([docs](https://code.claude.com/docs/en/cloud-environments.md#what-carries-over-from-your-setup)) |

Owner check of the 12-group bootstrap link (2026-10-26):
- **All groups arrived ticked,** including the email ones given by ID: the 5 zone groups ticked, and the account summary listing 7.
- **Scope:** the page puts every group in one policy for the entire account, so zone permissions cover *all* the account's zones. The link can't narrow this. It's accepted for both tokens: the bootstrap token is short-lived, and the everyday token's zone permissions are read-only. Setup checks that the email domain is covered.
- **Expiry:** chosen on the page (No expiration, 7 days, 30 days, 90 days, 1 year, Custom), defaulting to none. The instructions say to pick 7 days or less for the bootstrap token, and setup warns when it has no expiry.

Not yet verified:
- **The everyday link (7 groups):** same mechanism; expected to behave the same.

## 3. User flows

### 3.1 Local, one line
```sh
npm create @lago-morph/prototype-app@latest my-app
```
The starter copies the template and the skill (`.claude/skills/prototype-framework/`), then:
- runs `npm install`, `git init` and a first commit;
- sets a random local value for each app secret;
- adds `.env.cloudflare` to `.gitignore`;
- prints: "cd my-app, then `npm run dev`, or open this folder in Claude Code and say what to build."

Nothing asks for an account. The cloud equivalent is to start a session on a repository made this way, or on an empty repository with the setup script of §4.8.

### 3.2 Cloudflare, cloud session
1. The user says "set up Cloudflare", or invokes `/prototype-framework setup cloudflare`.
2. The skill runs `npm run cloudflare-setup`. It finds no tokens and prints:
   - the plan and domain requirements (Workers Paid, a domain on Cloudflare DNS, so Better Auth can send email);
   - the bootstrap deep link and the everyday deep link, each with what to choose on the page: account, zone (the email domain) and, for bootstrap, a short expiry;
   - the template:
     ```
     CLOUDFLARE_BOOTSTRAP_TOKEN=
     CLOUDFLARE_API_TOKEN=
     CLOUDFLARE_EMAIL_DOMAIN=
     # CLOUDFLARE_ACCOUNT_ID=        (only if your tokens see more than one account)
     ```
   - where it goes. In a cloud session: the environment settings (the environment menu, Edit, Environment variables), then start a new session. On the command line: the environment, or a file `.env.cloudflare` in the project folder.
   - the prompt for the next session: **"continue prototype setup"** (or `/prototype-framework continue setup`).
3. In the new session, "continue prototype setup" runs the state machine (§4.3).

### 3.3 Cloudflare, command line
Same as 3.2. The user can paste the tokens into `.env.cloudflare` with an editor and continue in the same session. Setup reads the file itself, so the agent never opens it.

### 3.4 Later runs
| Situation | What "continue prototype setup" does |
|---|---|
| Everything valid and current | says so, and asks for nothing |
| Bad paste (wrong token, wrong account or zone, not a token) | names exactly which token and what's wrong; prints only that token's link |
| New framework release needs more everyday permissions | needs the bootstrap token once, adds the permissions to the existing everyday token in place (value unchanged), deletes the bootstrap token |
| New release needs more account setup | needs the bootstrap token once, runs the missing setup steps, deletes it |
| Account switch (the tokens' account differs from the project's recorded one) | explains that stages on the old account keep running and offers to remove them while the old token still works; then sets up the new account as needed and updates `CLOUDFLARE_ACCOUNT_ID` |
| Second project on the same account | the user copies `.env.cloudflare` into it; setup finds the account already set up and needs no bootstrap token |
| Valid tokens already in the environment | used without any prompt |

## 4. Design

### 4.1 One versioned permission list
One module in the framework (`provision/cloudflare/permissions.ts`) holds:
- `EVERYDAY` and `BOOTSTRAP`: permission group IDs, names and scope (account or zone), plus `PERMISSIONS_VERSION`;
- `ACCOUNT_SETUP_VERSION`: the version of the account setup this release expects.

The deep links, the token checks, the in-place upgrade and the docs' permission tables are all generated from it. It replaces the hand-written lists in README §2 and owner-tasks, and supersedes DEC-0551's two-token split: the setup token becomes the dashboard-made bootstrap token.

- **Everyday** (DEC-0551's set, plus Email Routing Rules Read, owner 2026-10-26, so it can check the whole account setup on its own):
  - Account: Workers Scripts Write, Workers R2 Storage Write, D1 Write, Email Sending Read.
  - Zone: Zone Read, Analytics Read, Email Routing Rules Read.
  - Its R2 access lets it read the setup record (§4.4).
- **Bootstrap** (12 groups):
  - Account: Workers Scripts Write, Workers R2 Storage Write, Account API Tokens Write, Email Sending Write, Email Routing Addresses Write, Billing Read, D1 Write.
  - Zone: Email Routing Rules Write, DNS Write, Zone Settings Write, Zone Read, Analytics Read.

### 4.2 Where the tokens come from
- **Order:** environment variables first, then `.env.cloudflare` in the project root. If both are set and differ, setup says which one it is using: the environment.
- **CLI-owned file:** the framework CLI reads, creates and edits the file. Every write leaves it readable by the owner only (mode 600).
- **Bootstrap line after use:** setup replaces it with `# CLOUDFLARE_BOOTSTRAP_TOKEN=deleted by setup process`.
- **Filled in on success:** an empty `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_EMAIL_DOMAIN`, so copying the file starts the next project.
- **Read by every Cloudflare command:** deploy, remove, secrets and the rest read the same sources. Nobody exports variables by hand any more.

### 4.3 `cloudflare-setup`: the state machine
It reads the current state, then does only what is missing. Each run:
0. **Local setup:** if the project's local setup hasn't been done, do it first: dependencies installed, local secrets set, `.env.cloudflare` listed in `.gitignore`. This is the same step as §3.1, and it's idempotent.
1. **Git:** never blocks (owner 2026-10-26: some users have no remote, or a private one, and accept the risk). Every run prints a prominent warning when any of these holds:
   - this is not a git repository;
   - `.env.cloudflare` is not ignored (setup offers to add the line, and adds it unless the user has removed it on purpose, marked by a `# keep-env-cloudflare-tracked` line in `.gitignore`);
   - the file is tracked (`git ls-files`). Then the warning also says the tokens are in the history and how to replace them.
2. **Tokens:** find both tokens (§4.2). For each, check:
   - that it's valid (`/accounts/{id}/tokens/verify`);
   - which account it belongs to;
   - for the everyday token, that it can make one read for each permission (a quick check).
3. **No everyday token:** print §3.2's links, template and next prompt. Stop.
4. **The account:**
   - if more than one is visible and `CLOUDFLARE_ACCOUNT_ID` isn't set, list them and ask;
   - if it differs from the project's recorded account, use the account-switch flow (§3.4);
   - check the plan: if it isn't Workers Paid, say Better Auth needs it, and stop. Later releases would offer other sign-in modes here.
5. **The email domain:** use `CLOUDFLARE_EMAIL_DOMAIN`. Otherwise list the zones the everyday token sees and ask the user to pick. If there are none, explain that a domain is needed.
6. **The account setup record**, read with the everyday token (§4.4).
   - *Current, and the everyday token meets `PERMISSIONS_VERSION`:* done. If a bootstrap token is still valid, it deletes itself and its line is commented out.
   - *Out of date or missing, or the everyday token is short of permissions:* this needs the bootstrap token. If it isn't present, print only the bootstrap link and the next prompt, and stop.
7. **With the bootstrap token:**
   - run the missing setup steps; this is today's `setup-account`, made idempotent step by step;
   - write the record;
   - **check the everyday token exactly once**: read its permissions and zone with the bootstrap token and compare them with `EVERYDAY`;
   - if anything is missing, add it in place with `PUT …/tokens/{id}`, which keeps the value;
   - if the token is scoped to the wrong zone or the wrong account, explain, and give the everyday link to make a new one;
   - then the bootstrap token deletes itself, and its line in `.env.cloudflare` is commented out;
   - in a cloud session, say that the environment variable can now be removed. The token is already deleted, so leaving it does no harm.
8. **Network check:** reach `api.cloudflare.com`, R2's storage host and the account's `workers.dev` subdomain. A blocked host is named, with where to change the cloud environment's network policy.
9. **Summary:** what was done, and the next step (`deploy` of a `test-` stage).

**Output rules:**
- never print a token value; report only pass or fail, permission names and status codes;
- if the bootstrap token has no expiry, warn;
- every message that needs the user to act includes the exact link or command.

### 4.4 The account setup record
`setup-account` already writes `framework/account.json` in `sst-state`. It would also record:
- the setup version (`ACCOUNT_SETUP_VERSION`);
- the framework version that applied it, and the time;
- the email domain;
- which steps it completed.

The everyday token reads the record through R2, then checks with its own permissions that the buckets, the signing record, email sending and the test mailbox's routing rule are all there.

### 4.5 Git-ignore safety, checked in three places
- **The framework CLI:** every command that reads `.env.cloudflare`, and `npm run verify`, prints a prominent warning, every time, in two cases (never a failure, owner 2026-10-26):
  - the file exists but isn't ignored;
  - the file is tracked.
- **The skill:** before every commit or push, and when a session starts work on the app, it runs `git check-ignore -q .env.cloudflare` and `git ls-files --error-unmatch .env.cloudflare`. It reminds the user each time either check fails; it doesn't refuse to commit.
- **Setup itself:** see §4.3 step 1.

### 4.6 Keeping the agent away from the token values
- The skill: never open, print or search `.env.cloudflare`, and never echo the token variables. Use the CLI, which reads them itself.
- The template's committed `.claude/settings.json` denies reading `.env.cloudflare`, through a permission rule.
- The CLI never prints values (§4.3).

### 4.7 The skill
- **Description:** lists the trigger phrases: "set up Cloudflare", "continue prototype setup", "continue setup", `/prototype-framework …`.
- **Text:** a short "Cloudflare setup" section that runs `npm run cloudflare-setup` and relays its output as is. It covers the rules of §4.5 and §4.6, and what to do on each of the setup command's stop messages.
- **`owner-tasks.md`:** rewritten around the two links and one command. README §2–§3 shrink to a pointer.

### 4.8 Getting the skill into an empty cloud session (to test)
A cloud environment setup script that copies the skill, pinned to a release tag, into `~/.claude/skills/prototype-framework`:
```sh
set -euo pipefail
d=$(mktemp -d)
git clone -q --depth 1 --branch v<version> https://github.com/lago-morph/cloud-app "$d"
mkdir -p ~/.claude/skills
rm -rf ~/.claude/skills/prototype-framework
cp -r "$d/skill" ~/.claude/skills/prototype-framework
rm -rf "$d"
```
The docs don't say whether such a skill is loaded. The owner tests it by adding the script to an environment and asking a new session which skills it has. If it works, this becomes the recommended cloud start, alongside the copy committed in each app repository. If it doesn't, the cloud start is a repository made with the starter.

### 4.9 Docs
- **New `QUICKSTART.md`:** one page covering local in one line, Cloudflare in one command, cloud and command-line variants, and the requirements.
- **Template README:** remove the stale "not yet verified on Cloudflare" line; §2–§3 point to the quickstart.
- **`docs/RELEASING.md`:** add that the permission list (§4.1) and `ACCOUNT_SETUP_VERSION` must be raised whenever a release needs more.

## 5. Spec changes
- **New decisions:**
  - the bootstrap token, made in the dashboard (supersedes DEC-0551's "setup token" text, and keeps its minimal everyday set);
  - the versioned permission list;
  - `.env.cloudflare` and its order relative to the environment;
  - updating the everyday token in place;
  - the setup record's version;
  - the three-place git-ignore check;
  - no token value is ever printed.
- **`cli.md`:** a new `cloudflare-setup` command. `setup-account` stays, as a step it calls, for scripts and advanced users.
- **`provisioning.md` and `cloudflare.md`:** the token sources, the setup record, the account-switch behaviour.
- **`compliance.md`:** how the harness supplies tokens. It keeps creating its own restricted test tokens (DEC-0531), and must never delete or edit the owner's tokens.
- **New criteria**, for example:
  - a SETUP-AC series for the state machine's outcomes;
  - CLI-AC for the git-ignore failures;
  - SKILL-AC for the trigger phrases and the no-read rule.

## 6. Tests
- **Unit, against the fake Cloudflare API:**
  - every state-machine branch of §4.3 and every row of §3.4;
  - the deep-link generator against the permission list;
  - the in-place update;
  - self-deletion;
  - the file edits: comment-out, fill-in, mode 600, environment/file precedence;
  - the git-ignore and tracked-file warnings (never failures);
  - local setup run first when missing;
  - that no output ever contains a token value (a fake token with a marker string, searched for in every output).
- **Integration:** run the starter offline, then `cloudflare-setup` with no tokens, and check the exact printed links and template.
- **Live, in a milestone pass:**
  1. a real bootstrap and everyday pair on a test account: fresh setup;
  2. a re-run that needs nothing;
  3. an in-place upgrade (a permission removed by the harness, then restored by setup);
  4. bootstrap self-deletion;
  5. a bad-paste message.
  
  These need a dashboard-made bootstrap token: the API can't create one (§2). So that run needs the owner to supply one, or else uses the account's existing dashboard token, read-only except for its own temporary tokens.
- **Owner checks, once each:** the 7-group everyday link (§2), and the setup-script skill load (§4.8).

## 7. Work breakdown
1. **Permission list and deep links** (§4.1): code, generated tables, unit tests.
2. **Token sources and `.env.cloudflare` handling** (§4.2), plus the git-ignore warnings in the CLI and `verify` (§4.5).
3. **Setup record and idempotent setup steps** (§4.4): refactor `setup-account` into steps that are checked first and then applied.
4. **The `cloudflare-setup` state machine** (§4.3), including the in-place update and self-deletion.
5. **Starter one-line local start** (§3.1).
6. **Skill, settings deny rule, quickstart and docs** (§4.6, §4.7, §4.9), plus the spec changes (§5).
7. **Test author:** the new criteria and tests (§6); then independent review; then a live milestone pass.

Batches 1–3 can run in parallel; 4 needs them; 5 and 6 can run alongside 4.

## 8. Risks and open points
- **Copying the file between projects:** this deliberately spreads one everyday token across projects, so a leak exposes every project on the account. The token can't create tokens and has no zone write access.
- **Cloud sessions:** the user still has to paste two values into the environment settings and start a new session. No safer path exists there.
- **Pre-filled links:** if Cloudflare changes the deep-link format, the links break. Setup's permission checks still catch a wrongly made token.
- **A future release that needs a permission an existing bootstrap token lacks:** the user makes a new bootstrap token from the new link. The everyday token is still upgraded in place.
