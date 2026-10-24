# Owner tasks

Read this when the app's owner must do something only a person can do: set up the Cloudflare account and token or the AWS credentials, set secrets, set up the Google login client, add admin or user IDs, or keep costs down. Give the owner these steps as written. The owner does not read code.

Commands run in a terminal, in the app's directory, on macOS or Linux with Node 22.22.0. Replace `<…>` parts. Never paste a secret value into a command line, a file in the repository, or a chat.

**Status in this phase.** The local steps are verified. Every Cloudflare step is **not yet verified on Cloudflare in this phase**: the framework's cloud commands have run only against a simulated Cloudflare. The Google steps have never been run, because Google login is mocked in this phase. Every AWS step is **not yet verified on AWS**: it has run only against simulated AWS. If a step fails, follow [troubleshooting.md](troubleshooting.md).

## 1. Before anything else (once per checkout)

In this repository the framework is built from source. Run this at the repository root. The last line goes back to the app's directory (here the template's), where every later command runs:

```sh
npm ci
npm run build -w packages/framework
cd apps/template
```

An app made with the scaffolder already has the built framework. There, run `npm install` once in the app's directory.

Some steps need the app's name in `APP` and the stage's name in `STAGE`. Set them once in each new terminal (`<stage>` is for example `test-abc` or `prod`):

```sh
APP=$(npm run --silent build -- --target local --stage local | sed -n 's/^built \([^ ]*\) for .*/\1/p'); echo "$APP"
STAGE='<stage>'
```

## 2. Cloudflare account and API token (once)

