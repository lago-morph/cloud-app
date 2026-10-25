# Deploying

Read this when you deploy, smoke-test, stop, start or remove a stage on a cloud. Account setup, the API token, the email domain, secrets, sign-up and admins are in [owner-tasks.md](owner-tasks.md).

Commands run in the app's directory, with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set ([owner-tasks.md](owner-tasks.md) §2). Each `npm run <command> -- …` is the same as `npx prototype-framework <command> …`. Behind an HTTPS proxy, put `NODE_USE_ENV_PROXY=1 ` in front of every cloud command; the command says so if it is needed.

**Status in this phase:** every command on this page is **not yet verified on Cloudflare in this phase**. The framework's cloud commands have run only against a simulated Cloudflare. Only the Cloudflare API call that `stop` and `start` use (§4) was tried on a real Worker. AWS is a future release: this release deploys to Cloudflare only.

## 1. Test stages and production stages

- A stage whose name starts with `test-` is a **test stage**. It uses `config/cloudflare/test.json`, has the mock login for tests beside email-and-password sign-in, keeps its mail in a test capture (never sent), holds no real data, and is removed after use.
- Every other stage is a **production stage**, for example `prod`. It needs its own committed `config/cloudflare/<stage>.json` ([owner-tasks.md](owner-tasks.md) §5) and the account's email domain (§3 there). It has no mock: people sign up with email and password, and real mail is sent from `no-reply@<domain>`.
- A stage name is at most 20 lowercase letters, digits and hyphens. The stage's address is `https://<app>-<stage>.<subdomain>.workers.dev`.

## 2. Deploy and smoke-test a test stage

Set the stage name once in the terminal, then use `$STAGE`. In a new terminal, set it again.

```sh
STAGE=test-<your initials><number>
npm run verify
npm run deploy -- --target cloudflare --stage "$STAGE"
```

On a stage's first deploy, `deploy` stops after creating the Worker if a declared secret is not set yet. It names the missing secrets. Set each one with `npm run secrets -- set <name> --target cloudflare --stage "$STAGE"`, then run the same `deploy` again.

A successful deploy prints the stage's address and checks `/api/__framework/health`. Then commit (`smoke` refuses to run with uncommitted changes; if git says there is nothing to commit, carry on) and run the app's smoke tests against the stage:

```sh
git add -A
git commit -m "Changes before the smoke test"
npm run smoke -- --target cloudflare --stage "$STAGE"
```

