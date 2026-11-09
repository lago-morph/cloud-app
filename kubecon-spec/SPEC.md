# KubeCon planner: build spec

A self-contained spec for building a small personal conference planner for **KubeCon +
CloudNativeCon North America 2026** (Salt Lake City, Sun 8 Nov to Thu 12 Nov 2026). It runs
on Cloudflare Workers, and people sign in with Cloudflare OAuth ("Sign in with Cloudflare").

Requirement IDs (R-n) are what the acceptance criteria (AC-n) and tests refer to. Items marked
**[unverified]** have not been tested live. Check them first, and fall back as described.

---

## 0. Context and time budget

- **R-0.1** The conference is in progress: today is **Mon 9 Nov 2026**, the busiest day. Aim to
  have a working live URL in about **20 minutes**. Ship the smallest thing that meets section 8,
  then improve it.
- **R-0.2** Users: one owner, plus possibly other members of the owner's Cloudflare account. The
  app is used mostly **on a phone** at the venue.
- **R-0.3** Start from an empty repository. Use TypeScript, `wrangler` (v4), and `vitest`. Use
  no UI library: plain HTML, CSS and a small TypeScript or JS client are enough.

## 1. Environment facts (read before doing anything)

- **E-1** The env var `CLOUDFLARE_API_TOKEN` holds one long-lived **account-owned** API token, and
  `CLOUDFLARE_ACCOUNT_ID` holds its account ID. The token has these permissions, among others:
  Workers Scripts Write, D1 Write, Workers R2 Storage Write, Secrets Store Read/Write,
  **OAuth Client Write**, and Account API Tokens Read/Write.
- **E-2** Use this token for **everything**: wrangler reads `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` directly, and raw API calls use `Authorization: Bearer $CLOUDFLARE_API_TOKEN`.
  The owner will not create or set any other token or env var.
- **E-3** Never print, log, echo or commit the token value or the account ID. Keep them out of
  `wrangler.jsonc`, test output, commit messages and docs. Pass the account ID at deploy time
  (see R-5.4).
- **E-4** It is an account token, so `GET /user/tokens/verify` fails (code 1000). Verify it with
  `GET /accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify` instead.
- **E-5** Do not mint new tokens. The API refuses to create a token that itself has
  token-management permissions, and none is needed.
- **E-6** In Claude Code cloud sessions, outbound HTTPS goes through a proxy. Node-based tools
  (wrangler, node scripts, npm scripts that fetch) need **`NODE_USE_ENV_PROXY=1`** in the
  environment, for example `NODE_USE_ENV_PROXY=1 npx wrangler deploy`. `curl` works as is.
- **E-7** The account's workers.dev subdomain is `cloud-app-asdf`, so Worker URLs are
  `https://<worker-name>.cloud-app-asdf.workers.dev`. Confirm this with
  `GET /accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain`, and do not print the response body.
- **E-8** Do not use Cloudflare Zero Trust or Access: Zero Trust is not enabled on the account,
  and the owner wants OAuth.
- **E-9** The account has a Workers Paid plan, so CPU limits are not a concern for a
  2 MB JSON parse.

## 2. Schedule data

### 2.1 Source

- **R-2.1** The data comes from the **Sessionize public API**: no auth, JSON, CORS `*`.
  - Endpoint: `GET https://sessionize.com/api/v2/{code}/view/All`
  - Response: `{ sessions[], speakers[], questions[], categories[], rooms[] }`

| Feed (`kind`) | Code | Size | Content |
|---|---|---|---|
| main | `svi82w6c` | ~2 MB, 600 sessions | Main conference, Sun–Thu. Monday holds 51 lightning talks, 11 co-located **umbrella placeholders**, 12 sponsor events, 2 registration and 2 experiences. |
| colocated | `ayajbd6b` | ~0.8 MB, 229 sessions | CNCF-hosted co-located events (Monday detail). |
| maintainer | `qtujim6y` | ~120 KB, 40 sessions | CNCF Maintainer Summit (Sunday). |
| sponsor | `etvmcsmr` | ~33 KB, 14 sessions | Sponsor-hosted co-located events. All 14 are also in the main feed. |