1. Sign up or log in at https://dash.cloudflare.com.
2. Copy your **Account ID**. Open Account home, choose your account, and copy the Account ID shown on its overview page. The dashboard menu names in this page are **not yet verified**.
3. Create an **account API token**. Go to Manage Account → Account API Tokens → Create Token → Create Custom Token (not yet verified). Give it a name, such as `prototype-framework`. Add these **Account** permissions:
   - Workers Scripts: Edit (the stage Workers, their secrets, the `workers.dev` address);
   - Workers R2 Storage: Edit (the log bucket, the deploy-state bucket, each stage's file bucket);
   - D1: Edit (each stage's database);
   - Account API Tokens: Edit (each stage gets its own file-signing token).

   Under Account Resources, include only your account. Create the token and copy it now; Cloudflare shows it only once. This list is the framework's reading of the calls it makes. It is **not yet verified on Cloudflare in this phase**. If `deploy` names a missing permission, add it to the token.
4. In each new terminal where you deploy, set both values. The `read` command keeps the token out of your shell history. Paste the token when it waits, then press Enter.
   ```sh
   export CLOUDFLARE_ACCOUNT_ID='<your Account ID>'
   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
   ```
5. Check the token. The output must contain `"success":true`:
   ```sh
   curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify"
   ```

## 2a. AWS account and credentials (once; not yet verified on AWS)

1. Use a temporary AWS account and an IAM user or role (not root) with `AdministratorAccess`. Install the AWS CLI v2 (`aws`).
2. Create an access key, or get temporary credentials (with a session token) from your sign-in portal. Never paste them into a chat or a file.
3. In each new terminal where you deploy, set them. Paste each value when `read` waits, then press Enter. Skip the last line for a permanent key. `export AWS_PROFILE=<name>` also works.
   ```sh
   read -rs AWS_ACCESS_KEY_ID && export AWS_ACCESS_KEY_ID
   read -rs AWS_SECRET_ACCESS_KEY && export AWS_SECRET_ACCESS_KEY
   read -rs AWS_SESSION_TOKEN && export AWS_SESSION_TOKEN
   ```
4. Check them. The output must show your account ID: `aws sts get-caller-identity`

## 3. One-time account setup

```sh
npm run setup-account -- --target cloudflare
```

This creates the shared resources once per account: the log bucket `prototype-logs`, the deploy-state bucket `sst-state`, and the account's `workers.dev` address. Running it again changes nothing. `deploy` never creates these resources. If they are missing, `deploy` stops and tells you to run this command. Not yet verified on Cloudflare in this phase.

**AWS** (the region is chosen once and used by every stage; the default is `us-east-1`):

```sh
npm run setup-account -- --target aws --region <region>
```

It checks that the region offers Aurora PostgreSQL 17 Serverless v2 with the Data API, then creates the log bucket `prototype-logs-<account-id>`, one shared network (a VPC with two private subnets and no NAT or internet gateway) and the deploy-state home. Running it again changes nothing; another `--region` is refused. Not yet verified on AWS.

## 4. Secrets

A secret is read from standard input. Run the command, paste the value, press Enter, then press Ctrl-D. The app declares its secret names in `src/server/env.ts`; the template declares `apiKey`.

- **Local** (needed before the template's admin secret page works; `npm run dev` creates only the framework's own development keys):
  ```sh
  npm run secrets -- set apiKey --target local --stage local
  ```
  The value goes into `.dev.vars`, which git ignores. Restart `npm run dev` after you set it.
- **Cloudflare:** a stage's secrets live on its Worker, so the stage must have been deployed once. The first `deploy` stops and names the secrets that are not set yet. Set each one, then run `deploy` again:
  ```sh
  npm run secrets -- set apiKey --target cloudflare --stage "$STAGE"
  ```
  Not yet verified on Cloudflare in this phase.
- **AWS** (not yet verified on AWS): a secret can be set before the stage's first deploy:
  ```sh
  npm run secrets -- set apiKey --target aws --stage "$STAGE"
  ```

## 5. Google login client (production stages only)

Test stages and local development use a built-in mock login and need none of this. These steps are **not yet verified on Cloudflare in this phase**; no Google client exists yet.

1. With `APP` and `STAGE` set (§1), print your `workers.dev` subdomain and the stage's callback URL:
   ```sh
   SUB=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!r.success){console.error(JSON.stringify(r.errors));process.exit(1)}console.log(r.result.subdomain)})'); echo "$SUB"
   echo "https://$APP-$STAGE.$SUB.workers.dev/api/auth/callback"
   ```
2. Open https://console.cloud.google.com, then create or choose a project.
3. Go to Google Auth Platform (older consoles call it "OAuth consent screen"). Set an app name and a support email. Choose the **External** audience. While the app is in **Testing**, only the Google accounts you add as test users can log in. The framework asks only for `openid` and `profile`.
4. Go to Clients (or APIs & Services → Credentials), then Create client (or Create credentials → OAuth client ID). Choose the application type **Web application**. Under **Authorized redirect URIs**, add the callback URL from step 1. Add one URL per production stage. Create the client.
5. Create the stage's values file `config/cloudflare/$STAGE.json` with the **Client ID**, which is not a secret. Paste the Client ID into the first line, then run all the lines. `build` checks the file; it must print `built …`. Then the file is committed. (Run this only once per stage: it replaces the file, and with it any admins and users.)
   ```sh
   CLIENT_ID='<paste the Client ID>'
   mkdir -p config/cloudflare
   node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({values:{},framework:{google:{clientId:process.argv[2]},admins:[]}},null,2)+"\n")' "config/cloudflare/$STAGE.json" "$CLIENT_ID"
   npm run build -- --target cloudflare --stage "$STAGE"
   git add "config/cloudflare/$STAGE.json"
   git commit -m "Add the values file of stage $STAGE"
   ```
   `"values"` may also set the app's configuration keys; ask the app's developer which.
6. After the stage's first deploy, set the **Client secret** as a secret, never in a file:
   ```sh
   npm run secrets -- set frameworkGoogleClientSecret --target cloudflare --stage "$STAGE"
   ```
7. Run `npm run deploy -- --target cloudflare --stage "$STAGE"` again. It prints `Google callback URL to register: …`, which must match step 4 exactly.

**AWS** (not yet verified on AWS): the callback URL is known only after the first deploy. Skip step 1, create the client without a redirect URI, and write `aws` for `cloudflare` in steps 5–7 and §6. Deploy ([deploying.md](deploying.md) §7), then add the printed `Google callback URL to register` to the client.

## 6. Admins and allowed users

These steps work only on a production stage, which uses Google. Every person's user ID is shown at `/api/auth/me`.

1. The person opens the stage's address (the one `deploy` printed, `https://<app>-<stage>.<subdomain>.workers.dev`), logs in, then opens that address followed by `/api/auth/me`.
2. They copy the value of `"id"`. If they are shown `"level":"anonymous"` with an `"unlistedId"`, they copy that value instead. It looks like `u_` followed by 26 letters and digits. They send it to the owner.
3. The owner adds it to `config/cloudflare/$STAGE.json`, with `STAGE` set (§1). Set `LIST=admins` to make the person an admin, or `LIST=users` to let a known person in. While `"users"` is present, anyone on neither list is anonymous. Without `"users"`, any Google account that logs in counts as a user. Admins need not also be in `"users"`. Paste the ID into the first line, then run both lines; the last command prints the file:
   ```sh
   ID='<user ID>'; LIST=admins; OP=add
   node -e 'const fs=require("fs"),[f,op,list,id]=process.argv.slice(1),c=JSON.parse(fs.readFileSync(f,"utf8")),l=(c.framework[list]??[]).filter(x=>x!==id);c.framework[list]=op==="add"?[...l,id]:l;fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")' "config/cloudflare/$STAGE.json" "$OP" "$LIST" "$ID" && cat "config/cloudflare/$STAGE.json"
   ```
   To take access away, run the same two lines with `OP=remove`.
4. Check the file, commit it, then deploy again:
   ```sh
   npm run build -- --target cloudflare --stage "$STAGE"
   git add "config/cloudflare/$STAGE.json"
   git commit -m "Update admins and users"
   npm run deploy -- --target cloudflare --stage "$STAGE"
   ```

## 7. Cost

- Stopped or idle stages cost nothing for compute, but storage remains: the stage's D1 database and R2 file bucket, the shared `prototype-logs` bucket, and the `sst-state` bucket. Log entries are never deleted automatically.
- On Cloudflare's free plan, D1 allows about **100,000 rows written per day** per account. The limit for reads is larger. When a limit is used up, database requests fail until it resets at 00:00 UTC.
- Keep test stages small: a few rows of data, one test stage at a time, and `remove` it right after use. An account holds at most **10 D1 databases**, and a deploy that changes the schema briefly uses two per stage.
- AWS idle costs (paused database, shared VPC): [deploying.md](deploying.md) §7.
- See [deploying.md](deploying.md) for deploy, stop/start and remove.

## Examples

- [examples/configuration.md](../examples/configuration.md): the template's committed values files (`config/<target>/<stage>.json`), the files that also hold `framework.admins` and `framework.users`.

## Stopping condition

Stop reading when the owner has done the task they needed. Deploying and removing stages are in [deploying.md](deploying.md); reading logs is in [troubleshooting.md](troubleshooting.md).