`smoke` writes an evidence record under `validation/cloudflare/` at the top of the git repository that holds the app (the app directory when the app is its own repository; commit it with the run's commit) and prints the day's log location. Only claim that the app works on Cloudflare after `smoke` has passed there.

## 3. Deploy a production stage

1. Create and commit `config/cloudflare/<stage>.json` from `skill/templates/production-stage.json`, with the commands in [owner-tasks.md](owner-tasks.md) §5.
2. Deploy, set the secrets the deploy names (the app's secrets; the framework generates its own), then deploy again:
   ```sh
   STAGE=prod
   npm run deploy -- --target cloudflare --stage "$STAGE"
   npm run secrets -- set apiKey --target cloudflare --stage "$STAGE"
   npm run deploy -- --target cloudflare --stage "$STAGE"
   ```
   It prints the stage's address, its sign-in page and the sender address.
3. Sign up on the stage, then make yourself an admin with `admins grant` ([owner-tasks.md](owner-tasks.md) §6, §7). Admins change without a deploy.

To change a production stage later (code or configuration), commit the change and run `deploy` again:

```sh
git add -A
git commit -m "<what you changed>"
npm run deploy -- --target cloudflare --stage "$STAGE"
```

A deploy that changes the database schema first copies the database, migrates the copy, and then switches to it. While it does this, the app is stopped. The output says how the database was copied: `D1 native export/import` (fast), or `row-by-row copy (<reason>)` when the data has a shape the fast copy cannot carry. If the migration fails, the previous version is restarted on the unchanged database.

## 4. Stop and start a stage

```sh
npm run stop -- --target cloudflare --stage "$STAGE"
npm run start -- --target cloudflare --stage "$STAGE"
```

Stopping turns off the stage's address; it then answers 404 (error code 1042). Its code, data and secrets stay, and storage stays billable. The stop is recorded with the stage, so a later `deploy` leaves the stage stopped and skips its health check. To deploy and start it in one step, add `--start`:

```sh
npm run deploy -- --target cloudflare --stage "$STAGE" --start
```

Do not stop a stage in the dashboard: `deploy` does not know about that stop and turns the address back on.

## 5. Remove a stage

```sh
npm run remove -- --target cloudflare --stage "$STAGE"
```

This deletes the stage's Worker and secrets, its D1 databases, its R2 bucket and the files in it, and its deploy state. Log entries in `prototype-logs`, the shared buckets and the account's file-signing credential stay. If something cannot be deleted, `remove` prints each leftover and exits non-zero. Run it again, or delete the printed resource in the dashboard.

A production stage holds real data. `remove` refuses unless you repeat the stage name, and it first backs the stage up:

```sh
npm run remove -- --target cloudflare --stage prod --confirm-production prod
```

The backup goes to the bucket `prototype-backups`, under `<app>/<stage>/<time>/`: `database/<name>.sql` (the D1 export), `database/<name>.lossless.json` and `database/<name>.restore.sql` when a table holds a value the D1 export does not keep exactly (a NUL character in text, or an integer beyond ±2^53), `files/000001`, `files/000002`, … (every stored file, numbered; `manifest.json` names each one's original key) and `manifest.json`. `remove` prints every backup of the stage, the one to restore from first; one marked "do not restore from it" is incomplete (for example written by a second `remove` after the first had already deleted the database). It is deleted automatically after 30 days. If any part of the backup fails, `remove` deletes nothing and exits non-zero. Secrets are not backed up.

**Restore a removed production stage** (within the 30 days; download the backup's objects from the R2 dashboard or with an S3 client first, using an R2 API token of your own: the stages' file-signing credential cannot read this bucket):
1. `npm run deploy -- --target cloudflare --stage prod`, set the app's secrets with `secrets set`, then `npm run stop -- --target cloudflare --stage prod`.
2. Replace the new, empty database with the export, under the same name (`APP`: the command at the top of [troubleshooting.md](troubleshooting.md)):
   ```sh
   npx wrangler d1 delete "$APP-prod-db-1"
   npx wrangler d1 create "$APP-prod-db-1"
   npx wrangler d1 execute "$APP-prod-db-1" --remote --file database/<name>.sql
   ```
   A row larger than about 100 KB is refused by the import; insert it by hand. If `manifest.json` has a `lossless` entry for the database, run its restore file instead of `database/<name>.sql`; it is the export with that table's rows written exactly:
   ```sh
   npx wrangler d1 execute "$APP-prod-db-1" --remote --file database/<name>.restore.sql
   ```
   In it, text and binary values are written as hex, twice their size, so a large row there is refused sooner (over about 100 KB of statement); insert that row by hand too.
3. Copy each `files/<number>` object back into the bucket `<app>-prod-files` under the key its `fileObjects` entry in `manifest.json` names, with its content type, using an S3 client on the R2 endpoint, which keeps each key exactly (keys end in an invisible U+0001).
4. `npm run deploy -- --target cloudflare --stage prod --start`.

## 6. What stays billable while idle

- each stage's D1 database and R2 file bucket, until the stage is removed;
- the shared `prototype-logs` bucket, which grows with every log entry. To delete old entries, open R2 → `prototype-logs` → Settings → Object lifecycle rules → add a rule that deletes objects after, for example, 30 days. Not yet verified on Cloudflare in this phase;
- the shared `sst-state` bucket, which is small;
- the shared `prototype-backups` bucket, while it holds backups of removed production stages (30 days);
- leftover test stages. Find them in the dashboard (menu names not yet verified) in Workers & Pages (Workers named `<app>-test-…`) and in D1 (databases named `<app>-test-…-db-<n>`). Remove them with `remove`.

On the free plan, D1 allows about 100,000 rows written per day per account. Keep test data to a few rows and remove test stages promptly.

## Examples

- [examples/tests.md](../examples/tests.md): the smoke test that `smoke` runs against a deployed test stage.
- [examples/configuration.md](../examples/configuration.md): the template's values file for Cloudflare test stages (`config/cloudflare/test.json`); a production stage needs its own `config/cloudflare/<stage>.json` in the same place.

## Stopping condition

Stop reading when the stage is deployed and its smoke test passed, or it is stopped, started or removed with no leftovers printed. For a failure, go to [troubleshooting.md](troubleshooting.md).