- **R-2.2** Session fields used:
  - `id`: a string; numeric IDs also occur, so convert them to a string.
  - `title`, `description` (nullable), `startsAt`, `endsAt`.
  - `speakers`: speaker UUIDs.
  - `categoryItems`: item IDs.
  - `roomId`.
  - Skip a session that has no `startsAt` or no `endsAt`.
- **R-2.3** Times: `startsAt` and `endsAt` are **local wall-clock times with no offset**
  (`YYYY-MM-DDTHH:MM:SS`), in America/Denver. US DST ended on 1 Nov, so this is MST, UTC−7.
  - Store and compare them **as text**. Derive `day` as `startsAt.slice(0,10)`.
  - Display `HH:MM` taken straight from the string. Never pass these strings through `new Date()`
    in the browser, because that would shift them into the phone's time zone.
  - Label times as "Salt Lake City time". If an absolute time is ever needed, append `-07:00`.
- **R-2.4** Lookups:
  - **Room**: `rooms[].{id,name}`. Names look like `Salt Palace | Level 1 | Grand Ballroom H`.
  - **Speaker**: `speakers[].{id, fullName, tagLine, questionAnswers[{questionId, answerValue}]}`.
    The company is the answer to the question titled `Company` in `questions[]`; the job title is
    the answer to `Speaker Title`. If a speaker has no company answer, use `tagLine` as the title.
  - **Category item**: an ID maps to `{category title, item name}` through
    `categories[].{title, items[{id,name}]}`.
- **R-2.5** Classification, per feed:
  - **main, sponsor**: `track` = the first item of the category `All Sessions`, or `"Other"` if
    there is none. `format` = null. `events` = [].
  - **colocated**:
    - Take the items of `All Sessions`, with leading non-letter and non-digit characters stripped
      (for example `"☕ Breaks"` becomes `"Breaks"`). These items are co-located event names
      (ArgoCon, BackstageCon, Observability Day, …).
    - If an item is one of `Breaks`, `Experiences` or `Registration`, then `track` = that item.
      Otherwise `track` = `"CNCF-hosted Co-located Events"`.
    - `events` = the items other than those three. A shared break can list several events.
    - `format` = the first item of `Session format`, stripped the same way. Values are Breakout,
      Keynote, Lightning Talk or Panel.
  - **maintainer**: `track` = `"Maintainer Summit"`. `events` = `["CNCF Maintainer Summit"]`.
    `format` = the first item of `Session Category`, or null.
- **R-2.6** Merge rules. These are the rules of the working importer and must stay exactly as
  stated. Feeds are processed in priority order **main, colocated, maintainer, sponsor**.
  1. **Repeated IDs**: a session ID seen in more than one feed is kept once, using the copy from
     the first feed in priority order. This is how the sponsor feed's 14 sessions, which repeat
     the main feed, are deduplicated. The sponsor feed is still read so that a sponsor event
     missing from the main feed would still be imported.
  2. **Umbrella placeholders**: if the colocated feed returned at least one session, drop every
     session from a feed **other than** colocated whose track is
     `"CNCF-hosted Co-located Events"`. These are the main feed's 11 umbrella placeholders, which
     the detailed talks replace. If the colocated feed is empty, keep the placeholders.
  3. **Registration**: if the main feed has at least one session with track `"Registration"`,
     drop the colocated feed's sessions with track `"Registration"`. They repeat the main feed's
     registration entries under different IDs.
  4. **Order**: sort by `startsAt`, then by ID (left-padded to 12 characters).
- **R-2.7** Expected result: about **854** sessions (roughly 850 to 860; the feeds change live)
  from Sun 8 Nov to Thu 12 Nov. Monday is the heaviest day, with about 290 sessions: about 227
  co-located talks plus about 67 main-feed sessions.

### 2.2 Import and refresh

- **R-2.8** Import runs **server-side in the Worker**. It fetches all 4 feeds in parallel, with a
  20 s timeout each. If any feed fails, or returns JSON that is not in the expected shape, the
  import fails with a message naming that feed, and **the stored schedule is kept**.
