---
name: prototype-framework
description: Build, test and deploy small web apps on the portable prototype framework (@lago-morph/prototype-framework). Use when creating or changing an app built from apps/template, or when its verify, smoke or deploy fails.
---

# Building apps on the prototype framework

Apps are small (one or a few users, little data) and are designed to run unchanged locally, on Cloudflare and on AWS. In this phase only local runs are verified: running on Cloudflare is not yet verified, and the AWS target is built but not yet verified on AWS. The framework gives each request handler SQL, KV, files, configuration, secrets, a log and the current user; app code never sees which cloud it runs on. Package: `@lago-morph/prototype-framework` (server code), `/client` (browser code), `/testing` (tests). Commands: `npx prototype-framework <command>`, also `npm run <command>`.

Read this page, then only the references your task needs (task map below).

## Hard rules

1. **Use only the framework's public exports**: `@lago-morph/prototype-framework` in server code, `/client` in browser code, `/testing` in tests, plus `hono` and `zod`. No platform SDKs, database drivers, Node built-ins or other framework subpaths.
2. **Never insert user text as HTML.** Build elements and set `textContent`; no `innerHTML` or other raw-HTML sinks.
3. **Pass `npx prototype-framework verify` before declaring any work done.** Never disable, suppress or weaken a check (`eslint-disable`, `@ts-ignore`, `any`, `as` casts, editing lint configuration).
4. **Claim an app works on a cloud only after its smoke test has passed on a deployed stage there** (`smoke --target <t> --stage test-…`). Local success says nothing about a cloud.
5. **Never change framework version pins**: the exact versions of `@lago-morph/prototype-framework`, `hono`, `zod`, `typescript`, `vite` and `vitest` in the app's `package.json`.
6. **Never work around the framework.** If you suspect a framework defect (a contract or reference that does not hold, a check that rejects code the references allow, a capability that is missing for the task), add an entry to `FRAMEWORK-ISSUE.md` at the app's root instead of patching, copying or bypassing framework code. Each entry states:
   - the task attempted;
   - the contract or reference consulted (file and section);
   - a minimal reproduction (the smallest code and the command that shows it);
   - the observed code or diagnostic, copied exactly (error code, `verify` line, request ID);
   - the workaround not taken.

   Use [templates/FRAMEWORK-ISSUE.md](templates/FRAMEWORK-ISSUE.md).
7. **After recording an entry**, stop work on the blocked requirement; continue only work that does not depend on it; report the issue and the list of unfinished requirements to the user; and do not declare the app done.
8. **A target this phase cannot reach is not a framework issue.** The AWS target has not run on AWS yet, and Cloudflare runs may be paused (for example while a cloud quota is used up). Do not add a `FRAMEWORK-ISSUE.md` entry for that. In your build record, list each requirement or check that needs such a run as unfinished: `not-run` for AWS ("AWS phase not started"), `blocked` with the stated reason for paused Cloudflare runs.

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
| Test (in-process, time-dependent, smoke) | [testing.md](reference/testing.md) |
| Deploy, run the smoke test on a cloud, remove a stage | [deploying.md](reference/deploying.md) |
| Diagnose a failing request or deploy; a `verify` diagnostic | [troubleshooting.md](reference/troubleshooting.md), and the reference the diagnostic names |
| Steps the owner performs (account setup, secrets, Google, admin and user IDs, deploy and remove, logs) | [owner-tasks.md](reference/owner-tasks.md) |

Every `verify` diagnostic ends with `(read skill/reference/<file>.md)`; that file has a "Check rules that send you here" section for the rule.

## References

- [http-and-validation.md](reference/http-and-validation.md): routes, guards, validation, error codes, browser calls, HTML safety.
- [sql-and-migrations.md](reference/sql-and-migrations.md): tables, the portable query subset, `atomic`, migrations.
- [kv.md](reference/kv.md): key-value storage.
- [files.md](reference/files.md): tickets, the safe upload pattern, downloads.
- [secrets.md](reference/secrets.md): declaring, reading and setting secrets; HMAC signing.
- [configuration.md](reference/configuration.md): config keys and per-stage values files.
- [current-user.md](reference/current-user.md): levels, admin and users lists, login, login tests.
- [log.md](reference/log.md): writing entries and where they go.
- [local-development.md](reference/local-development.md): scaffolding, `dev`, local state.
- [testing.md](reference/testing.md): `createTestApp`, fake timers, the smoke test.
- [deploying.md](reference/deploying.md): stages, deploy, smoke, remove.
- [troubleshooting.md](reference/troubleshooting.md): finding log entries, error codes, login failures.
- [owner-tasks.md](reference/owner-tasks.md): the owner's copy-and-paste steps.

## Examples and templates

Examples are whole files copied unchanged from the framework's template and compliance reference app, which CI type-checks and tests: [endpoint-and-page](examples/endpoint-and-page.md), [notes-sql](examples/notes-sql.md), [status-kv](examples/status-kv.md), [files-tickets](examples/files-tickets.md), [admin-and-current-user](examples/admin-and-current-user.md), [secrets](examples/secrets.md), [configuration](examples/configuration.md), [tests](examples/tests.md). Start from the template, not from any other app.

The scaffolder (`skill/scripts/scaffold <dir>`) copies `apps/template`; [templates/](templates/README.md) holds the other files you fill in.

## Done means

`npx prototype-framework verify` passes; every requirement is implemented and tested; for each cloud you claim, the smoke test passed on a deployed test stage there; and `FRAMEWORK-ISSUE.md` has no open entry blocking a requirement. Runs on a target this phase cannot reach are listed as unfinished (`not-run` or `blocked`, hard rule 8), not raised as issues.
