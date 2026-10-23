# A-02 — Is a deployed Worker's `workers.dev` address reachable from this sandbox?

> **Code and logs archived.** This spike's scripts, `logs/` and `out/` are on branch `archive/implement-local-cloudflare`, in the same directory (see ARCHIVE-INDEX.md there, and `ai/ARCHIVE.md`). The relative paths below resolve on that branch.

Date: 2026-10-19 (19:46–19:50 UTC). Node v22.22.0. Pins: Wrangler 4.149.0 (PAR-101), `@playwright/test` 1.64.1 (PAR-114, A-10), Chromium build `chromium-1248` under `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.
Cloud resource: one Worker, `spikemkmteluy-a02-worker` (deleted). Wrangler environment exactly as A-01 recorded (placeholder `CLOUDFLARE_API_TOKEN=proxy-injected`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`, sandbox `CLOUDFLARE_ACCOUNT_ID`, `HTTPS_PROXY`). No Authorization header was sent by the spike; no credential appears in any log.

Redaction: every log went through `redact.py` (account ID, 32-hex IDs, ANSI codes, account name, bearer values, and the account's `workers.dev` subdomain, which contains the owner's name, replaced by `<subdomain>`; the subdomain value is passed in `A02_SUBDOMAIN` and is not committed).

## Question

Prompt §10: "Stage addresses on `workers.dev` were not confirmed reachable. A request to a made-up `workers.dev` name was refused by the proxy, so check with a real deployed Worker in phase A." Is a real deployed Worker's `workers.dev` URL reachable with curl, Node `fetch` (`NODE_USE_ENV_PROXY=1`) and Playwright Chromium? What is the account's `workers.dev` subdomain status?

## Verdict

**Reachable from every client tested.** The proxy refused nothing for the real Worker host.

| Client | Result | Notes |
| --- | --- | --- |
| curl (sandbox defaults) | **200**, body `spike a-02 ok /hello`, 3/3 requests, first request ~1 s after `wrangler deploy` returned | CONNECT through `HTTPS_PROXY` → `200 Connection Established`; TLS cert is the real one (`CN=<subdomain>.workers.dev`, issuer Let's Encrypt YE2), i.e. the proxy tunnels this host without interception |
| Node 22 `fetch`, `NODE_USE_ENV_PROXY=1` | **200** | Also 200 in a minimal env (`PATH HOME HTTPS_PROXY NO_PROXY` only, no `NODE_EXTRA_CA_CERTS`), consistent with the real cert above |
| Node 22 `fetch`, `NODE_USE_ENV_PROXY` unset | 200, **but not through `HTTPS_PROXY`** | Node ignores the proxy and connects directly to the Cloudflare IP; the sandbox's transparent egress gateway intercepts it (peer cert issuer "Anthropic / Egress Gateway SDS Issuing CA", trusted via the sandbox's `NODE_EXTRA_CA_CERTS`). Works today but is not the documented path — always set `NODE_USE_ENV_PROXY=1` |
| Playwright Chromium (`chromium.launch()`, no proxy option) | **200** for navigation and for an in-page `fetch("/in-page-fetch")` | TLS issuer seen by the browser: "CCR agent-proxy interception CA (production) 2026-08" (trusted by the browser NSS store the sandbox pre-configures) |
| Playwright Chromium (`proxy: { server: HTTPS_PROXY }`) | **200**, same | Either launch works; no launch option is needed |

**Account `workers.dev` subdomain:** registered (`GET /accounts/{id}/workers/subdomain` → `success: true`, `result.subdomain: "<subdomain>"`). `setup-account` will find it present and only record it. `wrangler deploy` with `workers_dev: true` printed the URL `https://spikemkmteluy-a02-worker.<subdomain>.workers.dev`, matching cloudflare.md §2's `<worker>.<account subdomain>.workers.dev`.

**Why the prompt's made-up name was refused (control):**
- Made-up Worker name on the **real** account subdomain: CONNECT 200, HTTP **404** from Cloudflare (reachable; no such Worker).
- Made-up **account subdomain** (`spikemkmteluy-a02-worker.spikemkmteluy-nosuchsub.workers.dev`): `curl: (56) CONNECT tunnel failed, response 502`; proxy status `recentRelayFailures: [{"kind":"connect_rejected","detail":"gateway answered 502 to CONNECT (policy denial or upstream failure)","host":"spikemkmteluy-a02-worker.spikemkmteluy-nosuchsub.workers.dev:443"}]`. That name does not resolve in DNS (`ENOTFOUND`), so the 502 is the upstream (DNS) failure, not a policy block on `workers.dev`. Recorded here as the exact host and response; it is not a host the framework uses.

## Exact commands

From `ai/implementation/spikes/a-02/` (archived: branch `archive/implement-local-cloudflare`, see ARCHIVE-INDEX.md) after `npm install` (package.json pins wrangler 4.149.0 and @playwright/test 1.64.1):