- **R-2.9** Import **upserts by Sessionize ID**. New sessions are inserted, changed sessions
  updated, and sessions no longer present in any feed deleted.
  - Refuse to store a merged result of **0 sessions**, so that an outage cannot wipe the schedule.
  - Run the writes with `env.DB.batch([...])` in chunks of ≤ 100 statements, using single-row
    `INSERT … ON CONFLICT(id) DO UPDATE` statements.
- **R-2.10** Selections refer to sessions by Sessionize ID and **survive any re-import**. No
  import touches the `selections` table, and there is no foreign key from selections to sessions.
  If a selected session is deleted from the feed, hide it from My schedule; do not delete the
  selection.
- **R-2.11** **Auto-import when empty**: if `sessions` is empty when the session list is first
  requested, run the import before answering.
- **R-2.12** A "Refresh schedule" button (any signed-in user) calls `POST /api/import`. The
  response is `{added, updated, removed, total}`. The UI shows the time of the last import.

## 3. Features

- **R-3.1** **Browse**:
  - Day tabs: Sun 8, Mon 9, Tue 10, Wed 11, Thu 12. The tab for today, Salt Lake City date, is
    selected by default.
  - The list is ordered by start time. Each item shows its time range, title, room, track or
    event, and a speaker line of the form `Name (Company), Name`.
- **R-3.2** **Search** (case-insensitive substring) over the title and the speaker line, which
  includes the company. Search runs within the selected day, with an "all days" toggle.
- **R-3.3** **Filters**: day, track (the distinct `track` values), and co-located event (the
  distinct `events` values). Filters combine with AND, and with search.
- **R-3.4** **Session details**: title, day and time, room, track, event(s), format, the full
  description, and speakers with company and title. It has an add or remove toggle.
- **R-3.5** **Add or remove** a session from My schedule, one tap, from both the list and the
  details view.
  - Selections are saved **per signed-in user** in D1, so they are the same on every device.
  - Conflicts are allowed.
- **R-3.6** **My schedule**: per-day tabs Sun to Thu, each laid out as a **vertical time grid**.
  - Hour lines are shown, and the grid spans the earliest start to the latest end of that day's
    selections, with a 08:00–18:00 minimum.
  - Each block's top and height are proportional to its start time and duration.
  - **Overlapping sessions sit side by side** in columns, and each one that overlaps another is
    **marked as a conflict** with a visible badge and colour.
  - Tapping a block opens its details.
- **R-3.7** **Layout algorithm** (a pure function, unit-tested):
  1. Sort by start time, then the longer session first, then ID.
  2. Split the sessions into groups that overlap transitively. A session that starts exactly when
     another ends does **not** overlap it.
  3. Within a group, give each session the leftmost column that is free at its start time. The
     group's column count is the number of columns it uses, and each block's width is
     1/column count.
  4. `conflictsWith` = the IDs in the group that overlap this session **directly**.
  5. A session that ends on a later day is capped at 24:00.
- **R-3.8** **Mobile first**:
  - Usable at 360 px width with no horizontal page scroll, and tap targets of at least 40 px.
  - The day tabs stick to the top.
  - Text stays readable in side-by-side blocks: each block shows at least the start time and a
    truncated title.
- **R-3.9** All times are displayed in Salt Lake City time (R-2.3), and the UI says so once, for
  example "Times: Salt Lake City (MST)".

## 4. Architecture

- **R-4.1** **One Worker**, named `kubecon-planner`. Before first use, check with
  `GET /accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts` that no script of that name exists. If
  one does, use `kubecon-oauth-planner`. Everything below uses `<app>` for this name, so
  `<origin>` = `https://<app>.cloud-app-asdf.workers.dev`.
- **R-4.2** The Worker serves:
  - the **static frontend**, through Workers Static Assets: `"assets": {"directory": "./public",
    "binding": "ASSETS", "run_worker_first": ["/api/*", "/auth/*"]}`;
  - the **JSON API** under `/api/*`;
  - the **auth routes** under `/auth/*`.
- **R-4.3** **D1** database `kubecon-planner` (binding `DB`) holds sessions and selections. The
  schema is created with wrangler D1 migrations.
- **R-4.4** **Secrets** (`wrangler secret put`):
  - `OAUTH_CLIENT_SECRET`
  - `SESSION_SECRET`: 32 random bytes, base64.

  **Vars** (`wrangler.jsonc` `vars`, or `--var` at deploy):
  - `OAUTH_CLIENT_ID`: not secret.
  - `ACCOUNT_ID`: passed with `--var` at deploy and not committed (E-3).
  - `ALLOWED_EMAILS`: comma-separated, optional.
