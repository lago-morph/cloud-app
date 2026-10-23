# Cloudflare pass 1b — 2026-10-23

Written by the orchestrator from the runner's report (subagents may not write report files). Raw evidence: `logs/` (redacted; grep found no account ID, subdomain, 32-hex string or apiKey value).

## Usage
| Measure | Before | After |
| --- | --- | --- |
| D1 rows written today | 0 | 32 |
| D1 rows read today | 0 | 17 |
| D1 databases | 0 | 1 |

Cloudflare API requests: about 80 counted (≈ 88 estimated); no HTTP 429. Per step: measurement 5; cleanup `remove` 18; sst-state check 1; R's first deploy 20 (framework, fetch-trace preload) + 31 (SST, from `.sst/log/sst.log`); measurement 5. **Per SST run:** 16 (step 3, untargeted) and 15 (step 5) logged; ≈ 18–20 with unlogged lock/app-state writes. Pulumi provider calls are not counted (`TF_LOG=DEBUG` wrote no HTTP lines to `pulumi.log`).

## Steps
1. **Cleanup of the pass-1 stage** `test-ycfmck8n9jis0gb`: `remove` exited 0; deleted the `passphrase/` and `update/` objects; skipped `sst remove` (no `app/` state, fix-pass1). Listing afterwards: no objects of that stage. **Pass.**
2. **First deploy of run stage R** `test-wxezkd4j5ye3oio`: step 3 (untargeted, bucket-only program) created the Files bucket — DEC-0334 check 10 partial pass; SST accepted `sst-state` as its home. Step 5 failed:

   > deploy failed at step 5 (code): sst deploy --stage test-wxezkd4j5ye3oio failed (exit 1): … Error Worker sst:cloudflare:Worker → WorkerScript cloudflare:index:WorkersScript [ERROR] POST "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT>/workers/assets/upload?base64=true": 401 Unauthorized : failed to upload assets

   Not retried. `secrets set`, the second deploy, the driver (40 pass-1 IDs), `--milestone --only PROV-AC-004` and E2E-011's curls were not run; no driver records.
3. **DEC-0356 (SST Worker `assets`):** SST passes the option to the provider, which started the asset upload; the upload failed (above).

## Cause of the 401 (confirmed by the orchestrator, 2 requests)
The sandbox proxy replaces any `Authorization` header sent to `api.cloudflare.com` with its injected token: `GET /accounts/<ACCOUNT>/tokens/verify` returned 200 both with no header and with `Authorization: Bearer not-a-real-token`. Cloudflare's asset upload (`/workers/assets/upload`) must be authorised with the upload-session JWT returned by the upload-session call, so behind this proxy it always gets the account token instead and is refused. Every Worker with static assets fails to deploy from this sandbox; this is an environment limitation, not a framework defect.

## Resources left after the pass
No Workers. D1: `reference-test-wxezkd4j5ye3oio-db-1`. R2: `prototype-logs`, `sst-state` (8 objects of R), `reference-test-wxezkd4j5ye3oio-files` (empty). No R2 tokens created.
