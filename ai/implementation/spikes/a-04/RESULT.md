# A-04 — Turning a stage Worker's `workers.dev` route off and on through the API

> **Code and logs archived.** This spike's scripts, `logs/` and `out/` are on branch `archive/implement-local-cloudflare`, in the same directory (see ARCHIVE-INDEX.md there, and `ai/ARCHIVE.md`). The relative paths below resolve on that branch.

Date: 2026-10-19 (19:52–19:57 UTC). Node v22.22.0. Pin: Wrangler 4.149.0 (PAR-101).
Cloud resources: Worker `spikeqgbznvyy-a04-worker`, KV namespace `spikeqgbznvyy-a04-kv` (both deleted).
Wrangler environment exactly as A-01 recorded (placeholder `CLOUDFLARE_API_TOKEN=proxy-injected`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`, `CLOUDFLARE_ACCOUNT_ID`, `HTTPS_PROXY`). Direct API calls are plain `curl` to `api.cloudflare.com` through the proxy; the spike never sends an Authorization header. The secret is a dummy value generated for the spike and kept outside the repo; the Worker reports only the first 8 hex digits of its SHA-256.

Redaction: every log went through `redact.py` (account ID, 32-hex IDs, ANSI codes, account name, bearer values, and the account `workers.dev` subdomain, replaced by `<subdomain>`, as in A-02). The KV namespace ID and subdomain were only in a gitignored generated config (`worker/wrangler.gen.jsonc`, deleted).

## Question

DEC-0078 / MIG §2 steps 1 and 6 / cloudflare.md `stopApp`/`startApp`: can a stage Worker's public address (its `workers.dev` route) be turned off and back on through the Cloudflare API **without redeploying**, with its secrets and bindings intact? Which API calls, what state before/after, and what propagation delay?

## Verdict

**Yes.** The assumption holds; no fallback is needed.

- **API:** `POST /accounts/{account}/workers/scripts/{script}/subdomain` with JSON body `{"enabled": false, "previews_enabled": false}` stops; `{"enabled": true, "previews_enabled": false}` starts. `GET` on the same path reads the state (`result.enabled`, `result.previews_enabled`). Both return the new state synchronously (`success: true`).
- **While off:** the URL returns **HTTP 404** with body `error code: 1042` (Cloudflare's "Worker not reachable on workers.dev"); the route is gone, not erroring inside the Worker.
- **No redeploy:** script settings (bindings, compatibility date, annotations), the deployments list and the versions list are byte-identical before, while off, and after on (`diff` of `a02`/`a04`/`a06` and `a03`/`a05`/`a07`; versions stayed at 2: the upload and the `secret put`). Toggling creates no version or deployment.
- **Secrets and bindings survive:** after turning back on, the Worker returns the same secret hash (`8d3534bf`, matching the expected hash in `c00`), the plain-text var and the KV value (`c04`).
- **Propagation** (curl from the sandbox, probe every ~0.5 s, t=0 when the API call returned; "stable" = 10 consecutive identical statuses ≈ 7–10 s):

  | Cycle | Off → first of stable 404 | On → first of stable 200 |
  | --- | --- | --- |
  | 1 (`t01`/`t02`) | 0.00 s (already 404 on first probe) | 1.54 s |
  | 3 (`t03`) | 0.80 s | 0.77 s |
  | 4 (`t04`) | 0.86 s | 0.79 s |
  | 5 (`t05`) | 0.77 s | 0.74 s |
  | 6 (`t06a`) | 2.27 s | — |

  Max observed 2.3 s; each probe itself takes ~0.7 s, so this is an upper bound at that resolution. No flapping back after the switch in any cycle. Measured from one location (the sandbox's egress); other Cloudflare edge locations were not observed.

### Findings that change how `stopApp`/`startApp` must be written
1. **Always send `previews_enabled` explicitly.** In cycle 1 the body was `{"enabled": true}` alone; the response showed `previews_enabled: true` although it was `false` before (`t02`). Omitting it turns on preview URLs. Cycles 3–6 sent both fields and `previews_enabled` stayed `false`. The framework sends `{"enabled": <bool>, "previews_enabled": false}` (stages never use preview URLs).
2. **A deploy re-enables the route.** With the route off, `wrangler deploy` of a config with `workers_dev: true` turned it back on (`a09`: `enabled: true`) and the app answered 200 with secrets intact (`c05`). So a deploy during a stop is itself a start for wrangler. For MIG step 6 this is harmless (deploy is immediately followed by `startApp`), but it means the stop is not "held" across a deploy, and SST's behaviour (its Worker `url` / `WorkersScriptSubdomain` resource) was not tested here — D-03 must check whether an SST deploy changes the route, and the CLI keeps calling `startApp` explicitly after deploy as cloudflare.md already requires.
3. **Secret changes take a moment to reach requests.** Immediately after `wrangler secret put` the Worker still served the previous version without the secret (`c01`: `"secret": null`); a few seconds later it had it (`c02`). Not an A-04 question, recorded for D-03/SEC tests (wait/poll after `secrets set`).

## Exact commands

From `ai/implementation/spikes/a-04/` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md) after `npm install`, with `SCRATCH` pointing at a private directory holding the KV id, the dummy secret and the subdomain (never committed). `run.sh` wraps each step; `./run.sh log <name> ./run.sh <step>` records a step to `logs/<name>.txt` (redacted).

```
./run.sh kv-create                      # wrangler kv namespace create spikeqgbznvyy-a04-kv
./run.sh gen-config                     # worker/wrangler.template.jsonc -> wrangler.gen.jsonc (KV id filled in)
./run.sh kv-put                         # wrangler kv key put probe kv-value-a04 --remote
./run.sh deploy                         # wrangler deploy (workers_dev: true, preview_urls: false, var + KV binding)
./run.sh secret-put                     # wrangler secret put SPIKE_SECRET (dummy value on stdin)
./run.sh get before                     # curl the workers.dev URL
./run.sh sub-get                        # GET  /accounts/$ID/workers/scripts/$W/subdomain
./run.sh settings | deployments | versions   # GET .../settings, .../deployments, .../versions
./run.sh toggle '{"enabled":false}' 404                          # cycle 1 off
./run.sh toggle '{"enabled":true}' 200                           # cycle 1 on
./run.sh cycles 3 5   # toggle {"enabled":false,"previews_enabled":false} / {"enabled":true,"previews_enabled":false}
./run.sh toggle '{"enabled":false,"previews_enabled":false}' 404 ; ./run.sh deploy ; ./run.sh sub-get   # redeploy while off
./run.sh delete ; ./run.sh kv-delete    # cleanup
```
`toggle` = `curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/<worker>/subdomain" -H 'content-type: application/json' --data '<body>'`, then probe the URL every 0.5 s until 10 consecutive requests return the wanted status, then `GET` the subdomain state.

## Raw output excerpts (redacted; full logs in `logs/`)

`logs/a01-sub-get-before.txt`
```
{ "result": { "enabled": true, "previews_enabled": false }, "success": true, ... }
```
`logs/a02-settings-before.txt` (identical in `a04` while off and `a06` after on)
```
"annotations": { "workers/triggered_by": "secret" },
"bindings": [
  { "name": "KV", "namespace_id": "<hex32>", "type": "kv_namespace" },
  { "name": "SPIKE_SECRET", "type": "secret_text" },
  { "name": "SPIKE_VAR", "text": "plain-var-a04", "type": "plain_text" } ]
```
`logs/t01-off-1.txt`
```
request sent at 19:53:29.789 UTC: POST /workers/scripts/spikeqgbznvyy-a04-worker/subdomain {"enabled":false}
{ "result": { "enabled": false, "previews_enabled": false }, "success": true, ... }
API returned at 19:53:30.320 UTC; probing every 0.5 s (t=0 = API return)
t+0.00s status=404
stable: 10 consecutive 404 from t+0.00s
```
`logs/c03-get-while-off.txt`
```
error code: 1042
http=404
```
`logs/t02-on-1.txt`
```
request sent at 19:53:48.391 UTC: POST /workers/scripts/spikeqgbznvyy-a04-worker/subdomain {"enabled":true}
{ "result": { "enabled": true, "previews_enabled": true }, "success": true, ... }     <- previews flipped on
t+0.00s status=404
t+1.54s status=200
stable: 10 consecutive 200 from t+1.54s
```
`logs/c04-get-after-on.txt`
```
{"path":"/after","secret":"8d3534bf","var":"plain-var-a04","kv":"kv-value-a04"}
http=200
```
`logs/t04a-off.txt` / `logs/t04b-on.txt` (typical cycle with both fields sent)
```
t+0.00s status=200 / t+0.86s status=404 / stable ... GET subdomain after: {"enabled":false,"previews_enabled":false}
t+0.00s status=404 / t+0.79s status=200 / stable ... GET subdomain after: {"enabled":true,"previews_enabled":false}
```
`logs/w05-deploy-while-off.txt` + `logs/a09-sub-after-redeploy.txt` + `logs/c05-get-after-redeploy.txt`
```
Deployed spikeqgbznvyy-a04-worker triggers (0.85 sec)
{ "result": { "enabled": true, "previews_enabled": false } ... }
{"path":"/redeploy","secret":"8d3534bf","var":"plain-var-a04","kv":"kv-value-a04"}  http=200
```
`logs/a08-versions-after-on.txt`: two versions (number 1 `triggered_by: upload`, number 2 `triggered_by: secret`); none from toggling.

## Proxy
No host was refused. `recentRelayFailures` after the spike lists only A-02's earlier made-up-subdomain control; nothing for `api.cloudflare.com` or this Worker's host.

## Leftover cloud resources
None. `logs/c06-leftovers.txt`: Workers scripts with prefix `spikeqgbznvyy`: `[]`; KV namespaces with prefix `spikeqgbznvyy`: `[]`; the URL afterwards returns 404. The account `workers.dev` subdomain was not changed.
Local only (not committed): `node_modules/`, `~/.config/.wrangler/logs`.

## Fallback
None needed (plan fallback: none — ask owner).
