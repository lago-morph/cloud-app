# Prototype Framework

A small framework for prototype web apps (one or a few users, little data) that run unchanged on your computer and on Cloudflare Workers. It is made to be used with [Claude Code](https://claude.com/claude-code), in a cloud session or on the command line, but works as a normal command line tool too.

Each request handler gets SQL tables, key-value storage, files, configuration, secrets, a log and the signed-in user through one API. App code never sees which platform it runs on. Release 1 targets local development and Cloudflare. AWS is planned for a later release.

## What's in this repository

| Path | What it is |
| --- | --- |
| [`packages/framework`](packages/framework/README.md) | `@lago-morph/prototype-framework`: the framework and its command line tool `prototype-framework` |
| [`packages/create-prototype-app`](packages/create-prototype-app) | `@lago-morph/create-prototype-app`: `npm create @lago-morph/prototype-app` |
| [`packages/prototype-framework-skill`](packages/prototype-framework-skill) | `@lago-morph/prototype-framework-skill`: the Claude Code skill alone, for a cloud environment's setup script |
| [`skill/`](skill/SKILL.md) | The Claude Code skill and plugin `prototype-framework` |
| [`apps/template`](apps/template/README.md) | The app that `npm create` copies |
| `apps/reference`, `apps/demo` | Example apps used by the tests |
| [`docs/`](docs/README.md) | Specification and design documents |
| `tests/compliance` | The compliance tests that check the specification |

## Install

You need Node.js 22.22.0 and git. Local development needs no account of any kind.

### Start a new app

```sh
npm create @lago-morph/prototype-app@latest my-app
cd my-app
npm run dev
```

This makes the folder `my-app` from the template app and installs its dependencies. It copies the Claude Code skill into `.claude/skills/`, gives each secret a random local value and makes a git repository with a first commit. You can also open the folder in Claude Code and say what to build.

### Put it on Cloudflare

You need a Cloudflare account. The Workers Free plan is enough. Setup has two parts: a short command with a one-time bootstrap token, then the admin app in your browser.

1. In the app's folder, run:

   ```sh
   npm run cloudflare-setup
   ```

   In Claude Code, say "set up Cloudflare" instead. Setup prints a pre-filled dashboard link for the bootstrap token and tells you where to put it (`CLOUDFLARE_BOOTSTRAP_TOKEN`). Give the token an expiry of 1 day or less: setup deletes a token that lives longer, or has no expiry, at once.
2. Run setup again with the bootstrap token. It creates the account's two OAuth clients, keeps their secrets in Cloudflare Secrets Store, deploys the admin app and prints its address. Then setup deletes the token and comments out its line in `.env.cloudflare`; in a cloud session you can remove the environment setting. The token is used once and never stored.
3. Open the admin app and sign in with Cloudflare, as an administrator of the account. Its Account setup page deploys the auth app and creates the account's shared resources. Its Everyday token page makes the everyday token, which `deploy` and the other Cloudflare commands use, and shows it once, to you and not to the agent. Save it as `CLOUDFLARE_API_TOKEN`.
4. Say "continue prototype setup", or run `npm run cloudflare-setup` again, to check that everything works.

[QUICKSTART.md](QUICKSTART.md) has every step, including the cloud session variant.

### Sign-in

On Cloudflare, people sign in with their Cloudflare account, through the account's auth app. One auth app signs people in for all your apps, and the apps themselves hold no Cloudflare credential. Only members of your Cloudflare account can sign in. A member whose account role is an administrator role is the app's admin; any other member is a user. To make someone an admin, change their role in the Cloudflare account: it takes effect at their next sign-in or role refresh.

Locally and on `test-` stages, the authentication mock signs people in instead, so development and tests need no real sign-in.

### The Claude Code skill

- **Apps made with `npm create`** already carry the skill in `.claude/skills/prototype-framework/`.
- **Cloud sessions:** add the setup script in [QUICKSTART.md](QUICKSTART.md#the-skill-in-every-cloud-session-the-setup-script) to your environment's settings.
- **Command line, as a plugin:** `/plugin marketplace add lago-morph/cloud-app`, then `/plugin install prototype-framework@lago-morph`.

### Upgrade an app

```sh
npm run upgrade
```

This moves the app to the latest framework release, refreshes its skill copy and runs `npm run verify`. `npm run version-check` only reports whether a newer release exists. See [CHANGELOG.md](CHANGELOG.md) for what each release changes.

### Upgrade from 0.1.x

0.2.0 replaces sign-in by email and password with sign-in with Cloudflare. It is a breaking release (before 1.0.0, a minor version may make breaking changes):

- **Password accounts and sessions are dropped.** Everyone signs in again with Cloudflare. New framework migrations drop the old sign-in and test-mail tables; they run with the app's migrations (locally, on the next `npm run dev`).
- **Removed:** the password pages and endpoints, the `mail` command and the mail sink, the email domain and Email Service setup, and the `admins` command, with the template's `mail` and `admins` scripts. Admins are now the account's administrators (see [Sign-in](#sign-in)). Cloudflare setup no longer needs Workers Paid or a domain on Cloudflare DNS.
- **Set up again.** `npm run upgrade` to 0.2.0 points you to setup: a new bootstrap token, then the admin app ([Put it on Cloudflare](#put-it-on-cloudflare)). The Everyday token page brings your existing everyday token to the new permission list, without the email and zone permissions. If it has to make a new token instead, it shows the new value once: save it in place of the old one.
- **Cleanup is optional.** The admin app offers to remove the 0.1.x email resources (routing rules, test mailbox, the `prototype-mailsink` Worker and bucket, the sending domain). It never does so on its own.

## Working on the framework

```sh
git clone https://github.com/lago-morph/cloud-app
cd cloud-app
npm ci
npm run verify
```

`npm run verify` builds the framework, then typechecks, lints and runs the unit tests and the template and reference apps' checks. Start with [docs/README.md](docs/README.md) for the specification, and [docs/RELEASING.md](docs/RELEASING.md) for how releases are published.

## License

[MIT](LICENSE)
