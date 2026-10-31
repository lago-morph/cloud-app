# Plan: v0.2.0, sign-in with Cloudflare (auth revamp) and testing standards

Status: draft for owner review (2026-10-26). The testing standards (owner decisions of 2026-10-31, from the reviewed addendum `plan-v0.2.0-testing.md`) were merged in on 2026-10-31: decisions in §1, standards in §7a, the e2e scope in §7.1, requirement changes in §6.1, where the standards land in §6.2, and their work in §9.
- **Assumes v0.1.1:** the setup-wizard plan (`plan-setup-wizard.md`) is implemented and merged. "v0.1.1 §n" cites that plan.
- **Breaking:** apps on 0.1.x lose their password accounts. See §8.
- **Already established:** the live tests and research in §2 are done. Don't repeat them. Only the items marked *unverified* need checking.
- **Testing standards first apply here:** v0.2.0 is the first work under the standards of §7a, and it brings the existing tests up to them. Applying them before v0.2.0 would write many tests for code that v0.2.0 removes (about 3,200 unit-test lines go, §6).
- **Citations:** "prompt §n" is the governing prompt `ai/prompts/implement-local-cloudflare.md`; "`plan.md` §n" is the first implementation's plan.
- **Sources of the testing standards:**
  - the governing prompt;
  - `ai/implementation/plan.md` §1 and §10;
  - `docs/CONVENTIONS.md` and `docs/components/compliance.md`;
  - `docs/spec/system-spec.md`;
  - `skill/reference/testing.md`;
  - the CI workflows;
  - the root-cause records and evaluations;
  - the owner's instructions of 2026-10-31.

  No retrospective content was used (TS-17).
- **Reviews of the testing standards:**
  - Two independent subagents reviewed the first draft on 2026-10-31: one checked it against the owner's instructions, the other checked the e2e parts against the repository. Their changes are applied.
  - The owner's first review comments (2026-10-31) are applied.

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

### Testing standards (2026-10-31)

**Scope.**
1. **Who these standards apply to:** the framework repository and every app built with the framework, at the same level (TS-14).
   - §7a.1 applies to both.
   - §7a.2 applies only to the framework repository.
   - §7a.3 says how apps get §7a.1 and what they leave out.

   App builders may not know what TDD, Playwright or fuzzing are. The product skill and the template give their agents these practices automatically.
2. **Tests evolve with the system.** When the intent of the framework or of an app changes, its tests change to match, in the same work: unit, integration and e2e tests, and, in the framework, the E2E scenarios.
   - **E2E tests MUST be updated whenever the system they cover changes.** They are not a fixed, once-approved list.
   - A feature is not done until its happy path, its expected error scenarios and its edge cases are covered end to end (§7a.1.5).
3. **Existing practice stays.** The framework repository's roles, diagnosis workflow, test layers, tagging, evidence and test economy from the first implementation stay. These standards add to them and change them only where the decisions below say so.

**Decisions.**

| # | Decision |
|---|---|
| TS-1 | **Every session's main agent orchestrates.** It keeps its context small and reduces wall-clock time by making aggressive use of subagents, running them in parallel where they don't touch the same files (prompt §1, kept and made permanent). In an app, this holds unless the app's user overrides it. |
| TS-2 | **Unit tests use red/green/refactor TDD** (prompt §6, kept). |
| TS-3 | **Any failure outside red/green gets an evidence-based root cause, never a guess.** That covers unit regressions, every integration and e2e failure, and builds and deploys. A **diagnoser subagent**, never the code's author, finds it (prompt §8, kept). Evidence includes logs, a debugger, and several variations of the test. |
| TS-4 | **An independent reviewer subagent** first decides whether the evidence supports the root cause. Only then does it evaluate the fix. Major issues must be answered. At most **3 attempts** per failure. A failure that needed a second attempt, or a second review round, gets an analysis of why, and the skill is made more specific if that analysis shows a gap (§7a.1.8). |
| TS-5 | **Similar cases before the fix.** After approval and before the fix, search for similar cases and add tests for them too. |
| TS-6 | **Integration tests use the existing layer definition and strategy:** real local dependencies (Miniflare/workerd, PGlite, the file system, local stand-ins such as mock-oauth2-server); fakes only for external platforms with no local stand-in. No new mocking rule. Every framework component has a comprehensive integration suite. |
| TS-7 | **E2E covers every happy path and every expected error scenario,** with creatively chosen edge cases. It is API-first: e2e tests drive the API, and a limited number of Playwright UI tests cover what only a browser shows. |
| TS-8 | **Fuzzing is local, limited and targeted.** It is never run against a cloud stage. Use it a little where it makes sense: chosen APIs and well-defined client/server interfaces, especially code with repeated regressions. Never brute-force every API. |
| TS-9 | **Every change carries its test impact,** and its implementer makes the needed test changes in the same work, without being asked. |
| TS-10 | **Changes to once-green tests are reviewed by an independent subagent,** in every layer. That covers any change to a once-green test's expected results, its removal, or its weakening. "Green once" means it passed in this session, or it is on the main branch. Review may be in bulk, grouped by reason. The aim: agents fix real defects instead of deleting or changing tests (§7a.1.9). |
| TS-11 | **Framework CI runs tests intelligently, on PRs only.** Component integration tests run when that component changes. E2E runs on PRs that change application behaviour, never when only unit or integration tests, docs or specs change. Every test, e2e included, runs at release. No test runs twice in one run without a recorded reason. Chromium is installed only when a UI test is selected (§7a.2.4). |
| TS-12 | **Linters run in two places:** a Claude Code hook that runs when Claude commits, in the framework repository only, and CI, which runs the linters appropriate to the PR's changes. There is no git pre-commit hook. The root-cause record linter is not added to CI (§7a.2.5). |
| TS-13 | **Any change to a skill that can affect testing is reviewed by a subagent first,** for test quality not being weakened and for strict progressive disclosure (§7a.2.6). |
| TS-14 | **Apps built with the framework get the same level of testing as the framework,** except what relies on Claude Code harness hooks, which exist only in the framework repository (TS-18). The rule "app tests use the API only and add no browser driver" (`skill/reference/testing.md`, "What runs your tests", last bullet) is removed. Installing or updating the framework's npm packages never changes an app's CI. The product skill may suggest CI changes to the app's user (§7a.3). |
| TS-15 | **E2E tests are kept current without owner approval.** In the framework, agents keep the E2E scenarios current, and every addition, change and retirement is reviewed and validated by an independent subagent (§7a.2.3). The e2e scope changes for v0.2.0 (§7.1) go in their own PR. In an app, the app's agent keeps the app's e2e tests current, unless the app's user directs otherwise (§7a.3). |
| TS-16 | **CI economy is the orchestrator's call.** The owner leaves the docs-only CI question to the implementation: choose the method that safely reduces wall-clock time without compromising test quality. §7a.2.4 records the choice. |
| TS-17 | **Retrospectives stay out of agent context.** Agent sessions do not read anything under `retrospective/`, so none of it enters their context. The exception is the self-retrospective skill, which normally runs at the end of a session and may read earlier retrospectives. A retrospective recommendation the owner has not adopted is never used in any decision. This becomes a hard rule in `CLAUDE.md` (§6.2). |
| TS-18 | **Claude Code harness hooks apply only to the framework repository,** never to repositories where users have installed the npm packages. |
| TS-19 | **Framework CI runs the integration and e2e layers when §7a.2.4's selection calls for them.** Today it never runs them, although `compliance.md` §2 "Tiers" says automated criteria and scenarios run for every commit. This does not mean running them on every PR: a PR that changes only docs or specs runs neither. |
| TS-20 | **Review loops answer comments.** Before, a rejected record went back to diagnosis with no limit and no step for answering comments (prompt §8 step 2). TS-4 fills the gap. |
| TS-21 | **Background pointers name specific files, never directories.** The standards live in the testing skills, which load through their descriptions and use progressive disclosure. `CLAUDE.md` names the testing-standards skill. `docs/CONVENTIONS.md` keeps only a short pointer to it, plus the scenario-origin rule (§7a.2.3). |

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