```
# account subdomain (proxy injects the token; no Authorization header sent)
curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain"

# deploy (worker/wrangler.jsonc: name spikemkmteluy-a02-worker, workers_dev: true, preview_urls: false)
CI=1 CLOUDFLARE_API_TOKEN=proxy-injected NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  ./node_modules/.bin/wrangler deploy -c worker/wrangler.jsonc

U=https://spikemkmteluy-a02-worker.<subdomain>.workers.dev
curl -sS -v --max-time 30 "$U/hello"                 # x3
node node-cases.mjs "$U/node"                        # runs fetch.mjs under env cases A–D
node peer.mjs "$U/peer"                              # node:https without proxy: TCP peer + issuer
node browser.mjs "$U/browser"                        # Playwright Chromium, with/without proxy option
curl -sS -o /dev/null -w "http=%{http_code} connect=%{http_connect}\n" <made-up URLs>   # control
curl -sS "$HTTPS_PROXY/__agentproxy/status"          # recentRelayFailures

CI=1 CLOUDFLARE_API_TOKEN=proxy-injected NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  ./node_modules/.bin/wrangler delete -c worker/wrangler.jsonc --force
curl -sS "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts"
```

## Raw output excerpts (redacted; full logs in `logs/`)

`logs/w01-deploy.txt`
```
Uploaded spikemkmteluy-a02-worker (1.16 sec)
Deployed spikemkmteluy-a02-worker triggers (0.73 sec)
  https://spikemkmteluy-a02-worker.<subdomain>.workers.dev
exit=0
```
`logs/c02-curl.txt` (first of three)
```
* Establish HTTP proxy tunnel to spikemkmteluy-a02-worker.<subdomain>.workers.dev:443
< HTTP/1.1 200 Connection Established
< HTTP/2 200
< server: cloudflare
spike a-02 ok /hello
```
TLS (curl -v): `subject: CN=<subdomain>.workers.dev`, `issuer: C=US; O=Let's Encrypt; CN=YE2`, `SSL certificate verify ok.` (for comparison `api.cloudflare.com` shows `issuer: CN=CCR agent-proxy interception CA (production) 2026-08`).

`logs/n01-node-fetch.txt`
```
## A: sandbox env + NODE_USE_ENV_PROXY=1
status=200 content-type=text/plain ms=639
body=spike a-02 ok /node
## B: sandbox env, NODE_USE_ENV_PROXY unset
status=200 content-type=text/plain ms=452
## C: minimal env (PATH HOME HTTPS_PROXY NO_PROXY) + NODE_USE_ENV_PROXY=1, no NODE_EXTRA_CA_CERTS
status=200 content-type=text/plain ms=555
## D: as C + NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
status=200 content-type=text/plain ms=467
```
`logs/n02-node-direct-peer.txt`
```
dns: [{"address":"104.21.39.162","family":4},{"address":"172.67.146.189","family":4}]
peer=104.21.39.162:443 status=200 issuer=Anthropic/Egress Gateway SDS Issuing CA (production)
```
`logs/p01-playwright.txt`
```
## no proxy launch option
goto status=200 ms=435 body=spike a-02 ok /browser
tls issuer=CCR agent-proxy interception CA (production) 2026-08 protocol=TLS 1.3
in-page fetch: 200 spike a-02 ok /in-page-fetch
## proxy launch option = HTTPS_PROXY
goto status=200 ms=194 body=spike a-02 ok /browser
in-page fetch: 200 spike a-02 ok /in-page-fetch
```
`logs/c03-control.txt` — as quoted in the verdict. `logs/w02-delete.txt`: `Successfully deleted spikemkmteluy-a02-worker`. `logs/c04-leftovers.txt`: `spikemkmteluy scripts: []`; the URL afterwards: `http=404 connect=200`.

## Observations for later items
- No propagation delay was observed: the first request, ~1 s after `wrangler deploy` returned, got 200. (A-04 measures on/off propagation.)
- The proxy treats `*.workers.dev` hosts differently from `api.cloudflare.com` (curl saw a tunnelled real cert; Chromium saw the interception CA). Both are trusted with the sandbox defaults; clients must keep the default CA setup (never disable verification).
- Cloud test runners using Node `fetch` set `NODE_USE_ENV_PROXY=1`; Playwright needs no proxy option.

## Leftover cloud resources
None. Workers scripts with prefix `spikemkmteluy`: `[]`. Nothing else was created. The account `workers.dev` subdomain already existed and was not changed.
Local only (not committed): `node_modules/`, `~/.config/.wrangler/logs`.

## Fallback
None needed (plan fallback: report the refused host to the owner). The only refused host, a made-up account subdomain that does not resolve, is recorded above for information.
