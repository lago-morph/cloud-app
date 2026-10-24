# G-EV: Phase G exit evaluation (AWS, offline)

Evaluator: an independent G-EV subagent, 2026-10-24. I wrote none of the code, tests or evidence judged here. I worked from committed evidence and from reading code:
- I ran no test suite, made no AWS call and did not run `npm ci`.
- I changed no code, test or evidence. The only files I wrote are this one and the "Readiness verdict" subsection in plan-aws.md §4.

Base: `origin/claude/implement-aws` at `06e805c` ("Phase G offline run summary (orchestrator)"). Branch: `claude/implement-aws-g-ev`.

Inputs:
- plan-aws.md: G-EV, §2 (offline/live table), §4 (readiness checklist), §5 and §5.1;
- `validation/local/phase-G/SUMMARY.md`, its `logs/` and the records `sbehf9uwld4ctwv` (local) and `rx3n81izmc4esca` (AWS dry run), including their raw Vitest JSON, compared test by test;
- decision-log entries DEC-0432…DEC-0502;
- `tests/compliance/harness/expected.ts` and its unit test, `tests/compliance/tools/{records,report}.ts`, `packages/framework/test/integration/aws-precheck/`, `packages/framework/src/provision/aws/environment.ts`, `tests/compliance/criteria/_cloud/aws/api.ts`, `tests/compliance/e2e/E2E-001-E2E-003.spec.ts`;
- the history of `vitest.integration.config.ts` on this branch and on `origin/main`.

## Evidence references

| Ref | What | Commit | Notes |
| --- | --- | --- | --- |
| **GV1** | `logs/01-verify-online.log` | `876686a` | `npm run verify`, online, with `PROTOTYPE_SST_PLATFORM` set (DEC-0484), exit 0. Unit 218 files, 2294/2294, 0 skipped, so the generated SST program's type-check ran. Template 18/18, reference 52/52 per dialect, example pages 2/2. |
| **GV2** | `logs/02-verify-offline.log` | `876686a` | The same under `unshare -rn`, exit 0, same counts. |
| GI | `logs/03-test-integration.log` | `876686a` | Bare `npm run test:integration`, exit 1: 43 failed, 686 passed, 18 skipped. Judged in §4 below. |
| **GL** | `validation/local/phase-G/compliance-local/validation/local/sbehf9uwld4ctwv.json` (+ `raw/`) | `876686a` | **Full, unfiltered** `compliance --target local`, exit 0: 109 passed, 0 not-run, 0 failed, 0 blocked. Playwright 42/42. Integration layer 747 tests: 581 passed, 0 failed, the rest skipped by selection. |
| GD | `validation/local/phase-G/aws-dry-run/validation/aws/rx3n81izmc4esca.json` (+ `raw/`) | `876686a` | Wiring dry run of `compliance --target aws --only AWS-AC-002`, under `unshare -rn`, with fake CLI and operations and **with the `*`/aws not-run rule removed** (DEC-0498). Exit 1 as expected: 68 not-run (`--only`), 5 not-run (Google), 1 failed (no region). Leftovers []. 0 of 2,000 hook calls. Wiring proof only, never evidence. |
| GH | `logs/host-scan.txt`, `logs/hosts-*.log` | `876686a` | Host trace of every Node process. AWS hosts: 0. |

Between `876686a` and the base, only `validation/` changed (`7d2a0f6`, `24c181c`, `06e805c`). So the evidence holds for the base tree.

## 1. Verdict

**Phase G passes with findings.** No finding blocks the exit.

