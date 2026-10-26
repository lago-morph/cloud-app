# Plan: v0.2.0, sign-in with Cloudflare (auth revamp)

Status: draft for owner review (2026-10-26).
- **Assumes v0.1.1:** the setup-wizard plan (`plan-setup-wizard.md`) is implemented and merged.
- **Breaking:** apps on 0.1.x lose their password accounts. See §8.
- **Already established:** the live tests and research in §2 are done. Don't repeat them. Only the items marked *unverified* need checking.

## 1. Goal and owner decisions (2026-10-26)

Replace Better Auth, email and password, with **sign-in through Cloudflare**. The aims:
- the Workers **Free** plan suffices;
- no email domain and no Email Service are needed;
- no password, mail or rate-limit machinery;
- setup steps that handle tokens move out of the agent's sight, into a web app.

| # | Decision |
|---|---|
| D1 | Sign-in uses a **private** Cloudflare OAuth client, so only members of the owner's Cloudflare account can sign in. |
| D2 | Roles come from the account. A member whose account role is an administrator role is the app's **admin**. Any other signed-in member is a **user**. Anyone not signed in is **anonymous**. (Role mapping: §4.4.) |
| D3 | **Two Workers**, both account-level, both created by setup: the **auth app** (signs people in for every prototype app) and the **admin app** (setup, tokens, later provider configuration). |
| D4 | **Two OAuth clients.** The *sign-in client* holds only the minimal scopes and is used by the auth app. The *admin client* holds the powerful scopes, mostly optional, and is used only by the admin app. |
| D5 | **One auth app for all prototype apps.** Apps redirect to it. It signs the user in, records their rights in its own database, and redirects back with a **one-time code**. The app redeems the code through a **service binding** and sets its own `__Host-session` cookie. **No OIDC between apps and the auth app**: they share one trust boundary. |
| D6 | **No OpenAuth, and no home-made OIDC provider.** OpenAuth was evaluated and rejected (§2.4). |
| D7 | Secrets used by more than one app (the OAuth client secrets, and the R2 signing credential if moved) live in **Cloudflare Secrets Store**. Per-app secrets stay Worker secrets. |
| D8 | **Requesting rights through the OAuth grant is allowed in the admin app** for setup and administration, mostly as optional scopes requested on the page that needs them. Ordinary app sign-in never requests rights beyond identity and membership. |
| D9 | **The bootstrap token:** the user creates it in the dashboard, with only the rights needed to deploy the admin app (§5.1). Setup checks that it expires **within 1 day**. If it doesn't, setup **deletes it at once** and tells the user to make a new one. It is used once, **never stored** in any file, environment setting or log, and deleted when setup ends. An interrupted run leaves at most a 1-day window. |
| D10 | **Everything after the bootstrap** is done in the admin app, by the signed-in admin authorizing their own role's rights through OAuth grants. That includes the sign-in client, the auth app, the account resources and the everyday token. |
| D11 | **Later, not v0.2.0:** other OIDC providers configured in the admin app, with a test button; assigning users to roles; groups that hold users and other groups and grant roles. |

## 2. Already verified. Don't redo.

### 2.1 Cloudflare OAuth: live test, 2026-10-26
Method: a private client `pf-oauth-test` and a test Worker on the owner's account. The owner signed in three times: all optional scopes granted; all unticked; all unticked again with per-call counts. 55 API calls in all. Everything was deleted afterwards.

**Discovery** (`https://dash.cloudflare.com/.well-known/openid-configuration`):
- **Endpoints:**
  - authorize `https://dash.cloudflare.com/oauth2/auth`
  - token `/oauth2/token`
  - userinfo `/oauth2/userinfo`
  - revoke `/oauth2/revoke`
  - JWKS `/.well-known/jwks.json`
  - end session `/oauth2/sessions/logout`
  - device `/oauth2/device/auth`
- **Advertised:** `claims_supported` lists only `sub`. `scopes_supported` lists `openid`, `offline`, `offline_access`.
- **Methods:** PKCE `plain` and `S256`. Token auth `client_secret_post`, `client_secret_basic`, `private_key_jwt`, `none`. The ID token is signed with RS256.

**Scope IDs** (`GET /client/v4/oauth/scopes` lists 401 of them):
- `user-details.read`, `memberships.read`;
- `account-api-tokens.write` (there is no read variant);
- `workers-scripts.read`, `account-settings.read`.

