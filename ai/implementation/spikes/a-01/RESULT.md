# A-01 — Cloudflare access and tool authentication through the sandbox proxy

> **Code and logs archived.** This spike's scripts, `logs/` and `out/` are on branch `archive/implement-local-cloudflare`, in the same directory (see ARCHIVE-INDEX.md there, and `ai/ARCHIVE.md`). The relative paths below resolve on that branch.

Date: 2026-10-19. Node v22.22.0, npm 10.9.4. Pins: Wrangler 4.149.0 (PAR-101), SST 4.17.2 (PAR-100), Cloudflare provider 6.15.0 (PAR-108, `providers: { cloudflare: "6.15.0" }`).
Cloud resources were all named `spikewxlyyipn-…` except SST's state bucket, whose name `sst-state` is fixed by SST (see "State home").

## Question

What environment and invocation make **wrangler** and **SST/Pulumi** authenticate to Cloudflare in this sandbox, where the API token is not in the environment and the proxy injects it into HTTPS requests to `api.cloudflare.com`? Is a non-secret placeholder token accepted (and replaced by the proxy)? Are `NODE_USE_ENV_PROXY=1` and `NODE_EXTRA_CA_CERTS` needed? Where does SST keep its Cloudflare state home, and does it work?

## Verdict

| Tool | Works? | Required environment |
| --- | --- | --- |
| prompt §10 token-verify curl | yes | none beyond the sandbox defaults |
| wrangler 4.149.0 | **yes** | `CLOUDFLARE_API_TOKEN=<any non-empty non-secret placeholder>` (we used `proxy-injected`), `CLOUDFLARE_ACCOUNT_ID`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`, `HTTPS_PROXY` (sandbox default). `NODE_USE_ENV_PROXY` not needed. |
| SST 4.17.2 + Pulumi Cloudflare 6.15.0 | **yes** | `CLOUDFLARE_API_TOKEN=<placeholder>`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID` (set it explicitly), `HTTPS_PROXY`. `NODE_EXTRA_CA_CERTS` and `NODE_USE_ENV_PROXY` not needed (SST/Pulumi are Go binaries using the system trust store, which holds the proxy CA). |
| SST state home `home: "cloudflare"` | **yes** | Same as SST. SST creates R2 bucket `sst-state` and reads/writes it through `api.cloudflare.com` (worked with no `AWS_*` variables in the environment). |

Key facts established:
- **Without a token variable, neither tool tries the API.** wrangler: "You are not authenticated. Please run `wrangler login`." (log `w01`; `CLOUDFLARE_API_TOKEN=` empty behaves the same, `w03`). SST: "Cloudflare API not initialized. Please provide CLOUDFLARE_API_TOKEN …" (`s03`).
- **A placeholder value is accepted and replaced by the proxy.** With `CLOUDFLARE_API_TOKEN=proxy-injected` (a literal that is not a valid token) wrangler reports "You are logged in with an Account API Token, associated with the account <account-name>" and performs writes; SST creates, refreshes and removes resources. The only way that can succeed is the proxy overwriting the tool's `Authorization: Bearer proxy-injected` header with the injected token. No real credential was ever placed in the environment, printed or committed.
- **The token is an Account API token** (wrangler: "logged in with an Account API Token"), so `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_DEFAULT_ACCOUNT_ID` should always be set explicitly rather than letting tools discover the account.
- **The proxy refused no host** during the spike (`recentRelayFailures: []` after every phase). Hosts used implicitly and allowed: `api.cloudflare.com`, plus SST's downloads of Pulumi, bun and provider plugins (`Downloaded provider cloudflare-6.15.0`, `aws-7.20.0`, …).

## Exact working invocations

wrangler (any directory; `-c` names the config):
```
CI=1 CLOUDFLARE_API_TOKEN=proxy-injected \
  CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID \
  NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  HTTPS_PROXY=$HTTPS_PROXY \
  wrangler <command>
```
SST (from the app directory containing `sst.config.ts` with `home: "cloudflare"`):
```
CI=1 SST_STAGE=<stage> CLOUDFLARE_API_TOKEN=proxy-injected \
  CLOUDFLARE_DEFAULT_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID \
  HTTPS_PROXY=$HTTPS_PROXY \
  sst deploy|refresh|remove
```
(`sst install` / any command needs a stage: `--stage` or `SST_STAGE`, log `s01`.)

Wrappers used: `wrangler.sh`, `sst.sh` (knobs `DUMMY_TOKEN`, `MINIMAL` = `env -i` with only the listed variables, `EXTRA_CA`, `SET_DEFAULT_ACCT`), `redact.py` (account ID, 32-hex IDs, account name, ANSI codes removed from every log).

## Experiments and raw output (excerpts, redacted; full logs in `logs/`)

### Token verify (prompt §10)
```
curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/tokens/verify"
→ success: True, messages: "This API Token is valid and active", status: active
```