- Every Local criterion that plan-aws.md assigns to phase G passed, with its AWS clause shown by a named test that ran (§2).
- Every AWS criterion is, by the harness rule, `not-run` with "AWS live run pending (no account)", in both tiers (§3).
- No pre-check counts as evidence anywhere (§3).
- `verify` passed online and offline at the evidence commit, and the host scan found zero AWS hosts.
- Findings: F1 (bare `test:integration`, pre-existing), F2 (the FILES `..` conflict, owner), F3 (record placement), F4 (`AWS_REGION` for the hooks), F5 (proxy allowlist host for the CloudFront KeyValueStore). I1 is informational (the api.cloudflare.com probe).
- Live readiness (§7): the code side is ready, apart from F4 and F5. Everything else is an owner action.

## 2. Local criteria assigned to phase G

All rows are from GL at `876686a`. Each test named passed in `raw/vitest.json` (integration layer) or `raw/vitest-unit.json` (unit layer).

| Criterion | Result | AWS clause shown by |
| --- | --- | --- |
| CORE-AC-005 | passed | `test/integration/cli/verify.test.ts`: "the package's exports map equals the subpath table, ./targets/aws included" and "a fixture importing ./targets/aws from app code fails verify". |
| CORE-AC-006 | passed | `test/integration/build/aws-bundles.test.ts`: "AWS bundle part" for stages `test-g06t1`, `prod`, `prodcheck` and `mytest-1`. This matches the CLAUSE_RULES pattern `\bAWS[- ]bundle\b` (DEC-0499), so the clause ran and was not stood in for by the Cloudflare tests. |
| SQL-AC-006 | passed | `tests/compliance/criteria/sql/data-api-retry.test.ts`: "Data API retry-loop clause" at three jitter levels (short, mid-range, longest), each giving up at PAR-210 with `SQL.UNAVAILABLE` on an injected clock and error source. |
| PROV-AC-005 (aws) | passed | `aws-bundles.test.ts`: `test-g06t1` builds with the mock from `config/aws/test.json`; `prod`, `prodcheck` and `mytest-1` build without the mock or the mock-login route. |
| PROV-AC-007 | passed | `src/provision/aws/account.unit.test.ts` (unit layer, executed): with `HeadBucket` stubbed to 403 for the expected owner, setup-account and deploy stop and name the bucket. |

The two DEC-0397 not-run clause entries that F-EV3's R4 carried are gone: GL has 0 not-run, against R4's 2. The unit-layer copies of the CORE-AC-006 and PROV-AC-005 tests are skipped in GL by design (DEC-0319). They passed in GV1, which ran all 2294 unit tests with 0 skipped.

## 3. AWS criteria and pre-checks

**AWS criteria are not-run with the new detail.**
- `PHASE_RULES` starts with `{ id: "*", targets: ["aws"], mode: "any", detail: AWS_LIVE_PENDING }`, and `AWS_LIVE_PENDING` is "AWS live run pending (no account)" (DEC-0498).
- `expectedCriteria` takes the first whole-criterion rule that matches. The `*` rule is first, so on aws it also wins over the Google rules.
- `expected.unit.test.ts`, "records every AWS criterion as not-run 'AWS live run pending (no account)'", checks this against the real catalogue in both tiers (more than 50 IDs, AWS-AC-001 included). `driver.unit.test.ts:181` checks the same in a driver record. Both passed in GV1.
- No AWS record exists at `validation/aws/` (the directory is absent). The only AWS-target record, GD, lives under `validation/local/phase-G/` and is a dry run (see F3).

**No pre-check counts as evidence.**
- The three suites in `packages/framework/test/integration/aws-precheck/` (`sql.data-api`, `kv.data-api`, `files.s3`) have titles that say "pre-check, not evidence" and carry no criterion tag: 0 of their 31 titles in GL match `TAG_PATTERN`. `support.ts` states this and installs the AWS network guard.
- In GL all 31 are `skipped` by the driver's tag selection, so they contributed nothing to any result.
- The traceability and release generators (`tests/compliance/tools/report.ts`) list tests by tag. An untagged test cannot appear against a criterion. The generators read records only from `validation/<target>/*.json` (`records.ts`), so neither GD nor any pre-check output is read.
- DEC-0445 binds the evaluator, and I count no AWS criterion as passed.

