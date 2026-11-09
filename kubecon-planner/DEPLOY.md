# Deployment: Cloudflare test stage `test-kubecon`

Deployed 2026-11-09 with framework `0.2.0-rc01`. It used only the existing `CLOUDFLARE_API_TOKEN`, the owner's admin account token. No other token was created, and no token was changed.

- **Live URL:** https://kubeconplanner-test-kubecon.cloud-app-asdf.workers.dev
- **Stage:** `test-kubecon`, a test stage that uses `config/cloudflare/test.json`.
- **Worker:** `kubeconplanner-test-kubecon`. **D1 database:** `kubeconplanner-test-kubecon-db-1`.

## What was run (in `kubecon-planner/`)

```sh
NODE_USE_ENV_PROXY=1 npm run deploy -- --target cloudflare --stage test-kubecon
NODE_USE_ENV_PROXY=1 npm run smoke  -- --target cloudflare --stage test-kubecon
```

- **`deploy`** succeeded on the first try. It needed no app change, no missing secret and no setup-version or admin-app step. For a `test-` stage, the framework's preflight checks only that the token verifies and that the shared 0.1.0 resources exist, and they do. The health check (`/api/__framework/health`) answers 204.
- **`smoke`** passed 3 of 3: health; import if empty (SQL, KV, outbound fetch to Sessionize); add a session, read it back, remove it. The evidence is in `validation/cloudflare/upaga9lg0qhw7bd.json` at the repo root, committed with this file. The log is in R2 bucket `prototype-logs` under `kubeconplanner/test-kubecon/2026/11/09/`.

## Live browser check (Playwright, Chromium, through the real UI)

The check signed in with the **Log in** button and got user `mock-user`, level `user`.

- **Schedule:** 854 sessions imported. They cover Sun 8 Nov (44), Mon 9 Nov (292), Tue 10 Nov (194), Wed 11 Nov (203) and Thu 12 Nov (121), across 12 co-located events. On Monday, 237 of the 292 sessions are co-located-event sessions.
- **Selections and conflicts:** two overlapping Tuesday sessions were added from Browse:
  - `1369670`, 10:45–11:15;
  - `1289746`, 10:45–11:30.

  After a page reload, both were still saved. The Tuesday tab read "Tue, Nov 10: 2 selected, 2 in conflict". Both blocks had the `conflict` class (red) and a "Conflict" badge, and the summary read "2 overlapping (shown side by side in red)".
- **Cleanup:** the check then removed both selections, so `mock-user` starts with an empty schedule.

The check needs the sandbox Chromium shim described in `README.md` ("Checks"), with `PLAYWRIGHT_BROWSERS_PATH` pointing at symlinks that map 1248 to 1243.

## How to sign in so your selections persist

A test stage has **no real sign-in**, only the framework's authentication mock.

- **Log in** goes to `/api/auth/login`, which signs you in at once as the fixed user **`mock-user`**. There is nothing to type, and every click of Log in gives the same user. Your selections are stored on the server under that ID, so they come back after reloads, on other browsers and on other devices.
- The session cookie lasts 12 hours. After that, or after **Log out**, press **Log in** again. You are `mock-user` again and your selections are still there.
- **Anyone who opens the URL and presses Log in is the same `mock-user`** and sees and edits the same schedule. The URL is public. Do not keep anything private there.
- To use a separate identity, POST to `/api/auth/mock-login` with body `{"level":"user","id":"<any id>"}` from the browser console. Use the same `id` each time to get that identity back. The smoke and e2e tests use random IDs, so they never touch `mock-user`.

## Caveats

- A test stage is meant to be temporary. Remove it when done with `NODE_USE_ENV_PROXY=1 npm run remove -- --target cloudflare --stage test-kubecon`. Removing it deletes the selections.
- The stage costs one D1 database (free plan limit: 10) while it exists. Each full import of about 850 rows counts toward the free plan's limit of about 100k D1 rows written per day. A re-import of an unchanged schedule writes nothing.
- A production stage with real Cloudflare sign-in still needs the 0.2.0 account setup: a bootstrap token, then the admin app, then the auth app. See `BUILD-GUIDE.md` §4. That is not possible with only the current token.
- Every framework cloud command ran with the admin token as `CLOUDFLARE_API_TOKEN`. It worked, but it gives each command full account rights. The designed everyday token, `prototype-framework`, has 4 permissions.
