# Pass 3 — local + Cloudflare (2026-10-25)

Code: `claude/better-auth` at 2855407 (the driver ran at b592051, the same code plus the local record). The logs are in `logs/` and have been redacted; a scan of all 53 files found no secrets, account IDs, zone IDs or subdomain.

## Local
**121 passed, 1 failed.** Command: `npm run compliance -- --target local`, 19:21–19:56Z. Record: `validation/local/htth52fbl34gzk7.json`.
- **Failed, CORE-AC-001:** "TestCapability (used by TestApp / TestAppOptions)". `TestCapability` is in the contract and in `src/testing/public.ts`, but the `./testing` entry `src/testing/index.ts` does not re-export it. It came in with b331836.
  - To reproduce: `npx vitest run --config vitest.integration.config.ts packages/framework/test/integration/core/types.test.ts`.

## Account setup
Logs: `logs/0-setup.log`, `logs/0-setup2.log`.
- `setup-account --target cloudflare` succeeded under the environment token (27 requests). It created:
  - the bucket `prototype-backups`;
  - its lifecycle rule `framework-backups-retention` (PAR-311);
  - the token `prototype-r2-signing`;
  - the record `framework/r2-signing.json`.
- The email domain was unchanged.
- A second run changed nothing (19 requests).

## Automated Cloudflare pass (`wkj70sooa7z9xav`, stopped early)
Command: `NODE_USE_ENV_PROXY=1 COMPLIANCE_CLOUDFLARE_D1=available npm run compliance -- --target cloudflare`, started 19:58:59Z, run under `logs/tooling/guard.sh`. The guard stops the run on any 429, on more than 1,900 requests, or on more than 950 requests in 5 minutes.

It stopped at 20:31Z on a 429 and wrote no record. **47 criteria passed and 2 failed.** The Playwright layer, check-login and cleanup did not run.

- **Passed:**
  - AUTH-AC-004, 005, 006, 007, 009, 014
  - CF-AC-001, 002
  - CFG-AC-003, 004
  - CLI-AC-005, 007
  - COMPL-AC-001, 003, 005
  - CORE-AC-002, 003
  - E2E-006, 007
  - FILES-AC-001, 002, 004, 005
  - HTTP-AC-001, 002, 003, 005
  - KV-AC-001 to 005
  - LOG-AC-001, 002, 004, 005
  - MAIL-AC-006
  - MIG-AC-002, 003, 006
  - PROV-AC-001
  - PWD-AC-008
  - SEC-AC-001, 002
  - SQL-AC-003, 004, 006
- **Failed, COMPL-AC-004 (first test):** `criteria/prov/test-stages.test.ts:101-107` requires every committed Cloudflare record without `--base-url` to have a `test-` stage. The committed check-login record `g8np1sdqoq1yvgz.json` has stage `prodcheck`.
- **Failed, PROV-AC-002 (everyday-token deploy):**
  - The deploy got 401 on `tokens/verify` and on 4 preflight reads, then 7×429.
  - Cause: COMPL-AC-004's nested driver (`test-stages.test.ts:61-80`) ran its start sweep (`driver.ts:345-348`) at 20:26:57Z. The sweep deleted the outer run's self-created token, so the outer run's restricted deploy used a token that no longer existed.
  - The 429s look like throttling of requests with an invalid token: our rate was at most 248 requests in 5 minutes.
  - So whether the everyday token set (DEC-0551) is enough for a deploy is still unknown.
- **Production checks:** `prodcheck` was redeployed on `cloud-app-asdf` with the new signing credential, and its production checks passed.

## Live checks
- **Signing token denied on `prototype-backups`: verified.** S3 list and PUT on it got 403 AccessDenied. `prototype-logs` also got 403, and the stage bucket answered 200. Log: `logs/s3-6-deny.log`.
- **Inline images (DEC-0535): not run.**
- **Demo stage and DEMO criteria: not run.**

## Usage
- **API requests:** about 1,297 counted, at most 248 in any 5 minutes, 7×429. Pulumi provider calls were not counted.
- **D1 (day totals):** rows written 3,600 → 4,995, rows read 10,072 → 14,539; at most 2 databases at once.

## Left behind
- The run stage `test-wkj70sooa7z9xav`: its Worker, D1 database, files bucket and `sst-state` objects. To be removed before the next pass.
- Seven `compliance-r2read-*` tokens, which expire by 20:58Z.
- The old token `reference-prodcheck-files-signing`, unused since prodcheck's redeploy. It is kept for now because its stage still exists.