- **R-4.5** **Session cookie** `kp_session`:
  - Value: `base64url(JSON{uid, email, exp})` + `.` + `base64url(HMAC-SHA256(SESSION_SECRET, payload))`.
  - Attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800` (7 days).
  - Verify the HMAC with `crypto.subtle` and compare in constant time. Reject the cookie if it has
    expired.
- **R-4.6** **Data model** (`migrations/0001_init.sql`):

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- Sessionize id
  source TEXT NOT NULL,           -- main | colocated | maintainer | sponsor
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,              -- YYYY-MM-DD (local)
  starts_at TEXT NOT NULL,        -- YYYY-MM-DDTHH:MM:SS (local, no offset)
  ends_at TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  track TEXT NOT NULL,
  format TEXT,
  events TEXT NOT NULL DEFAULT '[]',    -- JSON array of event names
  speakers TEXT NOT NULL DEFAULT '[]',  -- JSON [{name, company, title}]
  speaker_text TEXT NOT NULL DEFAULT '' -- "Name (Company), Name" for list + search
);
CREATE INDEX sessions_day ON sessions(day, starts_at);
CREATE TABLE selections (
  user_id TEXT NOT NULL,          -- Cloudflare user id
  session_id TEXT NOT NULL,       -- Sessionize id; no FK (survives re-import)
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);  -- last_import_at, last_import_result
```

- **R-4.7** **API routes**. All `/api/*` routes require a valid session cookie and answer `401`
  JSON otherwise. The state-changing routes are `POST` and `DELETE`; they must also have
  `Origin` equal to `<origin>`, or they answer `403`.

| Method | Path | Behaviour |
|---|---|---|
| GET | `/api/me` | `{userId, email}` |
| GET | `/api/sessions` | All sessions (about 854, a small JSON of ~300 KB; filter in the client). Auto-imports when empty (R-2.11). Includes `lastImportAt`. Description omitted. |
| GET | `/api/sessions/:id` | Full session, including the description |
| POST | `/api/import` | Runs the import (R-2.8–R-2.9) and returns `{added, updated, removed, total}` |
| GET | `/api/selections` | `[sessionId…]` for the current user |
| PUT | `/api/selections/:id` | Adds the session (idempotent). Returns `204`, or `404` if the session is unknown. |
| DELETE | `/api/selections/:id` | Removes the session (idempotent). Returns `204`. |

- **R-4.8** The client keeps the session list in memory, and computes filtering and the
  My-schedule layout locally with the same pure `layoutDay` module, which is shared and
  unit-tested.

## 5. Auth: Sign in with Cloudflare (OAuth 2.0 authorization code + PKCE)

### 5.1 Facts

- **R-5.1** Cloudflare's OIDC discovery document is at
  `https://dash.cloudflare.com/.well-known/openid-configuration`. It was **verified live
  2026-11-09** and gives:
  - `issuer` `https://dash.cloudflare.com`
  - `authorization_endpoint` **`https://dash.cloudflare.com/oauth2/auth`**
  - `token_endpoint` **`https://dash.cloudflare.com/oauth2/token`**
  - `revocation_endpoint` `https://dash.cloudflare.com/oauth2/revoke`
  - `userinfo_endpoint` `https://dash.cloudflare.com/oauth2/userinfo`
  - `jwks_uri` `https://dash.cloudflare.com/.well-known/jwks.json`
  - `code_challenge_methods_supported` `["plain","S256"]`
  - `token_endpoint_auth_methods_supported` includes `client_secret_post` and `client_secret_basic`
  - ID tokens are RS256, and `claims_supported` is only `["sub"]`.

  Hard-code these two endpoints. Do not fetch discovery at runtime.
- **R-5.2** Scopes: the scope IDs match API permission names, and the list is
  `GET https://api.cloudflare.com/client/v4/oauth/scopes`. `user-details.read`
  ("User Details Read") and `memberships.read` ("Memberships Read") were **verified to exist
  2026-11-09**. `openid` is added automatically from `response_types`.
  - Request: `scope=openid user-details.read memberships.read`
