# Troubleshooting

Read this when a request failed and you have its `requestId`, a deploy or `remove` failed, a login failed, or a `verify` diagnostic pointed you here.

Commands run in the app directory. `<stage>` is the stage name, for example `test-abc` or `prod`. `<app>` is the app's name (the template's is `template`). This command prints it and keeps it in `APP`:

```sh
APP=$(npm run --silent build -- --target local --stage local | sed -n 's/^built \([^ ]*\) for .*/\1/p'); echo "$APP"
```

## 1. Find the log entry for a request

Every error response carries a `requestId`, and the browser helpers put it on `ApiError.requestId`. A failed login redirects to `/?authError=login_failed&requestId=<id>`. Look the entry up by that ID.

### Local

Entries are JSON lines in `.logs/<yyyy-mm-dd>.log`. The date is the entry's UTC day.

```sh
grep '<requestId>' .logs/$(date -u +%F).log
grep '"severity":"error"' .logs/$(date -u +%F).log
```

In tests, `createTestApp` keeps entries in memory (`testApp.logs()`) and prints each `error` entry to stderr.

### Cloudflare

Entries are objects in the account's shared R2 bucket `prototype-logs`, one per entry, under this key:

```
<app>/<stage>/<yyyy>/<mm>/<dd>/<hhmmss.sss>-<severity>-<requestId>.json
```

The date and time are UTC. `smoke` prints today's prefix.

**Dashboard (no setup; these menu names are not yet verified).** Open Storage & databases → R2 → `prototype-logs`. Then open the folders `<app>` / `<stage>` / year / month / day. The file name ends in the request ID. Open the file and choose Download to read it.

**Command line, with the API token from [owner-tasks.md](owner-tasks.md) §2.** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` must be set in the shell. These two `curl` commands are **verified on Cloudflare**: on a real test stage, the list command found a failed request's key and the read command returned its `CORE.INTERNAL` entry (E2E-011, Cloudflare pass 2–5; the framework repository's `validation/cloudflare/pass-2to5/SUMMARY.md` and `logs/5-trouble.log`). List one day's keys:

```sh
STAGE='<stage>'; DAY=$(date -u +%Y/%m/%d)
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/prototype-logs/objects?per_page=1000&prefix=$APP/$STAGE/$DAY/" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!r.success){console.error(JSON.stringify(r.errors));process.exit(1)}for(const o of r.result)console.log(o.key)})'
```

Add `| grep '<requestId>'` to the list command to find one request. Add `| grep -- '-error-'` to see only the day's errors. Then read one entry by pasting its key:

```sh
KEY='<paste the key here>'
curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/prototype-logs/objects/$(node -p 'encodeURIComponent(process.argv[1])' "$KEY")"
```

**S3-compatible CLI (optional).** First create a read-only R2 token. Open R2 → Manage R2 API tokens (menu names not yet verified) → Create API token. Choose the permission **Object Read only**, and apply it to the bucket `prototype-logs` only. Copy the Access Key ID and the Secret Access Key. Then run:

```sh
export AWS_ACCESS_KEY_ID='<Access Key ID>' AWS_SECRET_ACCESS_KEY='<Secret Access Key>' AWS_DEFAULT_REGION=auto
aws s3 ls "s3://prototype-logs/$APP/$STAGE/$DAY/" --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com"
aws s3 cp "s3://prototype-logs/$KEY" - --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com"
```

Not yet verified on Cloudflare in this phase.

### When there is no log entry

- An entry is written after the response is sent. Wait a few seconds and list again.
- Check the day: keys use **UTC** dates. Near midnight, also list the previous or next day.
- Some failures happen before the app writes anything: a Worker that does not start, a misconfigured binding, a platform error page. For these, watch the Worker's own output while you reproduce the request:
  ```sh
  npx wrangler tail "$APP-$STAGE" --format pretty
  ```
  It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set. Not yet verified on Cloudflare in this phase.
- If entries are printed as lines starting `[prototype-framework:log]` in `wrangler tail`, the Worker has no `LOGS` binding. Run `deploy` again.
- Locally, entries reach `.logs/` only while `npm run dev` runs. In-process tests write no files.

## 2. What an error code means

Each code's meaning, HTTP status and whether it is retryable are in the framework's error catalogue, `errors.d.ts` (`ERROR_CATALOGUE`). Common cases:

| Code | Usual cause | What to do |
| --- | --- | --- |
| `CORE.INTERNAL` | An uncaught error in app code | Find the log entry. It has the error's name, message and stack. |
| `CORE.MISCONFIGURED` | Invalid configuration or wiring, for example a production stage without `framework.google.clientId` | Fix `config/<target>/<stage>.json`, then deploy again. |
| `SEC.MISSING` | A declared secret has no value in this stage | Set it (see [owner-tasks.md](owner-tasks.md) §4). On Cloudflare, the next request sees it (not yet verified). |
| `SEC.UNDECLARED`, `CFG.UNDECLARED_KEY` | The code reads a name that `src/server/env.ts` does not declare | Declare it, or fix the name. |
| `SQL.UNAVAILABLE`, `KV.UNAVAILABLE`, `FILES.UNAVAILABLE`, `SEC.UNAVAILABLE` | Storage was not reachable in time. On Cloudflare's free plan, the D1 daily limit may be used up | Retry later. Check D1 usage in the dashboard. |
| `SQL.RESULT_TOO_LARGE` | A query returns too much | Paginate the query. |
| `AUTH.UNAUTHENTICATED` / `AUTH.FORBIDDEN` | Not logged in / not admin or not allowed | See §3 and the admin steps in [owner-tasks.md](owner-tasks.md) §6. |
| `AUTH.REQUEST_FORGERY` | A POST/PUT/PATCH/DELETE with a session came from another origin | Use the stage's own URL, not a copy behind another host. |
| `HTTP.NETWORK_ERROR` | The browser got no framework response | Check that the stage is started and the URL is right. |
| `FILES.TRANSFER_FAILED` | A direct upload or download failed or its ticket expired | Request a new ticket and retry. On Cloudflare an expired ticket shows status null (DEC-0101; not yet verified). |

## 3. Login failures

These steps are for production stages, which use Google. They are **not yet verified on Cloudflare in this phase**, because Google login is mocked here. Test stages and local development use the mock and never contact Google.

- **Google shows `Error 400: redirect_uri_mismatch`.** The callback URL is not registered on the Google client. Add `https://<app>-<stage>.<subdomain>.workers.dev/api/auth/callback` exactly. That is the URL `deploy` prints as "Google callback URL to register". See [owner-tasks.md](owner-tasks.md) §5.
- **Google shows "Access blocked" or "app has not completed verification".** The client's audience is in Testing and the person is not a test user. Add their Google account as a test user, or publish the app.
- **The app returns to `/?authError=login_failed&requestId=<id>`.** Find that entry (§1). It is a `warn` entry from `AUTH` with the message `login failed: <reason>`:
  - `transaction missing or expired`: the login took too long, or cookies were blocked. Try again in one tab.
  - `state mismatch`: two logins ran at once. Try again.
  - `provider refused`: the person cancelled, or Google refused the client.
  - `token exchange rejected (HTTP 401)`: the client secret is wrong. Set `frameworkGoogleClientSecret` again ([owner-tasks.md](owner-tasks.md) §5).
  - `token check failed: audience`: `framework.google.clientId` does not belong to this client secret.
  - `provider discovery failed (…)`: Google could not be reached from the Worker. Retry.