### wrangler 4.149.0
| Log | Environment (on top of sandbox defaults unless MINIMAL) | Command | Result |
| --- | --- | --- | --- |
| w01 | no token var | `wrangler whoami` | "You are not authenticated. Please run `wrangler login`." |
| w02 | `CLOUDFLARE_API_TOKEN=proxy-injected` | `whoami` | "You are logged in with an Account API Token, associated with the account <account-name>." |
| w03 | `CLOUDFLARE_API_TOKEN=` (empty) | `whoami` | not authenticated (empty = unset) |
| w04 | placeholder + `NODE_USE_ENV_PROXY=1` | `whoami` | same as w02 (variable has no effect; wrangler prints "Proxy environment variables detected. We'll use your proxy for fetch requests.") |
| w05 | placeholder | `kv namespace create spikewxlyyipn-a01-kv` | created |
| w06 | placeholder | `deploy -c worker/wrangler.jsonc` (`workers_dev: false`) | "Uploaded spikewxlyyipn-a01-worker (1.35 sec)", "No targets deployed" (intended) |
| w09 | placeholder | `kv namespace list` | lists `spikewxlyyipn-a01-kv` |
| w10/w11 | placeholder | `secret put SPIKE_VALUE` (non-secret value on stdin), `secret list` | "Success! Uploaded secret SPIKE_VALUE"; listed as `secret_text` |
| w12/w13 | placeholder | `delete --force`, `kv namespace delete` | "Successfully deleted spikewxlyyipn-a01-worker"; "Deleted KV namespace" |
| w14 | MINIMAL (`env -i` PATH, HOME, HTTPS_PROXY, NO_PROXY, CI, CLOUDFLARE_ACCOUNT_ID, placeholder) | `whoami` | **fails**: "Wrangler detected that a corporate proxy or VPN might be enabled on your machine, resulting in API calls failing due to a certificate mismatch." / "✘ [ERROR] fetch failed" |
| w15 | MINIMAL + `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` | `whoami` | works (as w02) |

w07/w08 (`wrangler d1 list` with/without `CLOUDFLARE_ACCOUNT_ID`) exited 0 but printed no table (the account had no D1 databases), so they do **not** establish whether wrangler works without the account ID; always set it.

### SST 4.17.2 / Pulumi Cloudflare 6.15.0
App `sst-app/sst.config.ts`: `name: "spikewxlyyipn"`, `home: "cloudflare"`, `removal: "remove"`, `providers: { cloudflare: "6.15.0" }`; resources `sst.cloudflare.Kv("Kv")` and raw `cloudflare.WorkersKvNamespace("RawKv")`.

| Log | Environment | Command | Result |
| --- | --- | --- | --- |
| s01 | no stage | `sst install` | "No stage specified. Pass it in with --stage or set the SST_STAGE environment variable." |
| s02 | `SST_STAGE=a01` | `sst install` | "✓ Installed providers" (downloads of pulumi, bun to `~/.config/sst/bin` succeeded through the proxy) |
| s03 | `CLOUDFLARE_DEFAULT_ACCOUNT_ID`, no token | `sst deploy` | "✕ cloudflare: Cloudflare API not initialized. Please provide CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL environment variables or in the provider section of the project configuration file." |
| s04 | + `CLOUDFLARE_API_TOKEN=proxy-injected` | `sst deploy` | Downloaded providers (cloudflare-6.15.0, aws-7.20.0, random-4.16.6, tls-5.0.1, command-1.0.1, docker-build-0.0.14); "Created Kv sst:cloudflare:Kv", "Created RawKv cloudflare:index:WorkersKvNamespace"; "✓ Complete" |
| s05 | placeholder, **no** `CLOUDFLARE_DEFAULT_ACCOUNT_ID` | `sst deploy` | "✓ Complete" (no changes). SST evidently resolves the account itself; not relied on. |
| s06 | MINIMAL (`env -i` PATH, HOME, HTTPS_PROXY, NO_PROXY, CI, SST_STAGE, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DEFAULT_ACCOUNT_ID, placeholder; **no** NODE_EXTRA_CA_CERTS, SSL_CERT_FILE, AWS_*) | `sst refresh` | all resources "Refreshed"; "✓ Refreshed" |
| s07 | MINIMAL as s06 | `sst remove` | all four resources "Deleted"; "✓ Removed" |

### State home
- After s04, `GET /accounts/$ID/r2/buckets` listed one bucket, `sst-state`, created at the time of the first deploy (2026-10-19T19:34:25Z) — **SST names it; the name is fixed, not per app.**
- Objects (via `GET …/r2/buckets/sst-state/objects`): `app/<app>/<stage>`, `passphrase/<app>/<stage>`, `snapshot/<app>/<stage>/<id>`, `eventlog/…`, `update/…` (lock entries come and go during an update).
- s06/s07 ran with no `AWS_*` variables, so state reads/writes go through `api.cloudflare.com` with the injected token, not through the R2 S3 endpoint.
- **`sst remove` does not delete the stage's state objects** — 14 objects (incl. `passphrase/…`) remained after s07. They were deleted with `cleanup_state.py` (R2 object DELETE through `api.cloudflare.com`; Python `urllib`, no Authorization header sent), and then the empty `sst-state` bucket was deleted. Implication for D-03/PROV: `remove` must delete `*/<app>/<stage>…` state objects itself if a stage must leave nothing behind, and `setup-account` should treat `sst-state` as the state home it creates/confirms (it is account-wide and shared by every SST app).

## Not tested here (owned by other spikes)
SST deploy of a Worker script with bindings (A-03), `workers.dev` reachability (A-02), R2 S3 endpoint (A-07), D1 HTTP API (A-05/A-06).

## Leftover cloud resources
None. After cleanup: Workers scripts `[]`, KV namespaces `[]`, R2 buckets `[]`, D1 databases `[]`. The `sst-state` bucket created by this spike was emptied and deleted; the first `setup-account`/SST deploy will recreate it.
Local only (not committed): `~/.config/sst/bin` (pulumi, bun), `~/.config/sst/plugins`, `~/.pulumi/workspaces`, `~/.config/.wrangler/logs`.

## Fallback
None needed: both tools work. (Plan fallback would have been "stop and ask owner".)
