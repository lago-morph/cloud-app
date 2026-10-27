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

You need a Cloudflare account on the Workers Paid plan, and a domain on that account with Cloudflare DNS active. In the app's folder, run:

```sh
npm run cloudflare-setup
```

In Claude Code, say "set up Cloudflare" instead. Setup prints two pre-filled dashboard links for the tokens it needs and tells you where to put them. Run it again after pasting them. [QUICKSTART.md](QUICKSTART.md) has every step, including the cloud session variant.

### The Claude Code skill

- **Apps made with `npm create`** already carry the skill in `.claude/skills/prototype-framework/`.
- **Cloud sessions:** add the setup script in [QUICKSTART.md](QUICKSTART.md#the-skill-in-every-cloud-session-the-setup-script) to your environment's settings.
- **Command line, as a plugin:** `/plugin marketplace add lago-morph/cloud-app`, then `/plugin install prototype-framework@lago-morph`.

### Upgrade an app

```sh
npm run upgrade
```

This moves the app to the latest framework release, refreshes its skill copy and runs `npm run verify`. `npm run version-check` only reports whether a newer release exists. See [CHANGELOG.md](CHANGELOG.md) for what each release changes.

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
