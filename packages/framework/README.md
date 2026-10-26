# @lago-morph/prototype-framework

A small framework for prototype web apps (one or a few users, little data) that run unchanged on your computer and on Cloudflare. Each request handler gets SQL, key-value storage, files, configuration, secrets, a log and the current user through one API; app code never sees which platform it runs on.

Release 1 targets **local and Cloudflare**. Local development is verified. The Cloudflare commands have run against a simulated Cloudflare; see the repository for what is verified on a real account. AWS is a future release.

## Start a new app

```sh
npm create @lago-morph/prototype-app@latest my-app
cd my-app
npm run dev
```

This copies the template app, pins this package at the exact released version, and installs the Claude Code skill for the framework into `.claude/skills/`. Node.js 22.22.0 is required (`engines`).

## Entry points

| Import | Use it in |
| --- | --- |
| `@lago-morph/prototype-framework` | Server code: `defineApp`, routes, SQL tables, configuration and secret declarations |
| `@lago-morph/prototype-framework/client` | Browser code |
| `@lago-morph/prototype-framework/testing` | App tests |

The other subpaths (`/targets/*`, `/provision`, `/check`) are used by the command line tool and are not for app code.

## Commands

Run them in an app's folder as `npx prototype-framework <command>` or `npm run <command>`:

`dev`, `verify`, `build`, `generate-migration`, `deploy`, `smoke`, `remove`, `stop`, `start`, `secrets`, `cloudflare-setup`, `setup-account`, `check-login`, `mail`, `admins`, `reset-local`, `version-check`, `upgrade`.

`cloudflare-setup` sets up Cloudflare from two pre-filled token links; see the [quickstart](https://github.com/lago-morph/cloud-app/blob/main/QUICKSTART.md).

`verify` runs the type check, the portability lint, the app's tests and the migration checks. Run it before calling a change done.

## Documentation

- The Claude Code skill (also a plugin: `/plugin marketplace add lago-morph/cloud-app`, then `/plugin install prototype-framework@lago-morph`): [skill/SKILL.md](https://github.com/lago-morph/cloud-app/blob/main/skill/SKILL.md)
- The template app and the owner's step-by-step guide: [apps/template/README.md](https://github.com/lago-morph/cloud-app/blob/main/apps/template/README.md)
- Specification and design: [docs/](https://github.com/lago-morph/cloud-app/tree/main/docs)
- Changes: [CHANGELOG.md](https://github.com/lago-morph/cloud-app/blob/main/CHANGELOG.md)

## License

MIT