There are no email or profile scopes. `openid` and `offline_access` are added by the API itself.

**Creating clients** (`POST /accounts/{id}/oauth_clients`):
- `openid` is kept only when `response_types` includes `id_token`. With `["code"]` alone, the API silently drops it.
- The `refresh_token` grant adds `offline_access`.
- **The client secret appears only in the create response**; a list or update never returns it.
- Redirect URIs accepted, each with a 200 at creation: `http://localhost:8787/callback`, `https://*.workers.dev/callback` (stored verbatim), and a concrete `workers.dev` callback.
- *Unverified:* whether a wildcard redirect actually matches at authorize. With one auth app (D5) it isn't needed.

**Tokens:**
- The access token is **opaque**, not a JWT, and lasts `expires_in: 3600`.
- The ID token is RS256 and checks out against the JWKS: `iss`, `aud`, `nonce` and `exp` are all valid, and it lasts 3600 s.
- A refresh token is returned.
- **ID-token claims:** `at_hash, aud, auth_time, email, email_verified, exp, iat, iss, jti, nonce, rat, sid, sub`. `email` and `email_verified` (true) **are present** even though discovery lists only `sub`.
- **Userinfo** returns `aud, auth_time, email, email_verified, iat, iss, rat, sub`.

**Identity and role:**
- `GET /client/v4/user` (needs `user-details.read`) returns 18 fields, including `id`, `email`, `first_name`, `last_name` and `organizations`.
- `GET /client/v4/memberships` (needs `memberships.read`) returns, for the owner's account, roles `["Super Administrator - All Privileges"]` and status `accepted`. Other fields: `account, api_access_enabled, id, permissions, policies, roles, status`.

**Optional scopes are enforced** (the third sign-in, all three optional scopes unticked; granted `openid user-details.read memberships.read offline_access`):

| Call | Result |
|---|---|
| `GET /accounts/{A}` | 403, code 9109 |
| `GET /accounts/{A}/tokens` | 403, code 9109 |
| `GET /accounts/{A}/d1/database` (never requested) | 401, code 10000 |
| `GET /accounts/{A}/r2/buckets` (never requested) | 403, code 10000 |
| `GET /accounts/{A}/workers/scripts` | 200 with an **empty** list (a Worker existed at the time), so it's filtered, not granted |
| `/memberships`, `/user` | 200 |

**The OAuth grant can create API tokens:**
- With `account-api-tokens.write` granted, `POST /accounts/{A}/tokens` using the user's access token created a child token (200), and the same token deleted it (200).
- Without that scope: 403, code 9109.

**Revoke:** the access and refresh tokens both return 200. Afterwards the access token gets 403 on `/user`.