## 4. Step-3 failures (bare `npm run test:integration`)

**F1: a bare `test:integration` runs the compliance criteria outside the driver.** Label: **agent (harness; a C-02-style fix item)**. Severity: low. Not a phase G regression. Not fixed here.
- **Is it a defect? Yes, a minor one.** plan.md:617 says `test:integration` runs `tests/compliance/criteria/**` "against `--target` (default `local`)". In fact the criteria need what the driver provides: `COMPLIANCE_BASE_URL` (`harness/env.ts` throws "run the tests through `npm run compliance -- --target <t>`"), the test secret, and the cloud hooks. So a documented layer script cannot pass on its own. That is a contract gap, not a product defect: all 42 tests pass inside the driver (GL). Remedies, for the fix item to choose:
  - exclude `tests/compliance/criteria/**` from `vitest.integration.config.ts` and leave them to the driver;
  - or have the criteria skip with a note when `COMPLIANCE_TARGET` is unset;
  - or correct plan.md:617 to say the script needs the driver.
- **Did it predate phase G? Yes.**
  - The include is in the first version of the file, B-01's workspace bootstrap `9e6d808` (2026-10-19), and is recorded in DEC-0116.
  - The only later change, `dbab708` (E-T1, 2026-10-20), added `tests/skill/**`.
  - `origin/main`'s config has the same include.
  - The driver-only guard in `env.ts` dates from C-02.
  - So every bare run since phase C would have failed the same way. No earlier batch recorded a bare run.
- The 43rd failure is F2.

**F2: the aws-precheck FILES round trip of `..` fails with `FILES.INVALID_NAME`.** Label: **owner (plan-aws.md §5.1 Q1)**. This is the DEC-0464 / FILES-AC-002 conflict, already raised. The test is correctly left failing. It is a pre-check, so it is not evidence either way, but the choice must be made before L-RUN, or FILES-AC-002 will fail live on AWS.

## 5. The api.cloudflare.com request (I1)

**What made it:** E2E-001's deliberate negative probe (`tests/compliance/e2e/E2E-001-E2E-003.spec.ts:90`).
- The test runs `node -e "fetch('https://api.cloudflare.com/client/v4/')…"` inside `unshare -rn sh scripts/offline.sh`.
- It expects the fetch to fail, which is exit 0. A reachable provider would give exit 3 and fail the test.
- The trace matches this exactly. `hosts-04c-compliance-local.log:6085-6088` shows pid 27922, with empty script arguments (an `-e` process). It starts right after the scaffolded app's `npm install` postinstall scripts (pids 27870–27900, in `/tmp/e2e-scaffold-…`). Next comes `.e2e-001/imports.mjs`, the test's next step.
- The trace shows `undici-request`, `connect` and `dns` lines, but no `undici-connected` line. The host trace preload follows `NODE_OPTIONS` into the namespace, so it recorded the attempt.

**Judgement: not a problem.**
- No packet left the machine (no network in the namespace).
- No credentials were present: `noCredentials` strips `CLOUDFLARE_*`/`AWS_*`.
- The attempt is the test's proof of offline isolation, and it passed.
- Suggestion: future host scans should report connected hosts separately from attempted ones, so a probe like this does not read as contact.

## 6. Other findings

