# Phase G offline run, 2026-10-24, at 876686a

Written by the orchestrator from the runner's report (subagents may not write report files). The evidence commit is 7d2a0f6. Logs are in `logs/`, and records are in `compliance-local/` and `aws-dry-run/`. No AWS credentials, region or profile were set for any step.

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `npm run verify`, online, with `PROTOTYPE_SST_PLATFORM` set to the cached SST 4.17.2 platform (DEC-0484) | 0 | Unit 2294/2294 with 0 skipped, so the SST program type-check counted. Template 18/18; reference 52/52 on SQLite and on Postgres; example pages 2/2. |
| 2 | `unshare -rn sh scripts/offline.sh npm run verify` | 0 | Same counts as step 1. |
| 3 | `npm run test:integration`, bare | 1 | 43 failed, 686 passed, 18 skipped. Playwright never ran. See the next section. |
| 4 | `npm run compliance -- --target local` (after a framework build and dummy local secrets, as in final-local-5) | 0 | Record `sbehf9uwld4ctwv`: 109 passed, 0 not-run, 0 failed, 0 blocked; Playwright 42/42. The AWS-bundle clause of CORE-AC-006 and the Data API retry-loop clause of SQL-AC-006 now run and pass locally. |
| 5 | `compliance --target aws --only AWS-AC-002`, a dry run under `unshare -rn` with fake operations (DEC-0499 hooks) | 1, as expected | Record `rx3n81izmc4esca`: 73 not-run, 1 failed, leftovers []. The single failure is `listing Lambda functions failed: PrerequisiteMissingError` (no region set). The wiring was traced end to end: deploy, secret, redeploy, tests, remove, leftover check, usage log (0 of 2,000 calls). |
| 6 | Host scan | — | **Zero AWS hosts were contacted.** |

## Step 3 failures
None of the 43 failures involves an AWS adapter defect.
- **1, expected:** the aws-precheck FILES case "…`..`… round-trip" fails with `FILES.INVALID_NAME`. This is the open conflict between DEC-0464 and FILES-AC-002, an owner question in plan-aws.md §5.1. The test is left failing and not weakened.
- **42, from running criteria tests outside the compliance driver:** a bare `test:integration` picks up `tests/compliance/criteria/**`.
  - 38 fail with `COMPLIANCE_BASE_URL is not set`.
  - SEC-AC-001, SEC-AC-002 and HTTP-AC-002 fail because `apiKey` has no value in `.dev.vars`.
  - LOG-AC-004 fails twice, on its in-request and outside-request clauses: no hooks exist for target local.
  - MIG-AC-006 fails with "writes acknowledged … expected 0 > 0".
  
  All of these pass inside the driver (step 4). No earlier batch recorded a bare `test:integration`, so it is not known whether this predates phase G. This is for G-EV to judge.

## Host scan (step 6)
- **Method:** a host-trace preload on every Node process (DNS, connects, http(s) and fetch). Steps 2 and 5 also ran with no network at all. A grep for `amazonaws.com` across all evidence finds only network-guard test titles.
- **Non-AWS hosts seen:**
  - workers.cloudflare.com (steps 1, 3 and 4);
  - registry.npmjs.org;
  - api.cloudflare.com: **1 request during the local compliance run (step 4)**, a point for G-EV;
  - 192.0.2.2, a reserved test address.
- **Not traced:** the workerd and Chromium processes.
- **Secrets:** a scan found no credential, token or test-secret value in any committed file.
