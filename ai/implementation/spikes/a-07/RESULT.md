# A-07 — SigV4-signed R2 S3-endpoint URLs for direct browser transfers; bucket CORS; bucket-scoped R2 token

Date: 2026-10-19. Node v22.22.0; aws4fetch 1.0.20 (PAR-105); Playwright 1.64.1 (PAR-114) with Chrome Headless Shell 156.0.8078.4 from `/opt/pw-browsers`.
Cloud resources: R2 buckets `spikecldsqqqq-a07-main`, `spikecldsqqqq-a07-other`; account API token `spikecldsqqqq-a07-r2token`. (Prefix `spike` + 8 random letters; the generator padded with `q`.) All removed — see "Leftovers".

## Question

Do SigV4 query-signed URLs for R2's S3 endpoint (`<account>.r2.cloudflarestorage.com`), created with aws4fetch, work for a direct browser `PUT` (with a required `Content-Type`) and `GET`, with a bucket CORS policy limited to one origin? Is an unrelated origin refused by the browser? Can an R2 API token be created through `api.cloudflare.com` (proxy-injected token), scoped to one bucket?

## Verdict

**Yes — assumption holds**, with two design-relevant findings:

1. **aws4fetch does not sign `Content-Type` by default** (it is in aws4fetch's `UNSIGNABLE_HEADERS`). With default signing, a ticket for `image/png` accepted a `text/html` upload (N8: 200). With `allHeaders: true`, `X-Amz-SignedHeaders=content-type;host` and a different type is refused, `403 SignatureDoesNotMatch` (N2). The FILES adapter **must** sign upload tickets with `{ aws: { signQuery: true, allHeaders: true } }`.
2. **R2 sends no CORS headers on authentication failures** (`403 SignatureDoesNotMatch`, `403 ExpiredRequest`), even for the allowed origin, while it does on success (200) and on `404 NoSuchKey`. A browser therefore sees status 0 / "Failed to fetch" for an expired or mismatching ticket, not storage's 403. This conflicts with FILES-REQ-006 / FILES-AC-003 ("an expired ticket fails with `FILES.TRANSFER_FAILED`, storage's status, and a `rejected by storage (HTTP n)` message") on Cloudflare. Raised as an owner question (decision draft A-07-4); no fallback is named in the design.

| Check | Result | Evidence |
| --- | --- | --- |
| Signed PUT (Node) with ticket Content-Type | 200 | N1 |
| Same ticket, different Content-Type (`allHeaders: true`) | 403 SignatureDoesNotMatch | N2 |
| Ticket for `a.png` used for `b.png` | 403 SignatureDoesNotMatch | N3 |
| Ticket reused before expiry | 200 | N4 |
| Signed GET | 200 | N5 |
| Unsigned GET / PUT | 400 InvalidArgument (refused) | N6, N7 |
| Default aws4fetch signing, different Content-Type | **200 (type not bound)** | N8 |
| Expired ticket (`X-Amz-Expires=1`, used after 3 s) | 403 ExpiredRequest | N9 |
| Token scoped to main: PUT / GET on other bucket, ListBuckets | 403 AccessDenied ×3 | N10–N12 |
| Preflight from allowed origin | 204, `Access-Control-Allow-Origin: http://127.0.0.1:8701` (logged "FAIL" only because the check expected 200; 204 is a successful preflight) | N13 |
| Preflight from unrelated origin | 403 Unauthorized, no ACAO | N14 |
| **Browser**, allowed origin: XHR PUT 20 MiB with upload progress | 200, 3 progress events, 20971520 bytes | B1 |
| **Browser**, allowed origin: fetch GET | 200, 20971520 bytes, byte-exact, `content-type: image/png` | B2 |
| **Browser**, allowed origin: same ticket with `text/html` (20 MiB) | refused; XHR error status 0 (`ERR_CONNECTION_RESET` mid-body / no ACAO on the 403) | B3, errors.mjs |
| **Browser**, unrelated origin `http://127.0.0.1:8702`: XHR PUT, fetch GET | blocked by CORS ("No 'Access-Control-Allow-Origin' header is present") | B4, B5 |
| Object from the unrelated-origin PUT | absent (404) — the preflight failed so the PUT was never sent | B6 |
| `<img src>` with a signed GET URL | request made from both origins (no CORS needed for `<img>`); `onerror` only because the test bytes are not a PNG | B-img |
| Browser, allowed origin, small bodies: wrong type / expired PUT / expired GET | status 0 / "Failed to fetch" (no ACAO on 403) | 03-errors |
| Browser, allowed origin: GET missing object | 404 readable (ACAO present) | 03-errors |
| Node with `Origin: <allowed>`: 403 responses | `ACAO: null`; 200 response: ACAO + `Vary: Origin` | 03-errors |

"Refused by the browser" for an unrelated origin holds for script transfers (`fetch`/XHR, i.e. `uploadFile` and any script read). A download URL placed in `<img src>` or a link is a plain navigation/resource load, which CORS does not govern; it is protected only by being a short-lived signed URL (FILES design already says so).

## How it works (exact details)

**R2 token creation** (through `api.cloudflare.com`, proxy-injected token, no Authorization header sent by us; Node `fetch` with `NODE_USE_ENV_PROXY=1`, `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`):
```
GET  /client/v4/accounts/$ACCOUNT/tokens/permission_groups
     → "Workers R2 Storage Bucket Item Write" (id 2efd5506f9c8494dacb1fa10a3e7d5b6, scope com.cloudflare.edge.r2.bucket)
     ("Workers R2 Storage Bucket Item Read" 6a018a9f2fc74eb6b293b0c548f38b39 also exists)
POST /client/v4/accounts/$ACCOUNT/tokens
     { "name": "<name>",
       "policies": [{ "effect": "allow",
                      "permission_groups": [{ "id": "<Item Write id>" }],
                      "resources": { "com.cloudflare.edge.r2.bucket.<ACCOUNT>_default_<bucket>": "*" } }] }
     → 200, result { id, name, status: "active", policies, value }
DELETE /client/v4/accounts/$ACCOUNT/tokens/<id>  → 200
```
S3 credentials derived from the response: **access key ID = `result.id`**, **secret access key = lowercase hex SHA-256 of `result.value`** (worked: N1). `value` is returned only once. Item Write also permits GET (N5). The token works immediately after creation (no propagation wait was needed). The proxy-injected token has the permission to create account tokens.

**Bucket CORS** (`api.cloudflare.com`):
```
PUT /client/v4/accounts/$ACCOUNT/r2/buckets/<bucket>/cors
    { "rules": [{ "allowed": { "origins": ["<public origin>"], "methods": ["PUT","GET"], "headers": ["Content-Type"] },
                  "exposeHeaders": ["ETag"], "maxAgeSeconds": 60 }] }
GET same path returns the rules unchanged. Effective immediately (tests ran seconds later).
```
(`exposeHeaders: ["ETag"]` is not needed by FILES; `maxAgeSeconds: 60` was the only value tried.)

**Signing** (aws4fetch 1.0.20):
```js
const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
const u = new URL(`https://${ACCOUNT}.r2.cloudflarestorage.com/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`);
u.searchParams.set('X-Amz-Expires', String(ttlSeconds));               // default would be 86400
const put = await aws.sign(new Request(u, { method: 'PUT', headers: { 'Content-Type': ct } }),
                           { aws: { signQuery: true, allHeaders: true } });   // SignedHeaders=content-type;host
const get = await aws.sign(new Request(u, { method: 'GET' }), { aws: { signQuery: true } }); // SignedHeaders=host
```
Path-style URLs; keys with spaces, `%`, `/` and non-ASCII (`tickets/ä ö %/photo 1.png`) worked (B1/B2). The URL carries `X-Amz-Credential` (access key ID) and the signature, never the secret.

## Commands

```
npm install --prefix ai/implementation/spikes/a-07           # aws4fetch 1.0.20, playwright 1.64.1
export A07_STATE_DIR=<scratch dir outside the repo>          # holds R2 credentials, mode 600, deleted by teardown
ENV="PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt"
env $ENV node setup.mjs     # logs/01-setup.txt
env $ENV node test.mjs      # logs/02-test.txt
env $ENV node errors.mjs    # logs/03-errors.txt
env $ENV node teardown.mjs  # logs/04-teardown.txt
```
Chromium is launched with `proxy: { server: $HTTPS_PROXY, bypass: '127.0.0.1,localhost' }`; TLS verification stayed on (the proxy CA is in the browser trust store). Pages are served by a Node HTTP server on `127.0.0.1:8701` (allowed origin) and `127.0.0.1:8702` (unrelated origin). All printed output passes through `redact()` in `lib.mjs` (account ID, 32/64-hex strings, signature/credential query values, the R2 key pair); signed URLs are never printed.

## Proxy

No host was refused. `<account>.r2.cloudflarestorage.com` was reachable from Node and Chromium. `recentRelayFailures` after the spike lists only a `*.workers.dev` CONNECT from the concurrent A-02 spike, nothing from A-07. The B3 `ERR_CONNECTION_RESET` does not appear there, i.e. it was not the proxy cutting the tunnel; R2 refused the 20 MiB body early.

## Leftovers

None. Teardown deleted all objects, both buckets and the token, then listed buckets and tokens: none with prefix `spikecldsqqqq` (logs/04-teardown.txt). The local credential/state file was deleted. Local only (untracked): `node_modules/`.

## Fallback

None applied: the assumption holds. The design names no fallback for this spike ("ask owner"); the CORS-on-403 finding is raised to the owner (decision draft DEC-PENDING-A-07-4).