**F3: phase G's records are nested under `validation/local/phase-G/`, so the reports cannot see them.** Label: **agent (G-RUN / orchestrator convention)**. Severity: low.
- Earlier runs put the record at `validation/local/<runId>.json` and only the logs in a subdirectory (F-EV3's R4, `pzeugkxrk1xcu2w`). `records.ts` reads only `validation/<target>/*.json`. So GL does not appear in the traceability or release reports.
- For GD the nesting is in fact what keeps it out. That should not depend on placement: GD is an `aws`-target record with the `*`/aws rule removed, and nothing inside it marks it as a dry run. Its `command` field reads like a real run.
- Recommended:
  - copy GL to `validation/local/sbehf9uwld4ctwv.json` (+ `raw/`) if the release report should count it;
  - never move GD under `validation/aws/`;
  - consider having the driver write a `dryRun` marker when `notRunRules` is overridden.

**F4: the AWS test hooks need `AWS_REGION`, which nothing sets.** Label: **agent (fix before or at L-0)**. Owner workaround: export `AWS_REGION`.
- `tests/compliance/criteria/_cloud/aws/api.ts:11` says the region comes from `AWS_REGION` or `AWS_DEFAULT_REGION`, "which the driver sets for an AWS run".
- The driver does not: `driver.ts` passes `process.env` through `childEnv`, and nothing in `tests/compliance/harness/` sets `AWS_REGION`. Only the framework's SST child environment sets it (`environment.ts:123`).
- That is exactly GD's one failure: "listing Lambda functions failed: PrerequisiteMissingError".
- Live, every hook-based criterion would be `blocked` unless `AWS_REGION` is in the environment. Fix: the driver sets it from the account's recorded region (the log bucket's, DEC-0476), or the owner checklist requires it (it is in §8 below).

**F5: the proxy allowlist in §4 misses the CloudFront KeyValueStore data-plane host.** Label: **owner (allowlist), agent (confirm at L-0)**.
- `sst.aws.Router` stores its routes in a CloudFront KeyValueStore (`router.ts:1344`). It writes the keys through SST's Go RPC provider `Aws.KvKeys` (`providers/kv-keys.ts`).
- The KeyValueStore data API is signed with SigV4A at `<account-id>.cloudfront-kvs.global.api.aws`, not under `*.us-east-1.amazonaws.com` as §4 assumes. That host pattern is from my knowledge of AWS's endpoint rules, so L-0 should confirm it.
- Add `*.cloudfront-kvs.global.api.aws` to the allowlist, or every deploy's step 3 can fail at the router.

## 7. §4 readiness checklist, item by item

| §4 item | Mark | Reason / action |
| --- | --- | --- |
| Temporary account, non-root IAM principal with AdministratorAccess | **owner-action** | Create it. AdministratorAccess is recommended. The least-privilege list in §4 also lacks `iam:CreateServiceLinkedRole` (RDS's service-linked role in a new account), `cloudfront-keyvaluestore:*` and `ssm` on `/sst/*` (SST's bootstrap parameter, DEC-0478). |
| Credentials as environment variables, ≥ 12 h or refreshed, never printed | **owner-action**; code **ready** | The preflight (`environment.ts` `missingCredentials`/`checkCredentials`) names `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` when missing. It also accepts `AWS_PROFILE`, `AWS_WEB_IDENTITY_TOKEN_FILE` or `AWS_CONTAINER_CREDENTIALS_{FULL,RELATIVE}_URI` instead. Then it calls STS `GetCallerIdentity` and prints only error names. |
| `AWS_REGION` for the compliance hooks | **not-ready** (F4) | The owner sets `AWS_REGION=us-east-1` until the driver sets it. |
| Proxy allowlist | **owner-action**; list **not-ready** (F5) | Add `*.cloudfront-kvs.global.api.aws` (see §8). |
| Pulumi AWS plugin (`get.pulumi.com`/GitHub only if the cache is gone) | **owner-action (likely)** | `/root/.config/sst/plugins/resource-aws-v7.20.0` is in this sandbox only. A fresh live sandbox will probably need `get.pulumi.com` and GitHub release downloads. L-0 checks. |
| Regions us-east-1 (PAR-060), us-west-2 for the milestone | **ready** | `DEFAULT_REGION = "us-east-1"`. `setup-account --target aws --region` exists (DEC-0496). A second region needs its own allowlist entries. |
| CloudFront enabled on the new account | **owner-action** | Confirm before L-0 (§5 Q3). If it is blocked, AWS-AC-001/004/006 and every deploy are blocked. |
| Lambda concurrency ≥ 10; VPCs 5 per region; Aurora default | **owner-action** | Check Service Quotas. A new account's Lambda limit can be 10, which is just enough. |
| AWS Budget alarm at $25 | **owner-action** | Create it before L-0. |
| Pass schedule (~12–14 h active, 2–3 day lifetime, ≤ 3 stages) | **ready** (estimate) | PAR-283 enforces at most 3 test-stage clusters, and PAR-282 caps hook calls at 2,000 per run (DEC-0501, to be approved in §5.1 Q7). |
| Cost ($5–15 expected) | **ready** (estimate; prices not checked) | No NAT and no public IPv4 by design. The risk is a forgotten cluster, which the leftover check and the alarm cover. |
| §5 / §5.1 owner questions | **owner-action** | Answer at least §5 Q4–Q5 (named fallbacks, so the live run does not stall) and §5.1 Q1 (F2), Q3 (`kms:Decrypt`) and Q4 (`Origin` forwarding) before L-1. The rest can be answered during L. |
| Code and harness | **ready**, with F4 and F5 | GV1/GV2/GL are green. No `AwsNotImplementedError` path is left in `src/` or the harness. The dry run traced deploy → secret → redeploy → tests → remove → leftover check → usage log. L-INT must remove the `*`/aws rule before L-RUN. |