- **R-5.3** Client visibility: per the Cloudflare docs, new clients are **private** by default,
  and only members of the parent account can authorize a private client. **[unverified live]**
  The app still enforces membership itself (R-5.9).

### 5.2 Create the OAuth client (one-off, with the owner's token)

- **R-5.4** Requires the **OAuth Client Write** permission, which the token has. Be idempotent:
  1. First list the existing clients with
     `GET https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/oauth_clients`.
  2. If one with `client_name` `kubecon-planner` exists and you do not have its secret, delete it
     (`DELETE …/oauth_clients/{client_id}`, **[unverified]**) and create it again. The secret is
     returned only once.
  3. Create it:

```
POST https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/oauth_clients
Authorization: Bearer $CLOUDFLARE_API_TOKEN
Content-Type: application/json

{
  "client_name": "kubecon-planner",
  "redirect_uris": ["https://<app>.cloud-app-asdf.workers.dev/auth/callback"],
  "response_types": ["code"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "client_secret_post",
  "scopes": ["user-details.read", "memberships.read"]
}
```

  - The response is `result.client_id` and `result.client_secret`. Docs: "the only time the
    secret is returned".
  - Do this in a small Node script, `scripts/create-oauth-client.mjs`, run with
    `NODE_USE_ENV_PROXY=1`. Do not use shell `curl | tee`, which would put the secret in a
    terminal. The script must:
    1. pipe `client_secret` straight into
       `npx wrangler secret put OAUTH_CLIENT_SECRET --name <app>` on stdin;
    2. write `client_id` into `wrangler.jsonc` `vars.OAUTH_CLIENT_ID`;
    3. never print the secret, the token or the account ID.
  - The Worker must exist before `secret put` (deploy once first), or use `wrangler secret put`
    after the first deploy.
  - **[unverified]** The Cloudflare API reference lists the body fields `client_name`,
    `redirect_uris`, `response_types`, `grant_types`, `token_endpoint_auth_method` and `scopes`
    as required. This exact body has not been sent live yet. If it is rejected:
    1. read `errors[]` and adjust;
    2. try `response_types: ["code","id_token"]`;
    3. otherwise create the client in the dashboard (Manage account, OAuth clients) as a last
       resort, and ask the owner only then.
- **R-5.5** The **redirect URI** is exactly `<origin>/auth/callback` and must match byte for byte
  in the authorize request and the token request.

### 5.3 Flow

- **R-5.6** `GET /auth/login`:
  1. Generate `state` (32 random bytes, base64url) and a PKCE `code_verifier` (32 random bytes,
     base64url). Compute `code_challenge = base64url(SHA-256(verifier))`.
  2. Store `{state, verifier, exp: now+10min}` in a signed, HttpOnly, Secure, SameSite=Lax cookie
     `kp_oauth`, with `Path=/auth`, `Max-Age=600`.
  3. Answer `302` to `https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=…&redirect_uri=…&scope=openid%20user-details.read%20memberships.read&state=…&code_challenge=…&code_challenge_method=S256`.

  Lax cookies are sent on the top-level GET redirect back from `dash.cloudflare.com`.
- **R-5.7** `GET /auth/callback?code&state`:
  1. **Check the request.** If there is an `error` parameter, show it. Refuse the request when
     `kp_oauth` is missing, invalid or expired, or its `state` does not match, comparing in
     constant time.
  2. **Exchange the code.** `POST https://dash.cloudflare.com/oauth2/token`,
     `application/x-www-form-urlencoded`, with:
     - `grant_type=authorization_code`, `code`, `redirect_uri`
     - `client_id`, `client_secret` (client_secret_post)
     - `code_verifier`

     Use `redirect: "manual"` on every server-side fetch that carries a secret or a bearer token.
  3. **Get the identity.** Call `GET https://api.cloudflare.com/client/v4/user` with
     `Authorization: Bearer <access_token>` (scope `user-details.read`). Use `result.id` as the
     user ID and `result.email` as the email.
     - **[unverified live]** Identity was obtained this way in an earlier implementation, which
       used `result.email` and the ID token's `sub`.
     - If `result.id` is missing, fall back to the `sub` claim of the ID token. Decoding it
       without verification is acceptable only for this fallback, because it came straight from
       the TLS token response.
  4. **Check membership** (R-5.9).
  5. **Sign in.** Set `kp_session`, clear `kp_oauth`, and `302` to `/`.
  6. **Discard the token.** Do not store the Cloudflare access token. Optionally revoke it at the
     revocation endpoint. Any failure renders a small error page with a "Try again" link and
     never shows a code, a token or the secret.