### 2.1a Cloudflare OAuth: second live test, 2026-10-27 (a minimal member, and admin setup actions)
Method: a private client `pf-oauth-test2` offering the optional scopes `secrets-store.write`, `secrets-store.read`, `workers-scripts.write`, `d1.write`, `workers-r2.write` and `account-api-tokens.write`. Two sign-ins, both approving every optional scope:
- **A:** the owner, whose role is "Super Administrator - All Privileges";
- **B:** an invited member whose only role is "HTTP Applications Read", the most restrictive role available.

60 API calls in all, and everything was deleted afterwards. Both runs got the same granted scope string, the same ID-token claims (with `email` and `email_verified` true), and the same 18 `/user` fields. Revoking worked in both.

**A minimal member can authorize a private client.** There was no error and the token exchange returned 200. Their `/memberships` for this account shows:
- roles `["HTTP Applications Read"]`, status `accepted`;
- `api_access_enabled` null (it's null for the admin too);
- a `permissions` object with only 4 keys (`http_applications`, `organization`, `waf`, `zone`), each `{read: true, edit: false}`. The admin's object has about 60 keys.

**A sign-in token is capped by the user's own role.** Granted scopes are necessary, but they never add rights beyond the role.

| Action, with the user's token | A (Super Admin) | B (HTTP Applications Read) |
|---|---|---|
| Create OAuth client | 403, code 10000 | 403, code 10000 |
| List Secrets Store stores | 200 (1 store) | 403, code 10000 |
| Create Secrets Store secret | 200; deleted (202) | not reached |
| Create D1 database | 200; deleted (200) | 401, code 10000 |
| Create R2 bucket | 200; deleted (200) | 403, code 10000 |
| Upload Worker script | 200; deleted (200) | 403 "No access to the specified resource." |
| Create API token | 400, code 1001 (see below) | 403, code 9109 |
| GET workers/scripts | 200, 4 scripts | 200, **0** scripts (filtered, not refused) |
| GET d1/database, GET r2/buckets | 200 | 401 / 403, code 10000 |

**What follows for the design:**
- **No OAuth Clients scope exists** (the OAuth scope list has none), and creating a client with a sign-in token is refused. So **the bootstrap token creates BOTH OAuth clients**, the admin client and the sign-in client (§5.1).
- **A token created through a sign-in can only hold the permission groups that the session's granted scopes cover.** Asking for "Account Settings Read" without `account-settings.read` granted was refused with 400, code 1001: "The OAuth session does not include the scopes required for the requested permission groups". (With the scope granted, the same create worked: §2.1.) So **the admin client must request a scope for every permission group in the everyday token.**
- **Role mapping by role name works for both kinds of member.** The minimal member is a "user".

### 2.1b Bootstrap permissions and tooling: API checks, 2026-10-27 (11 API calls, read-only plus temporary tokens)
- **Permission groups** (account-scoped; they are named "Write", not "Edit"):
  - Secrets Store Read `5e33b7d77788455c9fdf18cbd38ee5a0` and Secrets Store Write `adc8fa2bc6124928a8b3314dc63a1235`. These are the only two; **there is no "deploy" group**.
  - OAuth Client Read `0b7793327a1a417681e4d49ee233e184` and OAuth Client Write `50fc2f43318f40e4855a35d8de5bf643` (singular "Client").
  - Workers Scripts Write `e086da7e2179491d91ee5f35b3ca210a`.
  - Account API Tokens Write `5bc3f8b21c554832afc660159ab75fa4`.
- **The workers.dev subdomain:** `GET` and `PUT /accounts/{A}/workers/subdomain` need only Workers Scripts Write, per the docs. A token holding only that permission read the subdomain (200). PUT wasn't called.
- **The bootstrap set without Account API Tokens Write** (Workers Scripts Write, OAuth Client Write, Secrets Store Write) can be created by API (200). It could list OAuth clients (200), list Secrets Store stores (200; the account has 1 store) and read the subdomain (200). With Account API Tokens Write added, the API refuses it (400, code 1001), so the bootstrap token must be made in the dashboard, as planned.
- **Tooling:**
  - **wrangler 4.149.0:** supports `secrets_store_secrets` and `services` bindings.
  - **Pulumi Cloudflare 6.15.0:** `WorkersScriptBinding` accepts `secrets_store_secret` (with `storeId` and `secretName`) and `service`.
  - **SST 4.17.2:** the Worker component maps `serviceBindings`, but has **no Secrets Store binding**. Add one through `transform.worker`. This was inferred from SST's code and is *untested*.
  - **Fallback:** the script-upload API accepts `{type:"secrets_store_secret", name, store_id, secret_name}` and `{type:"service", name, service}` directly.

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
  - a registry of approved app return URLs, kept in D1, written by `deploy` and cleared by `remove`.
  
  It has no public "who is this user" API. Apps use the service binding only.
- **App Workers** keep the framework's existing session cookie and the `/api/auth/*` routes (`login`, `callback`, `logout`, `me`, and `mock-login` where the mock is installed). The password pages and endpoints under `/api/auth/` go (§6). Today's redirect `LoginProvider` path (`packages/framework/src/auth/runtime.ts` and `transaction.ts`, interface in `login-provider.ts`), which only the test stub uses in v0.1.1, becomes the *auth-app provider*. Apps hold no Cloudflare credential at all.
- **The admin app** (account-level): admin-only pages, each requesting just the optional scopes it needs, through the admin client. Its own session is short.

## 4. Sign-in flow (D5)

### 4.1 Steps
1. The app's `/api/auth/login` creates state, keeps the transaction in the existing `__Host-login` cookie, and redirects to `<auth app>/start?app=<app id>&return=<app callback>&state=<s>`.
2. The auth app checks `return` exactly against the registry (no prefix or wildcard matching), then runs the Cloudflare authorization-code flow with PKCE S256. Required scopes: `user-details.read`, `memberships.read`, plus `openid`. The client is created with `response_types ["code","id_token"]`, because the API drops `openid` otherwise (§2.1).
3. In its callback the auth app:
   1. exchanges the code;
   2. checks the ID token against the JWKS (`iss`, `aud`, `nonce`, `exp`);
   3. takes `sub`, `email` and `email_verified` from the ID token, falling back to `/user` if `email` is missing (§10);
   4. calls `/memberships` and picks the membership whose account is this account and whose status is `accepted`;
   5. maps its roles to admin or user (§4.4) and **upserts `users`**;
   6. **revokes** the access and refresh tokens, keeping no Cloudflare tokens;
   7. creates a one-time code (random, stored hashed, 60 s lifetime, single use, bound to the app ID and return URL);
   8. redirects to `return?code=…&state=…`.
4. The app's callback checks the state, then calls `env.AUTH.redeem({ code, app })` over the service binding. It receives `{ sub, email, role }` and issues `__Host-session`. The session format's provider field (`prv`, today `stub` or `password`) gains `cf-account`, and `password` goes. The user ID is derived from `sub`.
5. **Role freshness:** apps can call `env.AUTH.role(sub)` over the binding, on session renewal or every N minutes (a PAR). The auth app's record is refreshed at each sign-in. A removed member keeps any existing session only until it next renews.

### 4.2 Sign-out
The app clears its cookie. Cloudflare's session logout (`end_session`) is optional and linked from the auth app.

### 4.3 Local and test stages
- **Locally:** mock login only, as today. No auth app is needed.
- **`test-` stages:** mock login only. (Today they also run the password provider, DEC-0516.)
- **Integration tests:** a fake auth app behind the same service-binding interface. For the upstream OAuth part, run navikt/mock-oauth2-server in CI and locally (Java is available in the sandbox; Docker in GitHub Actions).
- **Live:** the owner signs in once for real per release (§7).

### 4.4 Role mapping (a PAR, so it can change)
- **Admin:** the membership's role names include "Super Administrator - All Privileges" (verified string) or "Administrator".
- **User:** any other `accepted` membership.
- **No membership in this account:** refused. That can't happen with a private client, but the check stays.

Verified strings: "Super Administrator - All Privileges" (admin) and "HTTP Applications Read" (a minimal member, so "user"), §2.1a. The exact string for the plain "Administrator" role is *unverified*. Read it from the role-listing API (`GET /accounts/{A}/roles`) and record it.

## 5. Setup flow, replacing parts of v0.1.1's wizard

### 5.1 Bootstrap (CLI `cloudflare-setup`, cloud or command line)
**Permission set (verified, §2.1b):** Workers Scripts Write (deploying the admin and auth Workers, and registering the workers.dev subdomain if needed), OAuth Client Write, Secrets Store Write, and Account API Tokens Write, which is needed only to delete itself (§2.3) and is why the token must come from the dashboard. The deep link is generated as in v0.1.1, from the group IDs recorded in `provision/cloudflare/permissions.ts` (read once from `/tokens/permission_groups`, not at run time); the IDs of the new groups are in §2.1b.

**Steps:**
1. Read `CLOUDFLARE_BOOTSTRAP_TOKEN` from the environment or `.env.cloudflare`. Verify it and read its `expires_on`. If it has no expiry, or one more than 1 day away, **DELETE it at once** and tell the user to make a new one with a 1-day expiry, giving the link.
2. Create **both OAuth clients**, because no sign-in scope can create clients (§2.1a). Put each secret straight into Secrets Store, since it's shown only once (§2.1):
   - **the admin client:** private and confidential; required scopes `user-details.read` and `memberships.read`; optional scopes covering everything §5.2 needs, including one scope for every permission group in the everyday token (§2.1a);
   - **the sign-in client:** private and confidential; required scopes `user-details.read` and `memberships.read` only.
3. Deploy the admin app and bind it.
4. **Delete the bootstrap token.**
   - Comment out its line in `.env.cloudflare` (as in v0.1.1).
   - In a cloud session, tell the user they can delete the environment variable; it's already invalid.
   - Never write the value anywhere.
5. Print the admin app's URL and the next step: "open the admin app and sign in".

### 5.2 Admin app pages. Each requests only its own optional scopes through the admin client.
1. **Account setup:**
   - deploy the auth app with its D1 database, bound to the sign-in client's secret, which the bootstrap already stored;
   - create the shared resources from v0.1.1, without anything email-related: log bucket, state bucket, backups, the signing credential (moved to Secrets Store, D7; today it is the account API token `prototype-r2-signing`, whose S3 credentials sit in `sst-state` at `framework/r2-signing.json` and are copied into each stage's Worker secrets by `deploy`);
   - write the setup record (v0.1.1 §4.4), bumping `ACCOUNT_SETUP_VERSION`.
2. **Everyday token:** create it through the user's grant (`account-api-tokens.write`, verified §2.1), with the minimal everyday permission set (v0.1.1 §4.1 minus email). **Show the value once to the human,** with a copy button and the env-file or environment-settings instructions. **The agent never sees it.** It can also add permissions to the existing everyday token in place (§2.3).
3. **Status:** what's set up, which version, the registered apps, and recent sign-ins. Read-only.
4. *(Later, D11)* other providers, role assignment, groups.

### 5.3 What changes from v0.1.1
- **Removed:**
  - email domain choice and Email Service setup;
  - test mailbox and mail sink (`prototype-mailsink`);
  - the everyday-token deep link (replaced by admin-app page 2);
  - the Workers Paid requirement (v0.1.1's `cloudflare-setup` stops on Free, because Better Auth needs Paid);
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

## 6. Removals and spec changes
- **Code:**
  - `packages/framework/src/auth/password/*` (Better Auth bridge, pages, routes, tables, options);
  - `packages/framework/src/mail/*` and `packages/framework/src/cli/commands/mail.ts`;
  - the mail-sink Worker and its provisioning;
  - `provision/cloudflare/{email.ts, email-permissions.ts, mail-sink.ts, email-delivery.ts}` (the last is used only by `check-login`);
  - the sign-in rate-limit tables;
  - the `check-login` command's steps (`packages/framework/src/cli/commands/check-login.ts`): all 8 are password, mail or `admins` steps. An auth-app check replaces them (§7, E2E-008 in §7.1);
  - the `admins` command, since roles now come from Cloudflare;
  - the template's `mail` and `admins` npm scripts.
- **Dependencies:** `better-auth`.
- **Migrations:** framework migrations that drop the Better Auth and test-mail tables on upgrade (§8).
- **Spec:**
  - `password.md` and `mail.md` retired;
  - `auth.md` rewritten for the auth-app provider;
  - PWD-* and MAIL-* criteria retired, and AUTH-*, SKILL-AC-006 (its owner steps sign up through the mail sink and use `admins`) and E2E-005…008 rewritten (§7.1);
  - the password and mail parameters PAR-241…244 and PAR-254…259, and the `better-auth` pin PAR-122, superseded. PAR-245 (Worker bundle size), PAR-250…253 (session and login timing, signing key length) and PAR-330 (the `undici` pin, for `check-login`) are kept or revised as §4 needs;
  - DEC-0509…0527 superseded where they concern passwords, mail or the `admins` role (DEC-0521…0526), and DEC-0512 (the automated real-provider check) by §6.1 item 3;
  - the system-requirement changes of §6.1;
  - the testing standards, landing as §6.2 lists.
- **Size, roughly** (recounted with `wc -l` on 2026-10-31): about 3,700 source lines and 3,200 unit-test lines go, plus about 800 lines of integration and compliance tests that cover only password and mail. About 500 more cover the `admins` role and are rewritten or removed.

### 6.1 Requirement changes
v0.2.0 replaces password login with sign-in through Cloudflare. Three of the owner's system requirements still describe password login, and must change with it. The e2e rewrites in §7.1 depend on these changes. The proposed wording below is for the owner's approval. Each change is an owner amendment with its own decision-log entry, in the same style as the existing release-1 amendments.

1. **Who is an admin (SYS-REQ-018, "Admins").**
   - **Today (as amended by DEC-0521…0524):** admin is a role stored with the person's account in the stage's own database, and granted, revoked and listed by an operator command (`admins`). Anyone whose email address is verified is a user. A role change takes effect on the person's next request. Configuration holds no admin or users list.
   - **Proposed:** only members of the owner's Cloudflare account can sign in. A member whose account role is an administrator role is an admin. Any other member is a user. Anyone not signed in is anonymous. The role names that count as administrator are a parameter (§4.4). A role change in the Cloudflare account takes effect at the app's next role refresh or session renewal, not necessarily on the next request (§4.1 step 5). The refresh interval is a parameter.
2. **Which login (SYS-REQ-019, "Login provider").**
   - **Today:** in release 1 the real login is email and password, run by the framework in the app's own deployment, with each email address verified before its first login.
   - **Proposed:** the real login is sign-in with Cloudflare, through the account's shared auth app. It is limited to members of the owner's Cloudflare account. Unchanged: app code cannot tell which provider is in use, and further providers can be added behind the abstraction without app changes.
3. **How the real login is proven to work (SYS-REQ-027, "Provider certification").**
   - **Today (as amended by DEC-0512):** a fully automated check, with no manual step, runs on a production deployment with real email delivery, on every compliance run on each cloud.
   - **Why it must change:** with Cloudflare sign-in, a person has to sign in on Cloudflare's own login page, so a real sign-in cannot be fully automated.
   - **Proposed:**
     - Once per release, the owner signs in for real (§7, "Live"). That is an occasional check that needs a person: a milestone item.
     - Every compliance run on each cloud automatically checks the parts that need no person: the app sends people to the auth app's sign-in address with its own app ID and its registered return URL.
     - Automated runs on test stages keep using the authentication mock, as today.
4. **What follows from these.**
   - **SYS-REQ-026:** the line saying the framework works only when "the provider check passed for that commit" is updated to match item 3: the automated part passed for that commit, and the latest once-per-release real sign-in record is current.
   - **COMPL-REQ-006 ("Definition of works"):** its list of milestone items gains the real Cloudflare sign-in (the live parts of E2E-007 and E2E-008, §7.1), and loses the mail check (MAIL-AC-007). Its release-report rule, which lists the commits that touched PWD, MAIL or login-provider interface files since the last passing `check-login` record (PWD-AC-009), is restated for the auth-app provider and the latest real sign-in record.
   - **`compliance.md` §2 "Testers"** (testers are AI agents, and with the password provider and the mail sink no step needs the owner, DEC-0512) gains this one exception: the once-per-release real sign-in.

### 6.2 Where the testing standards land
- **`CLAUDE.md`:**
  - the orchestrator convention (TS-1);
  - the retrospective hard rule (TS-17);
  - one line naming the testing-standards skill for any change to code or tests (TS-21).
- **`docs/CONVENTIONS.md`:** §4 extended to E2E scenarios, and the agents' change rule (§7a.2.3), plus a short pointer to the testing-standards skill (TS-21).
- **`docs/acceptance/e2e-scenarios.md`, `docs/README.md`:** §7a.2.3 and §7.1.
- **`docs/spec/system-spec.md`, `docs/components/compliance.md`:** the requirement changes of §6.1, after the owner approves their wording.
- **`docs/components/compliance.md`:** "Tiers" per TS-19 and §7a.2.4, the two e2e Playwright projects, and the milestone list changes of §7.1.
- **`.claude/skills/testing-standards/`** (new): a short `SKILL.md`, with `resources/` for the diagnosis workflow (§7a.1.8), test-change review (§7a.1.9), fuzzing (§7a.1.7), edge cases (§7a.1.6) and the CI path map (§7a.2.4). Reviewed per §7a.2.6.
- **`skill/` (product skill):** `reference/testing.md` reworked, and new references per §7a.3. Reviewed per §7a.2.6.
- **`apps/template/`:** e2e projects, fuzz helper (§7a.3).
- **`.github/workflows/ci.yml`, `release.yml`, `playwright.config.ts`, the Vitest configs, and a new root `.claude/settings.json`:** §7a.2.4 and §7a.2.5.
- **`ai/implementation/plan.md`:** a pointer from §1 and §10 to the new standards, so later plans inherit them.

## 7. Testing
All of this work follows the testing standards of §7a.

- **Unit, against a fake Cloudflare API and a fake auth-app binding:**
  - the code lifecycle: single use, 60 s, bound to app and return URL;
  - an exact-match registry, with an open-redirect attempt refused;
  - state and PKCE;
  - ID-token checks: wrong `aud`, wrong `nonce`, expired;
  - role mapping;
  - the tokens being revoked in the callback;
  - the bootstrap rules: an expiry over 1 day or none means delete at once; delete at the end; nothing written anywhere;
  - the admin pages requesting only their own scopes.
- **Integration (local, and in CI when §7a.2.4 selects it):** mock-oauth2-server stands in for Cloudflare. The full redirect → code → redeem → session path runs over plain HTTP, without a browser.
- **Live, once per release:**
  1. bootstrap with a 1-day token, showing the admin app is deployed and the token deleted;
  2. the owner signs in to the admin app and runs account setup and the everyday token, with an unticked-scope check;
  3. the owner signs in to `prodcheck` through the auth app, showing admin as owner;
  4. a non-admin member signs in, if the owner can invite one, showing user.
  
  Mock login covers the automated passes on `test-` stages. On `prodcheck`, the automated part checks the `/start` redirect (E2E-008, §7.1).

### 7.1 E2E scope for v0.2.0 (TS-15; its own PR)
This is relative to the v0.2.0 end state: sign-in through the auth app, bootstrap plus the admin app, and password, mail and `admins` removed. It depends on the requirement changes in §6.1. Retirements and rewrites go through §7a.1.9 and use the §7a.2.3 retirement mechanics. Additions are `ai-proposed`. An independent subagent reviewed this section (verdict `accepted-with-changes`, changes applied). The implementation's test author turns each item into scenario text and tests, and that text is reviewed again (§7a.2.3).

**Rewrite or retire (stale today or by v0.2.0):**
- **E2E-005:** rewritten for the auth app (§6). Its no-email check inspects real auth-app identities, which carry an email. Test stages use mock login only (§4.3), so that part runs locally against mock-oauth2-server: Where `Local, cloud`.
- **E2E-006:** the test-mail clause goes. A redirect to `<auth app>/start` is expected.
- **E2E-007** becomes "role from membership". Local, with mock-oauth2-server and a fake memberships API:
  - user and admin roles;
  - a promote, a demote, and a removed member each take effect at role refresh or renewal (§4.1 step 5).

  Its live part is `(milestone)`.
- **E2E-008** (today "Real login provider check (automated)": `check-login` on `prodcheck` on every cloud run) becomes two parts: the owner's live sign-in, `Cloud (milestone)`, and an automated `prodcheck` part that checks the `/start` redirect, carrying the app ID and the registered return URL.
- **Password, mail and `admins`:** every scenario clause and test for them goes with those features. The harness pieces go too:
  - `tests/compliance/harness/expected.ts`'s `PASSWORD_PENDING` rules (for SKILL-AC-006 and CLI-AC-001);
  - the `check-login` command's steps (`packages/framework/src/cli/commands/check-login.ts`: all 8 are password, mail or `admins` steps), and `tests/compliance/harness/prodcheck.ts`'s folding of their evidence (`CHECK_LOGIN_IDS`);
  - `tests/compliance/harness/sign-up-budget.ts` (the PAR-259 sign-up ledger);
  - E2E-001's sign-in page step (`tests/compliance/e2e/support/template-pages.ts`), which expects "Log in" to open `/api/auth/sign-in`.
- **AWS:**
  - E2E-011's AWS clause is marked "deferred (branch `aws`)" (DEC-0508).
  - E2E-002's Pass line still says "all three smoke runs" and is aligned with its existing deferral note.
- **The scenarios document's preamble** ("cloud scenarios run on test stages using the authentication mock") is corrected for the `prodcheck` scenarios.
- **E2E-016's term list (`tests/compliance/e2e/terms.txt`)** is checked for v0.2.0 terms, for example Secrets Store and PKCE.
- **Invalidations (COMPL-REQ-006, compliance.md §2), after v0.2.0 changes PROV and CF code and setup:**
  - Invalidate E2E-010, E2E-012, E2E-015, E2E-016's review part (the auth and admin apps need portability notes) and SKILL-AC-006.
  - MAIL-AC-007 leaves the milestone list.
  - E2E-015 has no milestone record today (`validation/release/2026-10-24-33b3df7.md`, the last release report). Its first record comes from the post-v0.2.0 run.

**Add (each with happy path, expected errors and edge cases):**
1. **Setup:** bootstrap, then the admin app, then account setup. Runs locally against the fake Cloudflare API and mock-oauth2-server. The fake Cloudflare API must accept mock-oauth2-server access tokens and enforce their scopes; that is part of this item. Expected errors:
   - a token expiring in over 1 day, or with no expiry, is deleted at once;
   - a token expiring at exactly 1 day is accepted, and one at 1 day plus one second is deleted;
   - a missing permission;
   - an interrupted run re-run;
   - an anonymous visitor, or a non-admin member, is refused by the admin app;
   - a page whose optional scope was not granted shows a clear message;
   - no bootstrap or everyday token value appears in any output or file.

   The live parts stay in §7's live list.
2. **Sign-in through the auth app**, API-driven over HTTP with mock-oauth2-server:
   - **Happy paths:**
     - user and admin roles;
     - sign-out;
     - `deploy` registers the app's return URL, and `remove` deregisters it.
   - **Errors and edge cases:**
     - a return URL not in the registry (open redirect), including one that differs only by trailing slash, case, port or percent-encoding;
     - an app-ID and return-URL mismatch;
     - a code that is reused, expired, or issued for another app;
     - two concurrent redemptions of one code, where exactly one succeeds;
     - consent denied;
     - an ID token with no `email`, using the `/user` fallback (§10);
     - the auth app unavailable: existing sessions keep working, and behaviour at role refresh is defined and tested.
   - Plus one UI test through the sign-in pages.
3. **Starter and upgrade:**
   - E2E-001 is extended to scaffold through the packed `npm create` starter instead of `skill/scripts/scaffold`, rather than adding a new scenario.
   - A new scenario covers `upgrade` from 0.1.x to 0.2.0 using a local 0.2.0 package tarball:
     - the app's own data survives;
     - the "re-run setup" pointer is printed;
     - the next `dev` drops the Better Auth tables through the framework migrations (§8).

**Considered and not added** (with the reason recorded in the PR):
- Stage lifecycle (`stop`, and `deploy` with and without `--start`) is covered by `tests/compliance/criteria/prov/deploy-sequence.test.ts`. The standalone `start` command is not exercised there. If the production-remove refusal, which is unit-level only today, needs e2e, it joins E2E-012's stages to stay within the D1 database cap (`plan.md` §1).
- Capability-unavailable errors are covered by the KV and FILES criteria (KV-AC-005, FILES-AC-006), and API errors (invalid input, unauthenticated, forbidden, unknown route) by E2E-013. An expired-ticket e2e would need a 15-minute wait (PAR-233).
- `reset-local` is covered by LOCAL-AC-002.
- Template on Cloudflare: E2E-001 is Local by design. PROV-AC-001 and CLI-AC-005 cover the deployed template.


## 7a. Testing standards
The lasting text of these standards lands in the files listed in §6.2.

### 7a.1 Common standards (framework and apps)

These sections are normative for the framework repository and for apps. Where a detail differs between the two, the section says so; the framework-only parts are in §7a.2.

#### 7a.1.1 Orchestration (TS-1)
- **What the orchestrator does and doesn't do:** prompt §1 applies to every session's main agent. The main agent plans nothing, writes no code, tests or documents, runs no suites and diagnoses nothing. It briefs subagents, tracks items, merges branches and relays questions to the owner or the app's user.
- **Briefs and replies:** a brief gives file paths, not file contents. Subagents return short summaries, and details go into files in the repository.
- **Parallel work:** independent items run in parallel in their own worktrees and branches whenever that saves wall-clock time. Bounded research is delegated, and only its conclusions return to the main context.
- **In an app:** the app's user may override this.

#### 7a.1.2 Roles
Each of the following is a separate subagent, and none may be the author of the code under test. The first six are kept from prompt §7 and §8 and `plan.md` §1:
- **Implementer.**
- **Test-case author.** Writes from the requirements, criteria, contracts and scenarios, not from the implementation.
- **Test runner.** Records results only. It changes nothing.
- **Evaluator.** Its verdict is the only pass. It flags skipped tests, assertions weaker than the criterion and wrong tags.
- **Diagnoser.**
- **Root-cause reviewer.** It may not review a record whose cause it found itself.

New in these standards:
- **Test-change reviewer** (§7a.1.9).
- **Skill reviewer**, in the framework repository only (§7a.2.6).

#### 7a.1.3 Unit tests (TS-2)
- Red/green/refactor, one behaviour at a time. Confirm the test fails for the expected reason before writing code. Unit tests need no network (prompt §6).
- Every fix is red-green: first a test that reproduces the failure and fails, then the fix (prompt §8 step 3).

#### 7a.1.4 Integration tests (TS-6)
- **Real dependencies:** each test exercises the code with what it really uses, run locally, instead of mocks of those.
  - In the framework: Miniflare/workerd, PGlite, the file system, and local stand-ins such as v0.2.0's mock-oauth2-server (prompt §6; `plan.md` §10.1). On Cloudflare, a `test-` stage where a criterion's Where column says Cloud.
  - In an app: in-process with `createTestApp`, on both SQL dialects, as `verify` runs today.
- **Fakes:** only for external platforms with no local stand-in, such as the fake Cloudflare APIs (`tests/compliance/criteria/_fakes/`; the fake D1 HTTP API, DEC-0347). A run against fakes only is not evidence for a criterion whose Where column says Cloud.
- **Framework coverage:** §7a.2.2.

#### 7a.1.5 End-to-end tests (TS-7)
- **What e2e covers:** every user-facing and operator-facing flow, on its happy path, its expected errors and its edge cases (§7a.1.6). Every new or changed flow adds or extends its e2e tests in the same work, and in the framework its E2E scenario too (§1, testing scope item 2).
- **API-first:**
  - Most e2e tests drive the app's HTTP API, the CLI or both.
  - Playwright UI tests are limited to what only a browser shows: page rendering, sign-in pages, file transfer in the page, cookies.
  - Each user-facing flow has at most a few UI tests. The rest of its cases are API tests.
- **Two Playwright projects:** `e2e-api` and `e2e-ui`. In the framework they replace today's single `e2e` project. Only `e2e-ui` (and, in the framework, the browser criteria in project `integration`) launches a browser, so Chromium is installed only when UI tests run. A test that uses only HTTP (Playwright's `request` fixture or a plain HTTP client) needs no browser. A spot check on 2026-10-31 showed such a test passing with no browser installed.
- **Framework scenario governance:** §7a.2.3.

#### 7a.1.6 Edge cases (TS-7)
For each criterion and scenario, the test author lists edge cases before writing tests and covers the ones that apply. Prompts for that list:
- **Boundaries:** empty, one, exactly at a documented limit, one past it. These run in-process or locally only; on a cloud, follow the cloud usage limits (`plan.md` §1).
- **Text:**
  - Unicode, case and normalisation; `..`, `/` and percent-encoding in names.
  - One name being a prefix of another. The R2 list order defect showed this one (`root-causes/2026-10-24-pass1c-FILES-AC-001-r2-list-order.md`).
- **Order and time:** sort order and paging cursors; expiry at and just past the limit (fake `Date` only).
- **Access:** anonymous, user, admin, and another user's data.
- **Repetition:** repeated and concurrent requests, reuse of single-use tokens or codes.
- **Failures:** an unavailable capability (`setUnavailable`); local versus cloud behaviour differences.

#### 7a.1.7 Fuzzing (TS-8)
- **Where:** targets are chosen one by one, only where fuzzing finds what example tests would miss:
  - parsers, validators and encoders at a trust boundary (names, cursors, redirect and return URLs, codes and tokens, request bodies);
  - especially code with repeated regressions, judged from its root-cause records.

  Having a contract or a schema makes an interface eligible, not required. The target list stays short. In the framework, a reviewer confirms each entry is justified (§9, item s4).
- **How much:**
  - Each fuzz target keeps its run small, and states in the test its run count and fixed seed, with a one-line reason.
  - Fuzz targets run in the normal unit or integration layer and add only seconds.
  - No fuzzing of every endpoint, and no long or exhaustive runs.
- **Local only:** fuzzing runs in-process or against the local `dev` server, never against a cloud stage (`plan.md` §1 cloud usage limits).
- **Findings:** a failure found by fuzzing goes through §7a.1.8. Its case becomes a plain regression test.
- **Tool:** the implementation chooses it, with a decision-log entry. It must run offline in Node, so apps need no other toolchain.

#### 7a.1.8 Failure diagnosis and review (TS-3, TS-4, TS-5, TS-20)
This applies to every failure except a test that is red on purpose during red/green. It covers unit regressions, all integration and e2e failures, and failed builds, deploys and spikes. "Probably", "flaky" and "timing" are not causes without evidence (prompt §8).

**Where records live:** in the framework, `ai/implementation/root-causes/<yyyy-mm-dd>-<item-id>-<slug>.md`. In an app, at the path the product skill names.

1. **Diagnose.** A diagnoser subagent:
   - reproduces the failure;
   - gathers evidence: exact output and logs, requests and responses, state, a debugger session (for example `node inspect`, or Vitest `--inspect-brk` driven from the command line), variations of the test that confirm or rule out each hypothesis, and a minimal reproduction;
   - writes the root-cause record, with sections Symptom, Evidence, Causal chain (evidence per link), Alternatives ruled out, Proposed fix, Verification plan, and Review (`plan.md` §10.5).

   An unproven link means more evidence, never a guess.
2. **Review.** A root-cause reviewer subagent:
   - first decides whether the evidence supports every link and rules out the alternatives;
   - only if it does, evaluates the fix (cause, not symptom);
   - reproduces once, plus one experiment per hypothesis it doubts (`plan.md` §1 test economy rule 8).

   Its verdict is one of `accepted`, `accepted-with-changes` (binding on the fixer) or `rejected`. Each reason is marked **major** or **minor**.
3. **Respond.** On `rejected`, or on any major issue, the diagnoser answers each major issue point by point in a `Response (round n)` section: more evidence, a corrected chain or a revised fix, or a rebuttal with evidence. The record then goes back to review. Minor issues are fixed or answered in the same section.
4. **Similar cases.** After acceptance and before the fix, a subagent searches for the same defect pattern elsewhere: other call sites, other components with the same assumption, the other target. It lists what it found with evidence and adds failing tests for each case.
   - A case outside the fixing item's owned paths becomes a new item. It is not fixed silently (`plan.md` §1 ownership).
5. **Fix.** A fixer subagent fixes red-green: the reproduction test and the similar-case tests fail first, then pass. It follows the accepted record as amended by its Review.
6. **Re-check.** The test runner and the evaluator re-run the affected tests (prompt §8 step 4). The evaluator checks that the record has a Review verdict that came before the fix commit.
7. **Attempts and non-convergence.**
   - An attempt is steps 1–6. A failed re-check starts a new attempt at step 1 in the same record, with its own section.
   - At most 3 attempts per failure, and at most 3 review rounds per attempt.
   - A failure that needed a second attempt or a second review round gets a short non-convergence note. A subagent other than the diagnoser and the reviewer writes it: why the first try did not succeed. If the note shows the standards or the skill were not specific enough, the orchestrator has the skill changed (in the framework, through §7a.2.6).
   - A failure still open after 3 attempts or 3 rounds stops. The orchestrator reports it to the owner, or to the app's user, with the record and the notes.

#### 7a.1.9 Changes to once-green tests (TS-10)
- **What counts as once-green:** a test is once-green if it passed in the current session or is on the main branch.
- **Which layers:** unit, integration, compliance criteria, e2e, smoke and fuzz.
- **What is reviewed:** any change to such a test's expected results or assertions, its removal, a skip, a widened tolerance or timeout, or a changed tag.
- **Who reviews:** an independent test-change reviewer subagent, which wrote neither the change nor the code, before the change is merged.
- **Review in bulk:**
  - The author groups the changes by reason code:
    - `code-removed`, `component-removed` or `behaviour-changed`, each citing the requirement, decision or plan section;
    - `test-was-wrong`, citing its root-cause record;
    - `strengthened`;
    - `refactor-only`.
  - The reviewer judges each group as a whole and samples within it as far as the risk needs. For example, the unit tests of a removed module are one group with one reason, not one review each.
  - The reviewer looks closely at any change where a test was weakened while the code it covers stayed.
- **The record:** one review record per change set: the groups, the verdict per group, and its reasons. In the framework it goes in `ai/implementation/test-reviews/<yyyy-mm-dd>-<item-id>.md`; in an app, at the path the product skill names. The evaluator checks that every once-green test change in its scope is covered by an accepted review.
- **Never weaken to pass:** never skip, delete or weaken a test to get a pass. A wrong test is a root-cause finding (prompt §8).

#### 7a.1.10 Test impact of every change (TS-9)
- **Briefs:** every implementation brief has a "Tests" section with:
  - the unit, integration and e2e tests to add, change or remove;
  - in the framework, the E2E scenarios affected;
  - the fuzz targets affected.
- **Delivery:** the implementer makes these changes in the same work. The test author covers the criteria and scenarios.
- **Reports:** the item's report lists the test impact and every test change by reason code (§7a.1.9).
- **Framework plans:** include a "Tests" section and an "E2E" section for every work item.

### 7a.2 Framework repository only

#### 7a.2.1 Kept practices
The following stay as they are:
- **Tagging (`plan.md` §10.3):** `[ID]` in titles, and never an ID the test does not check. Unit tests count as evidence only for unit-level criteria (the `UNIT_LEVEL` list in `tests/compliance/harness/expected.ts`, DEC-0319).
- **Evidence (`plan.md` §10.5; compliance.md):** records under `validation/<target>/`, the four statuses, and milestone invalidation.
- **Test economy rules 1–9 (`plan.md` §1, owner, 2026-10-20).** They govern what agents run; CI selection follows §7a.2.4. Rule 2 (docs-only items) now runs the linters plus only the tests listed for the changed docs (§7a.2.4).
- **Cloud usage limits (`plan.md` §1).**
- **Offline runs:** `unshare -rn sh scripts/offline.sh`; never simulate offline by unsetting `HTTPS_PROXY` or disabling TLS (`plan.md` §10.2).
- **Unit timeout:** 30 s under load (`vitest.unit.config.ts`).
- **Order-dependence checks:** economy rule 6.

#### 7a.2.2 Integration coverage (TS-6)
- Every framework component in the v0.2.0 end state has a comprehensive integration suite, under `packages/framework/test/integration/<component>/` or in its compliance criteria.
- A planning subagent lists the components that have neither. Today `packages/framework/test/integration/` has no suite for `provision`, `evidence`, `testing`, `targets` or `client`. Some of these are covered by `tests/compliance/criteria/`, and the planner confirms which.
- Each gap becomes a test-author item.

#### 7a.2.3 E2E scenario governance (TS-15)
- **Origin lines:** CONVENTIONS §4 is extended to E2E scenarios. Each scenario gets an `Origin` line. The existing scenarios get `Origin: ai-proposed (reviewed by the owner before 2026-10-31)`.
- **Who may change them:** CONVENTIONS §4 gains this rule: agents may add, change and retire E2E scenarios of any origin to match the framework's current intent. Each change needs a decision-log entry and an independent subagent's review, and no owner approval.
- **The README status row:** `docs/README.md`'s "Reviewed by owner" row gets a note that it is not an approval gate for later changes.
- **Test-change review:** changes and retirements also go through §7a.1.9.
- **IDs and mechanics:**
  - New IDs continue from the highest one (E2E-017 is next). IDs are never renumbered or reused, and a retired ID is kept (CONVENTIONS §2).
  - A new scenario has a `Where:` line (without one, `tests/compliance/harness/catalogue.ts` silently leaves it out of the catalogue) and a `Verifies:` line (CONVENTIONS §3).
  - Its tagged tests land in the same change: E2E-004's coverage part fails for an automated-tier scenario with no tagged test.
  - Live-only parts use the `(milestone)` flag, because a bare `(manual)` counts as automated.
- **Retiring a scenario:** its entry moves to a "Retired scenarios" table (retired ID, former scenario, former Where, reason or replacement) with no `Where:` line, as `google.md` §4 does for its retired criteria. The catalogue adds every entry that has a `Where:` line, so a retired one would otherwise stay expected.

#### 7a.2.4 CI (TS-11, TS-16, TS-19)
**Triggers.**
- `ci.yml` runs on `pull_request` only. The `push: branches: [main]` trigger is removed.
- `release.yml` keeps its version-tag trigger.

**Change classification.** A first step classifies the PR's changed files against a committed path map:
- **Docs, specs and plans** (`docs/**`, `ai/**`, `*.md`, `retrospective/**`):
  - Only the linters that apply to the changed files run; no test runs.
  - The exceptions are the few files that a unit or integration test or the build reads (for example contracts and skill text). The path map lists them in a short, reviewed list, with the tests that read them, and only those tests run.
  - The exception never selects e2e tests. The release run covers anything the list misses.

  This is the TS-16 choice: prose changes cost almost nothing, and the few docs that are test inputs still get their tests.
- **Unit tests:** the whole unit layer runs on any change to code or unit tests. It is the cheapest layer. Selecting by import graph would miss tests that read files without importing them.
- **Integration tests:**
  - Each component's integration suite and compliance criteria run when that component's source or tests change, and when a component it depends on changes. The dependencies come from `docs/architecture/component-map.md`.
  - Shared inputs run every component's integration tests: the lockfile, root configs, `core`, `config`, `testing`, the build and the compliance harness.
- **E2E:**
  - The local e2e projects run when application behaviour changes: framework source and `bin`, the template, reference and demo apps' source, migrations and config, the starter package's source, the skill's scripts, the lockfile, and the e2e support code.
  - Changes only to unit tests, integration tests, docs or specs never run e2e.
  - A change only to e2e specs runs only the changed specs.
- **Linters:** CI runs the linters appropriate to the changed files (TS-12).
- **Chromium:** installed only when a selected test needs a browser (`e2e-ui`, the Playwright `integration` project, and the template-pages browser test in `tests/skill/example-pages.test.ts`). Today `ci.yml` already installs it only when browser-visible paths change; `release.yml` always installs it.

**No duplicates.** Each test file belongs to exactly one layer and is selected at most once per run. A deliberate exception needs a decision-log entry with its reason. To fix today:
- `tests/skill/**/*.test.ts` (integration config) also collects `*.unit.test.ts` files that the unit layer already runs. DEC-0405 moved SKILL-AC-004's file-only checks into `tests/skill/example-copies.unit.test.ts` and relies on the integration glob still collecting it, because the integration run is what evidences SKILL-AC-004 for the compliance driver. Supersede DEC-0405 with an entry that keeps SKILL-AC-004 evidenced with a single run.
- `tests/skill/examples.test.ts` runs the template and reference `verify`, which `ci.yml` also runs directly.
- `release.yml` re-runs all of `tests/skill` (including `example-pages` and `examples`) and the `create-prototype-app` tests after `npm run verify`, which already runs the unit layer and both apps' `verify`.

**Release.** `release.yml` runs every test once: unit, all integration (Vitest and Playwright `integration`), and both local e2e projects, with Chromium. Cloud passes and milestone items keep their compliance tiers (compliance.md §2), because GitHub Actions has no cloud credentials.

#### 7a.2.5 Linters and the Claude Code hook (TS-12, TS-18)
- **The hook:** a Claude Code hook in a new root `.claude/settings.json` (the repository has none today) runs when Claude runs `git commit`. It runs the linters on the staged files and blocks the commit if they fail. There is no git pre-commit hook.
- **The linters:**
  - eslint;
  - typecheck;
  - the root-cause record lint: required sections, and a Review verdict or `Status: awaiting review`;
  - the test-review record lint.
- **CI:** runs the linters appropriate to the PR's changes (§7a.2.4). The two record linters run only in the hook.
- **Where hooks apply:** Claude Code harness hooks apply only to this repository. They are never shipped to apps (TS-18).

#### 7a.2.6 Changes to skills that affect testing (TS-13)
- **What's covered:**
  - any change to `.claude/skills/testing-standards/**`;
  - any change to the product skill's testing references;
  - any change to `skill/SKILL.md`'s hard rules or its definition of done.
- **Who reviews:** a skill-reviewer subagent, before the change is committed.
- **What it checks:**
  - **Quality:** no rule that protects test quality is removed, loosened or made ambiguous.
  - **Progressive disclosure:**
    - `SKILL.md` holds only the rules that always apply, plus pointers to specific files.
    - Details live in reference files that each start with "Read this when…" and end with a stopping condition.
    - The product skill stays within PAR-070…072.

  Its verdict and reasons go in the commit message, or in the PR description for a batch.

### 7a.3 Apps built with the framework (TS-1, TS-14, TS-15, TS-18)
Apps get §7a.1 through the product skill (`skill/`), the template and the framework's `/testing` export. App builders' agents apply it without asking the user technical questions, and explain results in plain words.

- **Left out for apps:**
  - §7a.2 as a whole;
  - anything that relies on Claude Code harness hooks, which exist only in the framework repository (TS-18).
- **CI:** installing or updating the framework's npm packages (`npm create`, `npm install`, `upgrade`) never creates or changes an app's CI. The product skill may suggest CI changes to the app's user, who decides. Checked on 2026-10-31: neither the starter nor `upgrade` writes CI files today.
- **Orchestration:** the app's main session orchestrates (§7a.1.1), unless the app's user overrides it.
- **Remove:** the rule that app tests reach the app only through its API and add no browser driver.
- **Layers in an app:**
  - unit tests (TDD) for the app's own logic;
  - integration tests (§7a.1.4);
  - e2e: API-first against `dev`, plus a few Playwright UI tests of the app's pages (§7a.1.5);
  - the smoke test on a deployed stage, unchanged.
- **Keeping e2e current:** the app's agent keeps the app's e2e tests current as the app changes, and after a framework upgrade, unless the app's user directs otherwise. Changes to once-green tests go through §7a.1.9.
- **The template ships:**
  - the e2e layer and its two Playwright projects;
  - a small fuzz helper for route inputs, driven by a route's zod schema. The skill says to use it only on routes that meet §7a.1.7, not on every route.
  - pinned Playwright, added to the hard-rule-5 pins.

  Chromium is installed only when UI tests run.
- **The skill tells the app's agent to:**
  - use red/green/refactor;
  - run §7a.1.8 with subagents, with records at a path the skill names;
  - search for similar cases;
  - review changes to once-green tests (§7a.1.9);
  - state each change's test impact;
  - keep e2e current.
- **Disclosure:** each of these is a reference read only when needed, and the skill stays within PAR-070…072.
- **Hard rule 3** (`verify` before done) widens to cover the app's e2e projects.


## 8. Migration from 0.1.x
- **Release:** v0.2.0, a minor version, which is breaking before 1.0 (CHANGELOG policy). Password accounts and sessions are dropped, and the CHANGELOG says so plainly. Its pre-1.0 policy: "before 1.0.0, a minor version may make breaking changes".
- **`npm run upgrade`** to 0.2.0 points to re-running setup: bootstrap, then the admin app.
- **New framework migrations** drop the tables that framework migrations 0001 and 0002 created: the five `__framework_auth_*` tables (Better Auth and the sign-in rate limit; 0003 added `role` to `__framework_auth_user`) and `__framework_test_mail`. They run with the app's migrations (locally, on the next `dev`).
- **The admin app offers cleanup** of the v0.1.x email resources (routing rules, test mailbox, the `prototype-mailsink` Worker and bucket, sending domain). It's optional, and never automatic.

## 9. Work breakdown (parallel waves; DEC and PAR numbers start after the last on main when work begins)
Every item's brief carries its "Tests" and "E2E" sections (§7a.1.10).
- **Wave 0, before wave 1, in parallel:**
  - (s1) standards text: `CONVENTIONS.md`, `compliance.md`, `CLAUDE.md`, and the testing-standards skill, reviewed per §7a.2.6 (§6.2);
  - (s2) the Claude Code commit hook and the record linters (§7a.2.5);
  - (s3) CI and release restructuring, Playwright projects, and duplicate removal (§7a.2.4), shown by a PR whose classification log matches the path map;
  - (s4) the integration coverage list (§7a.2.2) and a short fuzz target list (§7a.1.7), by a planning subagent, read-only. A reviewer confirms each fuzz target is justified.
- **Wave 1, in parallel:**
  - (a) the auth app: OAuth flow, D1, codes, registry, service-binding interface (§3, §4);
  - (b) the framework's auth-app provider and session changes, with removal of Better Auth and MAIL (§4.1 step 4, §6);
  - (c) the bootstrap command changes (§5.1);
  - (d) spec and docs changes (§6, `auth.md`), including the requirement changes of §6.1 once the owner has approved their wording.
- **Wave 2, in parallel:**
  - (e) the admin app pages (§5.2);
  - (f) Secrets Store adoption, including the signing credential, deploy bindings, and the fallback to Worker secrets;
  - (g) the skill, quickstart and migration notes (§5.3, §8), and §7a.3 in the product skill and the template;
  - (h) the root `README.md` (added after the v0.1.1 release, in commit `39ea129`). Rewrite whatever it says about sign-in, passwords, mail, the `admins` command and Cloudflare setup to match v0.2.0 (today its Cloudflare section asks for Workers Paid, a domain on Cloudflare DNS and two token links):
    - sign-in with Cloudflare through the auth app, with roles from account membership (§4);
    - the bootstrap token, then the admin app (§5);
    - the removals (§6);
    - the upgrade from 0.1.x (§8).
    
    Read the README as it is on main when this work starts; don't assume its layout.
- **Then:**
  - a test author for the criteria (§7);
  - the e2e scope of §7.1, in its own PR;
  - integration suites for the gaps found in (s4);
  - fuzz targets from (s4);
  - a test-change review of all v0.2.0 test removals, grouped by reason code (§7a.1.9), before the removal merges;
  - an independent review;
  - red-green fixes, each failure through the diagnosis and review workflow of §7a.1.8;
  - the live pass, which needs the owner's bootstrap token and sign-ins, so do it last and batch them.

## 10. Risks
- **Single point of failure:** if the auth app is down, nobody can sign in. Existing sessions keep working until they expire.
- **Testers must be account members.** "HTTP Applications Read" works as the least-privilege tester role: verified that such a member can sign in, and is capped by that role (§2.1a).
- **Secrets Store is a beta.** Keep a fallback to Worker secrets.
- **Role names are free text** from the API. Keep the mapping as a PAR, and record the verified strings.
- **Cloudflare could change the claims.** If the ID token stops carrying `email` (discovery lists only `sub`), fall back to `/user`, which needs `user-details.read`; that is already required.