## 8. What the owner must create and provide for live AWS testing

1. **Account:** one throwaway AWS account (or two: one for L-0…L-RUN and one for L-RUN-M). Use a non-root IAM user or role with **AdministratorAccess**. CloudFront must be usable, so the account must be verified.
2. **Environment variables** (names only; never paste values into chat or commits):
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` for temporary credentials, valid ≥ 12 h or refreshed;
   - `AWS_REGION=us-east-1` (F4);
   - optional: `COMPLIANCE_AWS_MAX_RUN_CALLS` to override the 2,000-call cap.
   - The sandbox already provides `HTTPS_PROXY`/`NO_PROXY` and `NODE_EXTRA_CA_CERTS`, and the CLI derives `SSL_CERT_FILE` from them (DEC-0495).
3. **Regions:** us-east-1 for everything, and us-west-2 for PROV-AC-006 only (one more VPC and log bucket).
4. **Proxy allowlist:**
   - `sts.amazonaws.com`, `iam.amazonaws.com`, `cloudfront.amazonaws.com`, `s3.amazonaws.com`;
   - `*.us-east-1.amazonaws.com` (rds, rds-data, ssm, lambda, secretsmanager, ec2, s3, logs, tagging, sts);
   - `*.s3.us-east-1.amazonaws.com`;
   - `*.lambda-url.us-east-1.on.aws`;
   - `*.cloudfront.net`;
   - **`*.cloudfront-kvs.global.api.aws`** (F5);
   - the us-west-2 equivalents of the regional entries;
   - `get.pulumi.com` and GitHub release downloads, if the Pulumi plugin cache is absent.
   - Reachability is needed from curl, Node, the SST/Pulumi Go binaries and Chromium.
5. **Quotas:** Lambda concurrency ≥ 10, 5 VPCs per region, Aurora at the defaults.
6. **Budget:** an AWS Budget alarm at **$25**. Expected spend is **$5–15** (Aurora ≈ $2–4, the rest cents). The tail risk is about $0.50/h for a forgotten 4-ACU cluster.
7. **Time:** about **12–14 h of active time** (L-0+L-1 ~3 h, L-RUN ~3 h, fixes ~2 h, L-RUN-M ~4 h, L-DEMO ~1 h). Keep the account for 2–3 days.
8. **Decisions:** answer §5 Q4–Q5 and §5.1 Q1, Q3, Q4 and Q7 before L-1.