- **R-5.8** Unauthenticated UI: the static page calls `/api/me`. On `401` it shows only a
  **"Sign in with Cloudflare"** button that links to `/auth/login`.
- **R-5.9** Access rule. Allow the user if **either** condition holds:
  - (a) their email, compared case-insensitively, is in `ALLOWED_EMAILS`;
  - (b) `GET https://api.cloudflare.com/client/v4/memberships?per_page=50` (bearer access token,
    scope `memberships.read`) contains an entry with `account.id === env.ACCOUNT_ID` and
    `status === "accepted"`. Read up to 20 pages.

  Otherwise answer `403` "Not a member of this Cloudflare account". Roles are not used: every
  accepted member is allowed.
  - **[unverified live]** The membership response shape `result[].{account.id, status, roles[]}`
    comes from an earlier implementation.
  - The default deploy leaves `ALLOWED_EMAILS` empty, so membership alone decides. Do not ask the
    owner for their email.
- **R-5.10** `POST /auth/logout` (and `GET`, for simplicity) clears `kp_session` with `Max-Age=0`
  and redirects to `/`. A "Sign out" link sits in the header.

## 6. Deployment

- **R-6.1** Prefix every wrangler call with `NODE_USE_ENV_PROXY=1`. wrangler uses
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the env, so do **not** run
  `wrangler login`. Steps:
  1. `npx wrangler d1 create kubecon-planner`, then put the `database_id` into `wrangler.jsonc`.
     A database ID is not secret.
  2. `npx wrangler d1 migrations apply kubecon-planner --remote`
  3. `npx wrangler deploy --var ACCOUNT_ID:$CLOUDFLARE_ACCOUNT_ID`. This is the first deploy;
     `workers_dev: true`.
  4. `node scripts/create-oauth-client.mjs`, which sets `OAUTH_CLIENT_SECRET` and
     `OAUTH_CLIENT_ID` (R-5.4).
  5. Set `SESSION_SECRET` from a random value generated in Node and piped into
     `npx wrangler secret put SESSION_SECRET`.
  6. Redeploy as in step 3.
- **R-6.2** Put steps 3 and 6 in an `npm run deploy` script. It must pass the account ID through
  `--var` without echoing it.
- **R-6.3** The app is served at `https://<app>.cloud-app-asdf.workers.dev`. No custom domain,
  no routes, no zones.
- **R-6.4** `compatibility_date`: today or earlier. Enable `nodejs_compat` only if a dependency
  needs it; none should.

## 7. Testing

- **R-7.1** Use `vitest` unit tests, with no network. Fixtures are **small hand-cut JSON**
  files, a few sessions per feed and under 20 KB in total, under `test/fixtures/`. Fetch the live
  feeds only into a git-ignored folder (`.cache/`) when building fixtures, and never commit them.
- **R-7.2** Importer and merge tests (`parseFeed`, `mergeFeeds`), at least:
  1. Times are kept unchanged, and `day` = the start date. A session that ends after midnight
     stays on its start day.
  2. The speaker's company and title come from the `Company` and `Speaker Title` answers. The
     tagline is the fallback title.
  3. Co-located classification: the event goes in `events`, the format in `format`, and the track
     is `CNCF-hosted Co-located Events`. A shared break goes under `Breaks` with all its events.
     A registration entry goes under `Registration`.
  4. The maintainer track and event are set as in R-2.5.
  5. A session without a start or end time is skipped. A numeric ID becomes a string. Malformed
     feed JSON throws an error naming the feed.
  6. Merge drops the main umbrella placeholders when colocated has sessions, and keeps them when
     colocated is empty.
  7. Merge drops colocated `Registration` entries when main has registration.
  8. A sponsor duplicate is kept once, as the main copy. The output is sorted by start time,
     then ID.
  9. The store step refuses an empty merged result. A re-import leaves `selections` unchanged.
     This can use a fake `DB`, or Miniflare's D1 through `@cloudflare/vitest-pool-workers` if it
     installs quickly.