- **Logged in, but `/api/auth/me` says `anonymous` with an `unlistedId`.** The stage has a `framework.users` list, and this ID is on neither list. Add it ([owner-tasks.md](owner-tasks.md) §6).

## 4. Deploy, remove and setup failures

`deploy` prints the failed step, the stage's state and the next action. Follow the next action. Common messages:

- `run setup-account … first`: the account's shared resources are missing. See [owner-tasks.md](owner-tasks.md) §3.
- A missing `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID`, or "the permission to create R2 API tokens": see [owner-tasks.md](owner-tasks.md) §2.
- `NODE_USE_ENV_PROXY`: you are behind an HTTPS proxy. Put `NODE_USE_ENV_PROXY=1 ` in front of the command.
- `required secrets are not set: …`: this happens on the first deploy of a stage. Set each named secret with `--target cloudflare`, then run `deploy` again.
- An error about the number of D1 databases: an account holds at most 10, and a schema-changing deploy briefly holds two per stage. Remove unused test stages ([deploying.md](deploying.md)).
- A failure at the migration step: the previous version is restarted on the unchanged database. Fix the migration and deploy again.
- `remove` lists leftovers and exits non-zero: run the same `remove` again. If a leftover stays, delete it in the dashboard by the exact name printed.

## Check rules that send you here

- `prototype-framework/no-suppression-comments`: a comment switched off a check (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`). Remove the comment and fix the code the hidden check reported.
- `@typescript-eslint/no-explicit-any`: the code wrote the type `any`. Give the value a real type, or `unknown` and then check it with Zod or narrow it with `if`.
- `@typescript-eslint/consistent-type-assertions`: the code used a type assertion (`value as T`, `as unknown as T`, `<T>value`). Check the value with a Zod schema, narrow it with `if`, or declare the variable with the type (`const body: T = await res.json()`). `as const` and `satisfies` are allowed.
- `@typescript-eslint/no-non-null-assertion`: the code used the non-null assertion `!`. Handle `undefined` or `null`: `if (x === undefined) throw new FrameworkError(...)`, `??` with a default, or a default in destructuring.
- Any other rule ID without its own reference: fix the reported code. If you think the framework is wrong rather than your code, follow the `FRAMEWORK-ISSUE.md` rule in `skill/SKILL.md`. Do not work around it.

## Examples

- [examples/tests.md](../examples/tests.md): app tests that read the log (`testApp.logs()`) and check error codes and statuses.

## Stopping condition

Stop reading when you have the log entry or error code that explains the failure and the next action to take. If none of the above fits, record a `FRAMEWORK-ISSUE.md` entry.
