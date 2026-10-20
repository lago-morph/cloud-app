# Deploying

Read this when you deploy, smoke-test, stop, start or remove a stage on a cloud. Account setup, the API token, secrets and the Google client are in [owner-tasks.md](owner-tasks.md).

Commands run in the app's directory, with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set ([owner-tasks.md](owner-tasks.md) §2). Each `npm run <command> -- …` is the same as `npx prototype-framework <command> …`. Behind an HTTPS proxy, put `NODE_USE_ENV_PROXY=1 ` in front of every cloud command; the command says so if it is needed.

**Status in this phase:** every command on this page is **not yet verified on Cloudflare in this phase**. The framework's cloud commands have run only against a simulated Cloudflare. Only the Cloudflare API calls for stop and start (§4) were tried on a real Worker. The AWS target is not available yet.

## 1. Test stages and production stages

- A stage whose name starts with `test-` is a **test stage**. It uses `config/cloudflare/test.json` and the mock login, holds no real data, and is removed after use.
- Every other stage is a **production stage**, for example `prod`. It needs its own committed `config/cloudflare/<stage>.json` with `framework.google.clientId`, and the Google client secret ([owner-tasks.md](owner-tasks.md) §5).
- A stage name is at most 20 lowercase letters, digits and hyphens. The stage's address is `https://<app>-<stage>.<subdomain>.workers.dev`.

## 2. Deploy and smoke-test a test stage

```sh
npm run verify
npm run deploy -- --target cloudflare --stage test-<your initials><number>
```

On a stage's first deploy, `deploy` stops after creating the Worker if a declared secret is not set yet. It names the missing secrets. Set each one with `npm run secrets -- set <name> --target cloudflare --stage <stage>`, then run the same `deploy` again.

A successful deploy prints the stage's address and checks `/api/__framework/health`. Then run the app's smoke tests against the stage. Commit first: `smoke` refuses to run with uncommitted changes.

```sh
npm run smoke -- --target cloudflare --stage test-<…>
```

`smoke` writes an evidence record under `validation/cloudflare/` and prints the day's log location. Only claim that the app works on Cloudflare after `smoke` has passed there.

## 3. Deploy a production stage

1. Create and commit `config/cloudflare/<stage>.json`, including the Google client ID ([owner-tasks.md](owner-tasks.md) §5–§6).
2. Deploy, set the secrets the deploy names (the app's secrets and `frameworkGoogleClientSecret`), then deploy again:
   ```sh
   npm run deploy -- --target cloudflare --stage prod
   npm run secrets -- set frameworkGoogleClientSecret --target cloudflare --stage prod
   npm run secrets -- set apiKey --target cloudflare --stage prod
   npm run deploy -- --target cloudflare --stage prod
   ```
3. Register the printed `Google callback URL to register` on the Google client, if you have not yet.

To change a production stage later (code, admins, users), commit the change and run `deploy` again. A deploy that changes the database schema first copies the database, migrates the copy, and then switches to it. While it does this, the app is stopped. If the migration fails, the previous version is restarted on the unchanged database.

## 4. Stop and start a stage

There is no stop command. Stopping turns off the stage's address. Its code, data and secrets stay, and storage stays billable.

- **Dashboard:** open Workers & Pages → `<app>-<stage>` → Settings → Domains & Routes. Disable `workers.dev` to stop the stage, and enable it again to start it. While the stage is stopped, its address answers 404 (error code 1042).
- **Command line:**
  ```sh
  WORKER=<app>-<stage>
  # stop:
  curl -sS -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
    -d '{"enabled":false,"previews_enabled":false}' \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER/subdomain"
  # start: the same command with "enabled":true
  ```
- Every `deploy` also starts the stage.

## 5. Remove a stage

```sh
npm run remove -- --target cloudflare --stage test-<…>
```

This deletes the stage's Worker and secrets, its D1 databases, its R2 bucket and the files in it, its file-signing token, and its deploy state. Log entries in `prototype-logs` and the shared buckets stay. If something cannot be deleted, `remove` prints each leftover and exits non-zero. Run it again, or delete the printed resource in the dashboard.

A production stage holds real data, and removing it deletes the database with no backup. `remove` refuses unless you repeat the stage name:

```sh
npm run remove -- --target cloudflare --stage prod --confirm-production prod
```

## 6. What stays billable while idle

- each stage's D1 database and R2 file bucket, until the stage is removed;
- the shared `prototype-logs` bucket, which grows with every log entry. To delete old entries, open R2 → `prototype-logs` → Settings → Object lifecycle rules → add a rule that deletes objects after, for example, 30 days. Not yet verified on Cloudflare in this phase;
- the shared `sst-state` bucket, which is small;
- leftover test stages. Find them in Workers & Pages (Workers named `<app>-test-…`) and in D1 (databases named `<app>-test-…-db-<n>`). Remove them with `remove`.

On the free plan, D1 allows about 100,000 rows written per day per account. Keep test data to a few rows and remove test stages promptly.

## Examples

- [examples/tests.md](../examples/tests.md): the smoke test that `smoke` runs against a deployed test stage.

## Stopping condition

Stop reading when the stage is deployed and its smoke test passed, or it is stopped, started or removed with no leftovers printed. For a failure, go to [troubleshooting.md](troubleshooting.md).