- **R-7.3** Layout tests (`layoutDay`):
  1. No overlap gives 1 column.
  2. Two overlapping sessions give 2 columns, and each conflicts with the other.
  3. Sessions that touch end to start do not conflict.
  4. A chain of 3 sessions where only adjacent ones overlap gives 2 columns, and the middle
     session conflicts with both.
  5. A session ending on the next day is capped at 1440 minutes.
- **R-7.4** Auth tests, with `fetch` stubbed:
  1. Login sets `kp_oauth` and redirects to `https://dash.cloudflare.com/oauth2/auth` with
     `code_challenge_method=S256`, the correct `redirect_uri` and the scopes.
  2. The callback rejects a missing or mismatched state.
  3. The callback posts `code_verifier`, `client_secret`, `redirect_uri` and `grant_type` to the
     token URL.
  4. A non-member gets `403`. An accepted member gets the `kp_session` cookie, with HttpOnly,
     Secure and SameSite=Lax.
  5. A tampered cookie is rejected by `/api/me`.
  6. Logout clears the cookie.
- **R-7.5** One live smoke check after deploy, a script `npm run smoke`:
  1. `GET <origin>/` gives 200 HTML.
  2. `GET <origin>/api/me` without a cookie gives 401.
  3. `GET <origin>/auth/login` gives 302, and the Location header starts with
     `https://dash.cloudflare.com/oauth2/auth`.
  4. `npx wrangler d1 execute kubecon-planner --remote --command "SELECT day, COUNT(*) FROM sessions GROUP BY day"`
     shows 5 days, with Monday 2026-11-09 the largest. To populate the table first, the owner's
     first signed-in load triggers auto-import. Alternatively, an import can be triggered once
     via a temporary authenticated request.
  5. Then the owner does the browser sign-in check in section 8.

## 8. Don'ts

- **D-1** Don't commit raw downloaded feeds, HTML pages, screenshots, logs or other large files.
  Keep the repo small (well under 1 MB), and git-ignore `.cache/`, `.wrangler/` and
  `node_modules/`.
- **D-2** Don't create, roll or delete API tokens. Don't ask the owner for a token.
- **D-3** Don't use Cloudflare Zero Trust or Access, or a custom domain.
- **D-4** Don't ask the owner to set env vars or secrets. Do it yourself with the existing token
  (E-2).
- **D-5** Don't print or commit `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, the OAuth client
  secret, `SESSION_SECRET` or Cloudflare access tokens.
- **D-6** Don't fetch Sessionize from the browser or on every request. Fetch only on import.
- **D-7** Don't convert event times through the browser's time zone (R-2.3).
- **D-8** Don't add a UI library, an ORM, or more Workers, D1 databases or buckets than
  specified.

## 9. Definition of done (acceptance criteria)

- **AC-1** A live URL `https://<app>.cloud-app-asdf.workers.dev` is deployed and passes the
  smoke check (R-7.5).
- **AC-2** On a phone, the owner taps "Sign in with Cloudflare", approves on
  `dash.cloudflare.com`, and lands back in the app signed in. Their email is shown, and
  "Sign out" works.
- **AC-3** A signed-in user who is not a member of the account is refused with 403. This can be
  shown by the unit test R-7.4 item 4.
- **AC-4** The schedule is present: about 854 sessions over Sun–Thu, with **Monday 9 Nov**
  holding the co-located talks (ArgoCon, Observability Day, …). The co-located umbrella
  placeholders are not shown.
- **AC-5** Search by title, speaker or company, and the day, track and co-located event filters,
  work. Session details show the description and speakers.
- **AC-6** A session added on one device appears in My schedule on another device after signing
  in as the same user. It survives "Refresh schedule".
- **AC-7** In My schedule, two selected overlapping sessions are shown side by side, and both are
  marked as conflicts. Block heights follow duration. All times match the official schedule in
  Salt Lake City time.
- **AC-8** `npm test` passes. The repository contains no secrets and no raw feeds.
