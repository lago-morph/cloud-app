# fix-mig002 — decision drafts

### DEC-PENDING-fix-mig002-1 — `dev` binds its ports itself: Vite first, then Wrangler on port 0 for the Worker and the inspector
Origin: ai-proposed · Status: accepted · Affects: DEC-0204, local.md §2, cli.md §2 (`dev` bullet), LOCAL-REQ-004, `packages/framework/src/cli/commands/dev.ts`, `packages/framework/src/cli/dev/plan.ts`, `packages/framework/src/cli/dev/runtime.ts`, and their unit tests

DEC-0204's sentence "Ports are free loopback ports picked at start." becomes: "No port is picked before its bind. Vite starts first on loopback port 0, and its bound port is the public origin. Wrangler then starts with `--port 0 --inspector-port 0` (still `--ip 127.0.0.1` and `--inspector-ip 127.0.0.1`) over an `ipc` channel. `dev` takes the Worker's port from wrangler's `DEV_SERVER_READY` IPC message, or else from its `Ready on http://127.0.0.1:<port>` line, and then points Vite's `/api` proxy at it. Until then `/api` answers 503. If Vite's bind fails with its own structured `EADDRINUSE`, `dev` starts the client again, at most 3 attempts in all, and prints each retry to stderr with the port and the attempt. After the last attempt it fails with Vite's original error and exits 1. It re-runs nothing else, and any other failure ends `dev` at once." In DEC-0204's process-layout sentence, "Wrangler ... then Vite" becomes "Vite, then Wrangler". cli.md §2's `dev` bullet says the same: it starts Vite on `127.0.0.1` first, then `wrangler dev` on a loopback port that Wrangler binds itself. Nothing else in DEC-0204 changes: the Host check, the loopback-only listeners, the printed origin, the stop behaviour and the exit statuses.

Reasons:
1. The root cause, ai/implementation/root-causes/2026-10-20-mig-ac-002-workerd-crash.md (Review, Required change 1), found that `freePort()` (listen on port 0, read the port, close) leaves a 1–2 s window before workerd binds the port. In that window another socket can take it, and workerd then dies with `bind(): Address already in use` (F2). With port 0, the kernel picks the port during workerd's own bind, so it never hands out one that is in use. wrangler 4.149.0 passes 0 through unchanged (`cli.js:374922-374931`, `:212070`) and sends `DEV_SERVER_READY` when it has an IPC channel (`cli.js:374832-374843`).
2. Vite 8.3.4 has no race-free port 0. `httpServerStart` (`vite/dist/node/chunks/node.js:14687-14696`) also picks an ephemeral port with `getAvailableEphemeralPort`, releases it, and then binds it. So the client port keeps a short window, and the Review's bounded retry (reason 4) covers it. The retry depends only on a structured error code. Vite's `listen` rethrows `EADDRINUSE` as a plain `Error("Port N is already in use")`. The real `startClient` therefore reads the code from the http server's own `"error"` event and throws `ClientPortInUseError` (carrying Vite's original error) only when that code is `EADDRINUSE`. Output text is never matched. A middleware-mode Vite on a server `dev` binds itself would remove this window as well, but it would change Vite's HMR, restart and host handling. That is a larger change than this fix needs.
3. The late `/api` target: Vite hands the proxy's `configure(proxy, options)` the same options object that its http-proxy spreads into every request (`node.js:19928-19929`, `:19734-19740`). Setting `target` on that object after Wrangler reports its port takes effect on the next request. Until then, the first middleware answers 503 for `/api`. No request can arrive before the URL is printed, because the URL is printed only after `proxyApiTo`.

Inspector: still enabled, and on loopback. In one local `dev` run of a scratch copy of `apps/reference` (no Cloudflare call), every listener of the dev process group was on 127.0.0.1. `GET /json/version` answered `{"Browser":"wrangler/v4.149.0","Protocol-Version":"1.3"}` on one listener (wrangler's inspector proxy) and `{"Browser": "workerd", ...}` on another. `/api/auth/me` through Vite answered 200.

Evidence:
- Red, before the change:
  - `test/integration/local/dev.test.ts` "serves even when every port freePort returns is taken by another socket before dev binds it" failed with `dev ended before serving: Error: Port 39191 is already in use`.
  - The new `plan.unit.test.ts` tests failed: the args held the picked ports, and `devServerReadyPort` and `readyLinePort` did not exist.
- Green, after the change: both pass, with the CLI unit suite and the local `dev` integration suite. See the record's red-green table.
Item: fix-mig002.

## Parameter changes

None.