**Consent screen** (the owner's screenshot): it shows the client name and "This application has not verified ownership of any domain" (expected for a private client); required scopes as fixed rows (Profile Information, User Details Read, Memberships Read, Background Access); and optional scopes grouped by category with toggles, plus "Read only" and "Full access" shortcuts.

### 2.2 Cloudflare OAuth: docs (developers.cloudflare.com/fundamentals/oauth/)
- **Private clients:** "can only be authorized by members of the parent Cloudflare account", need no domain verification, and are the default. Making a client public is permanent and needs a verified domain.
- **Plans:** all plans, Free included. It's GA, not beta, and optional scopes are GA (changelog 2026-08-20).
- **Managing clients:** by API with "OAuth Clients Write"; up to two secrets at once, and `rotate_secret` exists.
- **Grants:** authorization code (with PKCE when `token_endpoint_auth_method` is `none`) and refresh token only.
- **Consent:** users choose which accounts to authorize at consent (changelog 2026-04-14).

### 2.3 Tokens, deep links and setup facts (from the v0.1.1 work, 2026-10-26)
- **No token-creating tokens by API:** the API refuses to create any token holding "Account API Tokens Write" (400, code 1001, "sub-token is not allowed to have permissions to manage other tokens"). Only the dashboard can make one.
- **Self-deletion:** a token holding "Account API Tokens Write" can delete itself (DELETE 200, then 401 on use). A token without it can't (403, 9109). So the bootstrap token needs that permission (§5.1).
- **Updating keeps the value:** `PUT /accounts/{id}/tokens/{id}` changes a token's permissions and keeps its value.
- **Deep links:** `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=<URL-encoded JSON>&name=<name>`, with permission groups given by 32-hex ID.
  - Verified by the owner: they arrive pre-ticked.
  - Scope is always the **entire account** (all zones).
  - Expiry is chosen on the page (default: none).
- **Plan detection:** `GET /accounts/{id}/subscriptions` with "Billing Read". It shows "Workers Paid" on the owner's account.
- **Secrets Store:**
  - open beta, on all plans, 100 secrets per account;
  - Workers bind it with `secrets_store_secrets` and read with `await env.X.get()`;
  - production secrets can't be read in local development;
  - creating secrets needs the Super Administrator or Secrets Store Admin role, and binding them needs Secrets Store Deployer.
  - *Unverified:* the API permission-group names, and support in SST and Pulumi bindings.
- **Skill in cloud sessions:** a cloud-environment setup script that copies the skill into `~/.claude/skills/` works. Verified by the owner; the repository had no committed copy. The skill is published as `@lago-morph/prototype-framework-skill@0.1.0`.

### 2.4 OpenAuth: evaluated and rejected (2026-10-26, source at HEAD 98dc596)
- **Maintenance has stalled:** the last release was 0.4.3 (2025-03-04), the last commit 2025-04-09, and it's still labelled beta.
- **OAuth only:** no ID token, no openid discovery, and user details sit nested in `properties`.
- **Unsafe redirect check:** its default `allow()` accepts any redirect host whose last two labels match the issuer's, so **any `*.workers.dev` host** passes.
- **Too permissive by default:** PKCE is optional and `plain` is allowed. Access tokens last 30 days and refresh tokens a year.
- **Gaps:** no D1 adapter, and it generates its own signing keys rather than taking them from Secrets Store.
- **Superseded:** OIDC isn't needed at all under D5.

## 3. Architecture

```
browser ──► app Worker ──(redirect)──► auth app ──(OAuth)──► dash.cloudflare.com
   ▲            │  ▲                       │  /memberships, /user (user's token, then discarded)
   │            │  └──(service binding: redeem(code), role(sub))──┘
   └─ __Host-session cookie (per app)          D1: users, codes, sessions;  Secrets Store: client secret
admin app ──(admin OAuth client, optional scopes per page)──► Cloudflare API, acting as the signed-in admin
```

- **The auth app** (account-level, like today's mail sink) holds:
  - the sign-in client's ID, with its secret in Secrets Store;
  - D1 tables `users(sub, email, role, updated_at)` and `codes(code_hash, sub, app, expires_at, used)`, plus whatever short state it needs;
  - a registry of approved app return URLs, kept in D1 and written by deploy.
  
  It has no public "who is this user" API. Apps use the service binding only.
- **App Workers** keep the framework's existing session cookie and the `/api/auth/*` routes. Today's redirect `LoginProvider` path (`runtime.ts`, `transaction.ts`) becomes the *auth-app provider*. Apps hold no Cloudflare credential at all.
- **The admin app** (account-level): admin-only pages, each requesting just the optional scopes it needs, through the admin client. Its own session is short.

## 4. Sign-in flow (D5)

### 4.1 Steps
1. The app's `/api/auth/login` creates state, keeps the transaction in the existing `__Host-login` cookie, and redirects to `<auth app>/start?app=<app id>&return=<app callback>&state=<s>`.
2. The auth app checks `return` exactly against the registry (no prefix or wildcard matching), then runs the Cloudflare authorization-code flow with PKCE S256. Required scopes: `user-details.read`, `memberships.read`, plus `openid`. The client is created with `response_types ["code","id_token"]`, because the API drops `openid` otherwise (§2.1).
3. In its callback the auth app:
   1. exchanges the code;
   2. checks the ID token against the JWKS (`iss`, `aud`, `nonce`, `exp`);
   3. takes `sub`, `email` and `email_verified` from the ID token;
   4. calls `/memberships` and picks the membership whose account is this account and whose status is `accepted`;
   5. maps its roles to admin or user (§4.4) and **upserts `users`**;
   6. **revokes** the access and refresh tokens, keeping no Cloudflare tokens;
   7. creates a one-time code (random, stored hashed, 60 s lifetime, single use, bound to the app ID and return URL);
   8. redirects to `return?code=…&state=…`.
4. The app's callback checks the state, then calls `env.AUTH.redeem({ code, app })` over the service binding. It receives `{ sub, email, role }` and issues `__Host-session`. The session format gains a provider `cf-account`. The user ID is derived from `sub`.
5. **Role freshness:** apps can call `env.AUTH.role(sub)` over the binding, on session renewal or every N minutes (a PAR). The auth app's record is refreshed at each sign-in. A removed member keeps any existing session only until it next renews.

### 4.2 Sign-out
The app clears its cookie. Cloudflare's session logout (`end_session`) is optional and linked from the auth app.

### 4.3 Local and test stages
- **Locally:** mock login only, as today. No auth app is needed.
- **`test-` stages:** mock login, as today.
- **Integration tests:** a fake auth app behind the same service-binding interface. For the upstream OAuth part, run navikt/mock-oauth2-server in CI and locally (Java is available in the sandbox; Docker in GitHub Actions).
- **Live:** the owner signs in once for real per release (§7).

### 4.4 Role mapping (a PAR, so it can change)
- **Admin:** the membership's role names include "Super Administrator - All Privileges" (verified string) or "Administrator".
- **User:** any other `accepted` membership.
- **No membership in this account:** refused. That can't happen with a private client, but the check stays.

The exact role-name strings for roles other than Super Administrator are *unverified*. The implementer should read them from `/memberships` for a non-admin test member, or from the role-listing API, and record them.

## 5. Setup flow, replacing parts of v0.1.1's wizard

### 5.1 Bootstrap (CLI `cloudflare-setup`, cloud or command line)
**Permission set:** Workers Scripts Edit (deploying the admin app, and registering the workers.dev subdomain if needed; *unverified* whether that permission covers the subdomain), OAuth Clients Edit, Secrets Store Edit (*name unverified*), Account API Tokens Edit (needed only to delete itself, §2.3). The deep link is generated as in v0.1.1, with group IDs looked up from `/tokens/permission_groups`.

**Steps:**
1. Read `CLOUDFLARE_BOOTSTRAP_TOKEN` from the environment or `.env.cloudflare`. Verify it and read its `expires_on`. If it has no expiry, or one more than 1 day away, **DELETE it at once** and tell the user to make a new one with a 1-day expiry, giving the link.
2. Create the **admin client** (private, confidential; required scopes `user-details.read`, `memberships.read`; optional scopes as §5.2 needs). Put its secret straight into Secrets Store, since it's shown only once (§2.1).
3. Deploy the admin app and bind it.
4. **Delete the bootstrap token.**
   - Comment out its line in `.env.cloudflare` (as in v0.1.1).
   - In a cloud session, tell the user they can delete the environment variable; it's already invalid.
   - Never write the value anywhere.
5. Print the admin app's URL and the next step: "open the admin app and sign in".

### 5.2 Admin app pages. Each requests only its own optional scopes through the admin client.
1. **Account setup:**
   - create the sign-in client and store its secret in Secrets Store;
   - deploy the auth app with its D1 database;
   - create the shared resources from v0.1.1, without anything email-related: log bucket, state bucket, backups, the signing credential (moved to Secrets Store);
   - write the setup record (v0.1.1 §4.4), bumping `ACCOUNT_SETUP_VERSION`.
2. **Everyday token:** create it through the user's grant (`account-api-tokens.write`, verified §2.1), with the minimal everyday permission set (v0.1.1 §4.1 minus email). **Show the value once to the human,** with a copy button and the env-file or environment-settings instructions. **The agent never sees it.** It can also add permissions to the existing everyday token in place (§2.3).
3. **Status:** what's set up, which version, the registered apps, and recent sign-ins. Read-only.
4. *(Later, D11)* other providers, role assignment, groups.

### 5.3 What changes from v0.1.1
- **Removed:**
  - email domain choice and Email Service setup;
  - test mailbox and mail sink;
  - the everyday-token deep link (replaced by admin-app page 2);
  - the Workers Paid requirement;
  - the email permissions in both token sets.
- **Unchanged:**
  - `.env.cloudflare` and its precedence;
  - the git-ignore warnings;
  - local-setup-first;
  - version check and `npm run upgrade`;
  - the skill package;
  - the trigger phrase "continue prototype setup".
- **The skill's setup flow:**
  1. run `cloudflare-setup` with the bootstrap token;
  2. open the admin app and do account setup and the everyday token;
  3. save the everyday token (the user, not the agent);
  4. "continue prototype setup" checks that it works.

## 6. Removals
- **Code:**
  - `packages/framework/src/auth/password/*` (Better Auth bridge, pages, routes, tables, options);
  - `src/mail/*` and `cli/commands/mail.ts`;
  - the mail-sink Worker and its provisioning;
  - `provision/cloudflare/{email.ts, email-permissions.ts, mail-sink.ts}`;
  - the sign-in rate-limit tables;
  - `check-login`'s mail and password steps, replaced by an auth-app check (§7);
  - the `admins` command, since roles now come from Cloudflare.
- **Dependencies:** `better-auth`.
- **Migrations:** framework migrations that drop the Better Auth tables on upgrade (§8).
- **Spec:**
  - `password.md` and `mail.md` retired;
  - `auth.md` rewritten for the auth-app provider;
  - PWD-* and MAIL-* criteria retired, and AUTH-* and E2E-005…008 rewritten;
  - PAR-241…259 superseded, and DEC-0509…0527 superseded where they concern passwords or mail.
- **Size, roughly** (codebase survey, 2026-10-26): about 4,000 source lines and 3,500 test lines go, plus about 1,000 lines of integration tests.

## 7. Testing
- **Unit, against a fake Cloudflare API and a fake auth-app binding:**
  - the code lifecycle: single use, 60 s, bound to app and return URL;
  - an exact-match registry, with an open-redirect attempt refused;
  - state and PKCE;
  - ID-token checks: wrong `aud`, wrong `nonce`, expired;
  - role mapping;
  - the tokens being revoked in the callback;
  - the bootstrap rules: an expiry over 1 day or none means delete at once; delete at the end; nothing written anywhere;
  - the admin pages requesting only their own scopes.
- **Integration (CI and local):** mock-oauth2-server stands in for Cloudflare. The full redirect → code → redeem → session path runs over plain HTTP, without a browser.
- **Live, once per release:**
  1. bootstrap with a 1-day token, showing the admin app is deployed and the token deleted;
  2. the owner signs in to the admin app and runs account setup and the everyday token, with an unticked-scope check;
  3. the owner signs in to `prodcheck` through the auth app, showing admin as owner;
  4. a non-admin member signs in, if the owner can invite one, showing user.
  
  Mock login covers the automated cloud passes.

## 8. Migration from 0.1.x
- **Release:** v0.2.0, a minor version, which is breaking before 1.0 (CHANGELOG policy). Password accounts and sessions are dropped, and the CHANGELOG says so plainly.
- **`npm run upgrade`** to 0.2.0 points to re-running setup: bootstrap, then the admin app.
- **The admin app offers cleanup** of the v0.1.x email resources (routing rules, mail sink, sending domain). It's optional, and never automatic.

## 9. Work breakdown (parallel waves; DEC and PAR numbers start after the last on main when work begins)
- **Wave 1, in parallel:**
  - (a) the auth app: OAuth flow, D1, codes, registry, service-binding interface (§3, §4);
  - (b) the framework's auth-app provider and session changes, with removal of Better Auth and MAIL (§4.1 step 4, §6);
  - (c) the bootstrap command changes (§5.1);
  - (d) spec and docs changes (§6, `auth.md`).
- **Wave 2, in parallel:**
  - (e) the admin app pages (§5.2);
  - (f) Secrets Store adoption, including the signing credential, deploy bindings, and the fallback to Worker secrets;
  - (g) the skill, quickstart and migration notes (§5.3, §8).
- **Then:**
  - a test author for the criteria (§7);
  - an independent review;
  - red-green fixes;
  - the live pass, which needs the owner's bootstrap token and sign-ins, so do it last and batch them.

## 10. Risks
- **Single point of failure:** if the auth app is down, nobody can sign in. Existing sessions keep working until they expire.
- **Testers must be account members.** The owner invites them with the least dashboard role that works. Which role that is remains *unverified*.
- **Secrets Store is a beta.** Keep a fallback to Worker secrets.
- **Role names are free text** from the API. Keep the mapping as a PAR, and record the verified strings.
- **Cloudflare could change the claims.** If the ID token stops carrying `email` (discovery lists only `sub`), fall back to `/user`, which needs `user-details.read`; that is already required.
