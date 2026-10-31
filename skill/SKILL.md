---
name: prototype-framework
description: Build, test and deploy small web apps on the portable prototype framework (@lago-morph/prototype-framework), and set up Cloudflare for them. Use when creating or changing an app built from apps/template; when its verify, smoke or deploy fails; when the user says "set up Cloudflare", "continue prototype setup" or "continue setup"; or on /prototype-framework … (for example /prototype-framework setup cloudflare, /prototype-framework continue setup).
---

# Building apps on the prototype framework

Apps are small (one or a few users, little data) and run unchanged locally and on Cloudflare. The framework gives each request handler SQL, KV, files, configuration, secrets, a log and the current user; app code never sees which cloud it runs on. Package: `@lago-morph/prototype-framework` (server code), `/client` (browser code), `/testing` (tests). Commands: `npm run <command>` (flags after `--`), or `npm exec --no -- prototype-framework <command>`; never plain `npx`, which fetches a stranger's package of that name when the app is not installed.

**First step of every session:** run `npm run version-check`. It changes nothing; relay its suggestions as it prints them, and its "newer npm release" one only once per session. If the app is not installed yet (no `node_modules`), skip the check until `npm install` has run. Then run the git checks of [Cloudflare setup](#cloudflare-setup).

Read this page, then only the references your task needs (task map below).

## Hard rules

1. **Use only the framework's public exports**: `@lago-morph/prototype-framework` in server code, `/client` in browser code, `/testing` in tests, plus `hono` and `zod`. No platform SDKs, database drivers, Node built-ins or other framework subpaths.
2. **Never insert user text as HTML.** Build elements and set `textContent`; no `innerHTML` or other raw-HTML sinks.
3. **Pass `npm run verify` before declaring any work done**, including its e2e-api tests, and `npm run test:e2e:ui` when a page changed. Never skip or weaken a test, and never disable, suppress or weaken a check (`eslint-disable`, `@ts-ignore`, `any`, `as` casts, editing lint configuration).
4. **Claim an app works on a cloud only after its smoke test has passed on a deployed stage there** (`smoke --target <t> --stage test-…`). Local success says nothing about a cloud.
5. **Never change framework version pins**: the exact versions of `@lago-morph/prototype-framework`, `hono`, `zod`, `typescript`, `vite`, `vitest` and `@playwright/test` in the app's `package.json`.
6. **Never work around the framework.** If you suspect a framework defect (a contract or reference that does not hold, a check that rejects code the references allow, a capability that is missing for the task), add an entry to `FRAMEWORK-ISSUE.md` at the app's root instead of patching, copying or bypassing framework code. Each entry states:
   - the task attempted;
   - the contract or reference consulted (file and section);
   - a minimal reproduction (the smallest code and the command that shows it);
   - the observed code or diagnostic, copied exactly (error code, `verify` line, request ID);
   - the workaround not taken.

   Use [templates/FRAMEWORK-ISSUE.md](templates/FRAMEWORK-ISSUE.md).
7. **After recording an entry**, stop work on the blocked requirement; continue only work that does not depend on it; report the issue and the list of unfinished requirements to the user; and do not declare the app done.
8. **A cloud run that cannot go ahead is not a framework issue** (Cloudflare not set up yet, a run paused, a quota used up). Do not add a `FRAMEWORK-ISSUE.md` entry for it; in your build record, list each check that needs it as `blocked` with the reason.

## Cloudflare setup

On "set up Cloudflare", "continue prototype setup" or "continue setup", run `npm run cloudflare-setup` and relay its output as is: links, template and next prompt unchanged. It does only what is missing, so run it again whenever asked. Exit status 1 with a message is a stop for the user, not a failure to work around. The flow: the owner makes the bootstrap token from its link (expiry at most 1 day); setup deploys the admin app and deletes that token; the owner signs in to the admin app, does account setup there, and makes and saves the everyday token; then "continue prototype setup" checks it. Steps and stops: [owner-tasks.md](reference/owner-tasks.md) §2.

- **Never open, print or search `.env.cloudflare`**, and never echo `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_BOOTSTRAP_TOKEN`. The CLI reads them itself. Never ask for a token in the chat.
- **Git checks**, when a session starts work on the app and before every commit or push: `git check-ignore -q .env.cloudflare` and `git ls-files --error-unmatch .env.cloudflare`. Each time the file is not ignored (the first exits non-zero) or is tracked (the second exits 0), remind the user and point to [owner-tasks.md](reference/owner-tasks.md) §2. Never refuse to commit because of it.

## Task map

| Task | Read |
| --- | --- |
| Start a new app; run it locally | [local-development.md](reference/local-development.md) |
| Add an endpoint (route, validation, error codes, browser call) | [http-and-validation.md](reference/http-and-validation.md), then the capability it uses |
| Store data | Records you query: [sql-and-migrations.md](reference/sql-and-migrations.md). Small values by key: [kv.md](reference/kv.md) |
| Change a table (migration) | [sql-and-migrations.md](reference/sql-and-migrations.md) |
| Handle files (upload, download) | [files.md](reference/files.md) |
| Add an admin page; restrict who may log in | [current-user.md](reference/current-user.md), [http-and-validation.md](reference/http-and-validation.md) |
| Add a per-stage setting | [configuration.md](reference/configuration.md) |
| Use an API key; sign or verify data | [secrets.md](reference/secrets.md) |
| Record what happened | [log.md](reference/log.md) |
| Test (TDD, in-process, e2e, smoke, fuzz); a test or check fails; a test must change | [testing.md](reference/testing.md), then the one file under `reference/testing/` it names |
| Deploy, run the smoke test on a cloud, remove a stage | [deploying.md](reference/deploying.md) |
| Diagnose a failing request or deploy; a `verify` diagnostic | [troubleshooting.md](reference/troubleshooting.md), and the reference the diagnostic names |
| Set up Cloudflare; steps the owner performs (bootstrap token and admin app, secrets, sign-in, admins, deploy and remove, logs) | [owner-tasks.md](reference/owner-tasks.md) |

Every `verify` diagnostic ends with `(read skill/reference/<file>.md)`; that file has a "Check rules that send you here" section for the rule.

## Examples and templates

Examples are whole files copied unchanged from the template and the reference app, type-checked and tested in CI: [endpoint-and-page](examples/endpoint-and-page.md), [notes-sql](examples/notes-sql.md), [status-kv](examples/status-kv.md), [files-tickets](examples/files-tickets.md), [admin-and-current-user](examples/admin-and-current-user.md), [secrets](examples/secrets.md), [configuration](examples/configuration.md), [tests](examples/tests.md). Start from the template, not from any other app.

A new app starts from the template: `npm create @lago-morph/prototype-app@latest <dir>`, or `skill/scripts/scaffold <dir>` in the framework repository ([local-development.md](reference/local-development.md)); [templates/](templates/README.md) holds the files you fill in.

## Done means

`npm run verify` passes; every requirement is implemented and tested, each flow end to end ([testing.md](reference/testing.md)); for each cloud you claim, the smoke test passed on a deployed test stage there; and `FRAMEWORK-ISSUE.md` has no open entry blocking a requirement. Cloud runs that could not go ahead are listed as unfinished (`not-run` or `blocked`, hard rule 8), not raised as issues.
