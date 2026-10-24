# AWS phase plan: build everything offline first, then one short live campaign

I read the docs and code and changed nothing. One deviation from your brief: I listed `~/.config/sst` and searched the filesystem for the Pulumi AWS plugin. Both are local reads with no network. They show the plugin is cached (`/root/.config/sst/plugins/resource-aws-v7.20.0`), and the SST AWS component sources are in a worktree (`.claude/worktrees/agent-a600b9490db9ad35d/apps/reference/.framework/provision/cloudflare/.sst/platform/src/components/aws`). So the generated SST program can be type-checked offline (G-S2).

Prefixes: phase **G** is offline (no AWS account). Phase **L** is live (needs the temporary account). `FW` = `packages/framework`. Item format, role separation, test economy, root causes (prompt §8) and decision drafts all follow `ai/implementation/plan.md` §1 and §10, and `ai/prompts/implement-local-cloudflare.md` §6–§8 (lines 108–151). Branches are named `claude/implement-aws-<item>`.

## 1. Scope (what the docs define as the AWS target)

**Runtime shape.**
- One HTTP Lambda with a Function URL, plus a static site bucket, both behind one CloudFront distribution and one origin (aws.md:36; http.md:65).
- No Lambda is attached to a VPC, so there is no NAT gateway (aws.md:41).
- Function URL requests get the same authentication and authorization as requests through CloudFront (aws.md:57; DEC-0044).
- Timing: PAR-270 (55 s) > PAR-210 (45 s) + PAR-260 (2 s), and PAR-271 (60 s) > PAR-270 (aws.md:62; parameters.md:31, 73, 80–81).
- The entry uses Hono's AWS Lambda adapter. SDK clients are created once per cold start. Runtime S3 calls send `x-amz-expected-bucket-owner` (aws.md:72; core.md:68).
- New code: `FW/src/targets/aws/`, exported as `./targets/aws` (core.md:39). This replaces DEC-0110 (decision-log.md:891).

**Capabilities on AWS:**
- **SQL:** Aurora Serverless v2 PostgreSQL through the RDS Data API (sql.md:157; DEC-0037). Drizzle's `drizzle-orm/aws-data-api/pg` driver is already installed and uses `@aws-sdk/client-rds-data`.
  - "Database resuming" is retried with backoff and jitter until PAR-210, then becomes `SQL.UNAVAILABLE`. The clock and the error source are injected (sql.md:157).
  - Results are capped by PAR-214 (1 MiB) and PAR-215 (256 KiB).
  - The database credentials live in Secrets Manager (DEC-0061).
- **KV:** runs on the SQL adapter and needs no AWS-specific code (kv.md:44).
- **FILES:** S3 for server operations and for tickets, through aws4fetch with the role's session credentials (files.md:98).
- **LOG:** an S3 `PutObject` into `prototype-logs-<account-id>`. Unlike Cloudflare, the response waits up to PAR-260 for pending writes (log.md:53, 55; DEC-0128 deferred this to AWS).
- **SEC:** SSM SecureString at `/<app>/<stage>/secrets/<name>`, read per request (secrets.md:28, 58). The AWS row is missing from `FW/src/config/secret-locations.ts:4-5`.
- **CFG:** the embedded module plus Lambda environment variables (config.md:67).
- **AUTH:** the cloud cookie settings. Two cookies must survive both CloudFront and the Function URL (AWS-AC-006).

**Provisioning** (SST 4.17.2 with `sst.aws.Router`, `StaticSite`, `Function` with a URL, `Aurora` and `Bucket`; raw `@pulumi/aws` 7.20.0 only where SST has no component; aws.md:66–68):
- `setupAccount` creates the log bucket, the shared VPC with no NAT (DEC-0074) and the SST state home. The region is read back from the log bucket's location. It checks the engine before creating anything (aws.md:77; provisioning.md:58).
- `deploy`, `setSecret`, `stopApp`/`startApp` (reserved concurrency 0, then removed), and `create`/`copy`/`dropDatabase` through the Data API (`TEMPLATE template0 LC_COLLATE 'C'`, `TEMPLATE "<old>"`, `WITH (FORCE)`; migrations.md:86–91).
- `remove` empties S3, deletes the SSM path, skips the final snapshot and deletes the credentials secret with no recovery window. `listStageResources` covers the rest (aws.md:78–83; provisioning.md:64–72).
- All of this implements `TargetOperations` (`FW/src/provision/core/operations.ts`; DEC-0267). The core is not changed.

**CLI and build.**
- `--target aws` for build, deploy, remove, secrets set, setup-account (with a region), smoke and certify-auth.
- `Target` currently excludes `aws` (`FW/src/core/identity.ts:16`, `FW/src/cli/args.ts:12`).
- The Lambda bundle must contain no Cloudflare-only modules, no stub provider, no local route or ticket key, and no mock in production (core.md:89).
- New config files: `config/aws/test.json` for the template and reference apps (CFG-REQ-002).

**Criteria with AWS in their Where column.**
- AWS only: AWS-AC-001…006 (aws.md:93–98).
- The AWS run of every "Local, cloud" or "Cloud" criterion: AUTH-AC-004/006/007/009; CLI-AC-001/004/005; COMPL-AC-001/003/004/008; CFG-AC-003/004/005; CORE-AC-002/003; FILES-AC-001…005; HTTP-AC-001…005; KV-AC-001…005; LOG-AC-001 (deny case), LOG-AC-002/004/005; MIG-AC-002/003/006; PROV-AC-001…004, -006 (region part); SEC-AC-001/002/003 (IAM simulation)/005; SQL-AC-003…006; E2E-002/004/005/009/011/013/014; milestone E2E-010/012; DEMO-AC-001…005, -007…010.
- AWS clauses of Local criteria: CORE-AC-005 (`./targets/aws` export); CORE-AC-006 AWS bundle part and SQL-AC-006 retry-loop part (both currently not-run, DEC-0397, `tests/compliance/harness/expected.ts:53-54`); PROV-AC-007 (needs an AWS case).
- Google-dependent criteria stay not-run unless you say otherwise (Q1).

## 2. Offline / live split

"Done offline" means fully verified with no account. "Pre-checked" means the code path is tested against an in-process fake. That is useful, but it is never AWS evidence: sql.md:151 says "Neither proves Data API behavior", so the evaluator must not count it.

| Criterion | Offline | Needs a live account |
| --- | --- | --- |
| CORE-AC-005, CORE-AC-006 (AWS bundle), SQL-AC-006 (retry-loop clause), PROV-AC-007 (AWS foreign log bucket, stubbed `HeadBucket` with expected-owner 403) | **Done offline** (Where = Local). Remove the DEC-0397 rules. | nothing |
| AWS-AC-001 | Generated SST program: `/api*` goes to the Function URL; SPA fallback through a router function, not custom error responses (aws.md:68). Handler fixtures: unknown `/api` returns a JSON 404. | real CloudFront: deep links, 403/404 bodies |
| AWS-AC-002 | Program has no `vpc` on the Function; setup-account creates no NAT or IGW (client-mock) | `DescribeNatGateways`, `GetFunctionConfiguration` |
| AWS-AC-003, SEC-AC-003 (IAM part) | Policy statements built as data with exact ARNs; unit tests prove no wildcard and no log-bucket read | `iam:SimulatePrincipalPolicy` |
| AWS-AC-004 | Fixtures: Host is ignored, origin comes from the environment, protected routes still guarded | direct Function URL requests |
| AWS-AC-005 | Parameter inequality unit test; retry loop on fake timers; timeouts present in the program | slow pause test, bounded by a new PAR |
| AWS-AC-006 | Lambda adapter emits `cookies:[a,b]` for a Function URL v2 event | through CloudFront and the Function URL |
| SQL-AC-003/004/005, KV-AC-001…005, SQL-AC-006 (conflict, too large) | Pre-checked: the shared case sets (C-T2) run through the real Data API adapter against the PGlite-backed Data API fake | real Data API |
| MIG-AC-002/003/006, COMPL-AC-008 | Pre-checked: AWS database ops and the migration check against the fake (multi-database), with the core sequences | real clusters |
| FILES-AC-001/002 | Pre-checked: S3 store against an in-process S3 fake that verifies SigV4 (reuse `FW/src/files/cloudflare/sigv4-reference.test-support.ts`); ticket signing on fixed vectors, including session token and signed content type | real S3 |
| FILES-AC-003/004/005 | Unit only: CORS policy and Block Public Access in the program | browser transfers, CORS, unsigned refusal |
| SEC-AC-001/005, CFG-AC-003…005, LOG-AC-001/002/004/005 | Unit (client-mock): SSM reader mapping (`ParameterNotFound` → `SEC.MISSING`, failure → `SEC.UNAVAILABLE`, nothing cached); environment settings; S3 sink key layout, expected-owner header, ≤ PAR-260 wait on fake timers, deny → request succeeds | deployed stage |
| HTTP-AC-001…005, AUTH-AC-004/006/007/009, CORE-AC-002/003 | Function URL event fixtures through the full assembled app | deployed stage |
| PROV-AC-001…004/006, CLI-AC-001/004/005, COMPL-AC-001/003/004 | AWS `TargetOperations` with client-mock; driver `--target aws` against a fake target | real deploy, remove, setup-account, second region |
| E2E-*, DEMO-AC-* (AWS) | nothing beyond the above | live |

## 3. Work items

Shared rules for every item:
- **Read** always includes `docs/components/aws.md` and the docs named.
- **Checks** follow plan.md §1 "Test economy": related unit tests, typecheck, lint and the item's own integration suite. Full `verify`, online and offline (`unshare -rn sh scripts/offline.sh`), runs only once per merge batch.
- **Network:** the npm registry is allowed. Every G item makes **zero** AWS calls. Any client a test builds gets a mock or a fake endpoint, and a guard test fails if a real `amazonaws.com` request is attempted.

### G-S: offline spikes (throwaway, under `ai/implementation/spikes/g-sN/`, each writing a RESULT.md and a decision draft)

**G-S1 — Pins.**
- Install `@aws-sdk/client-{rds-data,s3,ssm,lambda,sts,rds,secrets-manager,ec2,iam,resource-groups-tagging-api}` at one version. Start from 3.1153.0, the version SST already pulls in for client-lambda (`npm ls`). Also `aws-sdk-client-mock` and `@types/aws-lambda`.
- Confirm SST 4.17.2 accepts `runtime: "nodejs22.x"` and `architecture: "arm64"`.
- Confirm Hono 4.13.13's `hono/aws-lambda` handles Function URL v2 events and multiple cookies.
- Confirm drizzle 0.45.4's aws-data-api/pg driver type-checks behind `portableHandle`.
- Find out how SDK v3 reaches the sandbox proxy: `NODE_USE_ENV_PROXY=1` on Node 22.22 versus an explicit `NodeHttpHandler` agent. Test against the npm registry or a local TLS server, never AWS.
- **Exit:** a parameter-change list.
  - Sets PAR-111's AWS SDK value.
  - Adds new PARs: aws-sdk-client-mock version, `@types/aws-lambda` version, Lambda runtime `nodejs22.x`, Lambda architecture, Lambda memory, Data API backoff (base, factor, cap, full jitter), and the AWS-AC-005 pause-wait bound.
- **Deps:** none.

**G-S2 — SST AWS program offline.**
- Write the stage program: Router; StaticSite on the router; Function with `bundle`, `url.router` path `/api`, PAR-270 timeout, PAR-271 `readTimeout`, explicit `permissions`, no `link` (to avoid broad grants); Aurora with `dataApi`, scaling 0–4 ACU, `pauseAfter` 5 min, shared VPC ids, no final snapshot; Bucket.
- Type-check it against the cached SST platform types.
- Read SST's source to settle five questions:
  - Can `router.url` feed the Function's environment without a cycle? If not, use the named two-phase fallback (aws.md:68).
  - Is the Aurora credentials secret SST-created (`aurora.ts:891`)? If so, `remove` must force-delete it.
  - Which `transform` sets its recovery window?
  - How does `--target` behave for step 3 (same caveat as the Cloudflare root cause, 2026-10-23-pass1)?
  - How is `home: "aws"` bootstrapped?
- Also try running the program under Pulumi mocks. If that is infeasible, record it; the fallback is type-check plus structural tests.
- **Deps:** none.

### G-1x: implementers (each owns its directory and its component doc's AWS section)

**G-01 — Identity and exports.**
- Add `"aws"` to `Target` (identity.ts:16, cli/args.ts:12), `./targets/aws` to `FW/package.json` exports, and the AWS row to `secret-locations.ts`.
- Add `config/aws/test.json` to the template and reference apps.
- Decision draft: DEC-0110 superseded.
- **Owns:** those files and the hub. **Deps:** G-S1.
- **Exit:** CORE-AC-005 unit and fixture tests green.

**G-F1 — Data API fake** (a different implementer from G-02).
- `FW/src/sql/data-api-fake.test-support.ts`: a `send()` for `ExecuteStatement`, `BatchExecuteStatement`, `Begin`/`Commit`/`RollbackTransaction`.
- One PGlite instance per named database. Supports `CREATE DATABASE … TEMPLATE` (copy of the data dir) and `DROP … WITH (FORCE)`.
- Translates `:name` parameters, `typeHint` and `records`/`columnMetadata` from the SDK's types.
- Injects `DatabaseResumingException`, a SQLSTATE in a `BadRequestException` message, and the response-size error.
- Documents every fidelity gap in its header.
- **Read:** sql.md §2, migrations.md:86–91, the SDK types, the drizzle session (`node_modules/drizzle-orm/aws-data-api/pg/session.js`). **Deps:** G-S1.
- **Exit:** its own self-tests green.

**G-02 — SQL Data API adapter.**
- `FW/src/sql/data-api.ts`: client created once per cold start, the guard, and the retry loop with injected clock and errors.
- Error mapping: SQLSTATE 23505/23503 → `SQL.CONFLICT`; Data API response-size error → `SQL.RESULT_TOO_LARGE`; resume budget exhausted → `SQL.UNAVAILABLE`.
- Value normalisation (long, double, boolean, null). `atomic` uses the existing Postgres transaction path (`FW/src/sql/atomic.ts`).
- **Deps:** G-F1. **Exit:** unit tests green, including the SQL-AC-006 retry clause.

**G-03 — LOG, SEC, CFG, AUTH runtime parts for AWS.**
- `FW/src/log/aws/`: S3 sink through aws4fetch with the expected-owner header and the shared LOG-REQ-004 key builder, plus a pending-write tracker with the PAR-260 bound.
- `FW/src/secrets/aws.ts`: SSM reader.
- `awsLambdaSettings`: environment variables, never `SECRET_*`.
- **Deps:** G-01. **Exit:** unit tests green for LOG-AC-001 (AWS logic) and SEC logic.

**G-04 — FILES on S3.**
- `FW/src/files/aws/`: store (PUT, GET, HEAD, DELETE, ListObjectsV2 XML), tickets with `X-Amz-Security-Token` and `response-content-disposition: attachment` (DEC-0414), the bucket CORS policy, and the storage preflight.
- In-process S3 fake that checks SigV4.
- **Deps:** G-01. **Exit:** unit tests green.

**G-05 — AWS target runtime.**
- `FW/src/targets/aws/`: `createAwsLambdaHandler(app, resolved, {mock})` built on `assembleStage` (`FW/src/targets/cloudflare/stage.ts`) and `hono/aws-lambda`. It awaits the pending log writes and takes the origin from the environment.
- **Deps:** G-02, G-03, G-04.
- **Exit:** Function URL fixture tests for 404 JSON, `no-store`, two cookies, Host ignored, and auth guards.

**G-06 — Build `--target aws`.**
- `FW/src/build/`: Node esbuild bundle (node22, ESM, SDK bundled rather than taken from the runtime), the generated entry, and bundle inspection.
- **Deps:** G-05. **Exit:** CORE-AC-006 AWS clause and PROV-AC-005 (aws) green.

**G-07 — AWS account operations.**
- `FW/src/provision/aws/{environment,account,engine}.ts`.
- Preflight names missing variables and calls STS `GetCallerIdentity`.
- Engine check: PAR-110 17.x with Data API and a 0 ACU minimum in the region (provisioning.md:18).
- Log bucket owned, absent or foreign (`HeadBucket` with the expected owner); region from `GetBucketLocation`.
- Shared VPC: two private subnets in two AZs, a DB subnet group and a security group; no IGW, no NAT; tagged.
- **Deps:** G-S1. **Exit:** client-mock unit tests green; PROV-AC-007 AWS case green.

**G-08 — SST AWS program writer.**
- `FW/src/provision/aws/sst.ts`, mirroring `FW/src/provision/cloudflare/sst.ts`.
- Builds the G-S2 program from the app definition (PROV-REQ-001). IAM statements use exact ARNs: SSM path, stage bucket objects, `PutObject` on the log bucket only, `rds-data` on the cluster, `GetSecretValue` on the credentials secret.
- `removal: "remove"`. All inputs are embedded as JSON.
- **Deps:** G-S2, G-07.
- **Exit:** structural tests, plus a type-check of the generated program against the SST platform types.

**G-09 — AWS databases and cloud migration.**
- `FW/src/provision/aws/databases.ts`: wait for resume, create/copy/drop on the `postgres` database, list `pg_database` names, `migrationDatabase` (one transaction per file, a decision), and the Postgres side of `checkMigratedDatabase` (counts, FK validity) over `FW/src/mig/cloud/check.ts`.
- **Deps:** G-02.
- **Exit:** unit tests green against the fake, including the MIG-AC-003 failure path through `fake-target`-style core tests.

**G-10 — AWS TargetOperations.**
- `FW/src/provision/aws/target.ts`:
  - `stopApp`/`startApp`: `PutFunctionConcurrency 0` and `DeleteFunctionConcurrency`.
  - `setSecret`/`listSetSecrets`: SSM.
  - `deployInfrastructure`/`deployCode`: `runSst`. `deployCode` also generates the session key when absent.
  - `checkHealth`.
  - `listStageResources`: tag lookup plus SSM path plus SST state; exact identifiers; works from a clean machine.
  - `removeStage`: empty the bucket, delete the SSM path, `sst remove`, force-delete the secret, delete stage state.
- **Deps:** G-07, G-08, G-09. **Exit:** client-mock unit tests green.

**G-11 — CLI wiring.**
- `--target aws` for every cloud command, `setup-account --region`, proxy and CA environment for the SDK and for SST/Pulumi (Go: `SSL_CERT_FILE`), and the log-location print for `smoke`.
- **Deps:** G-06, G-10. **Exit:** CLI unit tests green with the fake target.

**G-12 — Skill and template docs.**
- Owner copy-and-paste steps for AWS (SKILL-REQ-006): credentials, `setup-account --target aws`, deploy, secrets, logs (`aws s3 ls/cp` under the LOG-REQ-004 prefix, `aws logs tail`), and the idle cost note (template README line 215).
- Every step marked "not yet verified on AWS".
- **Deps:** G-11. **Checks:** typecheck, lint, `tests/skill`.

### Test authors (they write from criteria and contracts, never from the implementation, and start after G-S1)

**G-T1 — AWS cloud hooks.** `tests/compliance/criteria/_cloud/aws/`, implementing the `CloudHooks` interface (`tests/compliance/criteria/core/support/stores.ts:31`):
- SSM delete;
- log listing and reading through S3;
- stage-resource probes;
- an IAM simulation helper;
- a log-deny hook (add, then remove, a stage-scoped inline deny);
- Function URL discovery;
- a cluster-paused observer.

Each hook is unit-tested with client-mock.

**G-T2 — AWS criteria.** `tests/compliance/criteria/aws/`: AWS-AC-001…006. AWS-AC-005 records not-run with the reason if the cluster never pauses.

**G-T3 — Offline pre-check suites.**
- `FW/test/integration/aws-precheck/`: the C-T2 shared SQL/KV case sets and the FILES cases through the AWS adapters over the fakes.
- **Untagged.** The titles say "pre-check, not evidence".

**G-T4 — Local-clause tests and harness.**
- Tests: the SQL-AC-006 retry clause, the CORE-AC-006 AWS-bundle clause, the CORE-AC-005 update, and PROV-AC-007 for AWS.
- Remove the DEC-0397 rules. Change the `*`/aws rule (`expected.ts:39`) to detail "AWS live run pending (no account)".
- Driver `--target aws`: stage naming, leftovers through the AWS `listStageResources`, and AWS usage caps (at most three clusters at once, and an API-call count).

### Runner, evaluator and integration (offline)

- **G-INT:** numbers the decision drafts and applies the parameter changes (plan §10.4). **Deps:** all G items.
- **G-RUN:** runs these and commits the evidence to `validation/local/phase-G/`. **Deps:** G-INT.
  - full `verify`, online and offline;
  - `compliance --target local`;
  - unit and integration layers, including the pre-check suites;
  - a dry run of `compliance --target aws` against `_fakes`, to prove the wiring;
  - a scan showing zero AWS hosts were contacted.
- **G-EV:** judges the Local criteria above. It confirms every AWS cloud criterion is not-run with the new detail and that no pre-check is counted as evidence. It signs the §4 readiness checklist. **Phase G exit.**

### Decisions to record (ai-proposed unless you override)

1. `./targets/aws` added; DEC-0110 superseded.
2. SDK set and a single pinned version; S3 and log writes through aws4fetch, as files.md:98 says.
3. Bundle: ESM, SDK bundled, arm64.
4. The Data API fake's status (pre-check only).
5. The new not-run detail.
6. Shared VPC created by SDK calls in `setupAccount`, not by an SST account app.
7. SST state home `aws`; region = the log bucket's region.
8. `listStageResources` sources.
9. One transaction per migration file.
10. COMPL-AC-004's R2-token clause on AWS (proposed: read as a leftover SSM parameter or secret).
11. Force-delete of the SST-created Aurora secret.
12. SPA fallback through a router function.
13. The PAR-260 wait mechanism.
14. SDK proxy handling.

### Live items (phase L)

- **L-0 — Access** (about 30 min): STS identity; reachability of every host in §4 from curl, Node and Playwright; quotas; resolve PAR-110 in us-east-1; Pulumi plugin present.
- **L-1 — Live spikes on the first template stage** (about 2 h):
  - `CREATE DATABASE … TEMPLATE` with no pooled connection left open (migrations.md:89);
  - Data API error shapes and type round-trips;
  - the response to reserved concurrency 0, and its restore;
  - `router.url` wiring, SPA fallback and two cookies;
  - S3 presigned PUT/GET with session token and CORS, and whether S3 sends CORS headers on 403;
  - IAM simulation.
- **L-INT** updates the decisions and parameters.
- **L-RUN:** `compliance --target aws`.
- **L-RUN-M:** the milestone run.
- **L-DEMO:** E2E-002 and DEMO-AC-010.
- **L-EV:** the evaluator's verdicts.
- Every failure goes through prompt §8 (diagnose, review, fix, re-check).

## 4. Live-test readiness checklist

**Account and identity**
- One temporary account with a non-root IAM principal holding AdministratorAccess. That is the simplest choice for a throwaway account.
- If you prefer least privilege, it needs: s3, cloudfront, cloudfront-keyvaluestore, lambda, iam (role CRUD, PassRole, `SimulatePrincipalPolicy`), rds, rds-data, secretsmanager, ssm, kms Decrypt on `aws/ssm`, ec2 (VPC, subnets, security groups, AZs, `DescribeNatGateways`), logs, tag:GetResources, sts.

**Credentials**
- Environment variables `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and, for temporary credentials, `AWS_SESSION_TOKEN`.
- SigV4 means the proxy cannot inject them.
- Session lifetime of at least 12 h, or you refresh them. Never printed.

**Proxy allowlist**
- `sts`/`iam`/`cloudfront`/`s3.amazonaws.com`
- `*.us-east-1.amazonaws.com` (rds, rds-data, ssm, lambda, secretsmanager, ec2, s3, logs, tagging, cloudfront-keyvaluestore)
- `*.s3.us-east-1.amazonaws.com`
- `*.lambda-url.us-east-1.on.aws`
- `*.cloudfront.net`
- the same for us-west-2 (PROV-AC-006)
- `get.pulumi.com`/GitHub, only if the plugin cache is gone.

**Regions:** us-east-1 (PAR-060), plus us-west-2 for the milestone only.

**Quotas to confirm before L-0**
- CloudFront enabled. New accounts can be blocked until AWS verifies them.
- Lambda concurrency at least 10.
- VPCs per region: 5 (we use 1).
- Aurora clusters: the default is fine.
- Set an AWS Budget alarm at $25.

**Pass schedule** (stages take about 20 min to create and 15–25 min to remove; CloudFront is the slow part; at most 3 stages at a time):
- L-0 + L-1: about 3 h (1 stage).
- L-RUN: about 3 h (run stage plus about 2 extra stages).
- Fix loop: about 2 h.
- L-RUN-M: about 4 h. Covers E2E-010, E2E-012 / PROV-AC-003 (2 stages), PROV-AC-004, PROV-AC-006 (us-west-2 setup plus 1 stage), COMPL-AC-008, and AWS-AC-005 (waits at least 5 min plus the bound).
- L-DEMO: about 1 h.

That is roughly 12–14 h of active time. Allow an account lifetime of 2–3 days, or use two accounts: one for L-0 to L-RUN, one for L-RUN-M after fixes. Setup is scripted, so a second account costs little.

**Cost** (an estimate; prices not checked):
- Aurora: about 10 cluster lifecycles × about 1.5 h × about 1 ACU × about $0.12 ≈ $2–4.
- Data API, Lambda, CloudFront, S3, SSM, Secrets Manager and logs: cents.
- No NAT gateway, no public IPv4.
- Expected total $5–15. The risk is a cluster forgotten at 4 ACU, which would cost about $0.50 an hour. The leftover check and the budget alarm cover that.

### Readiness verdict (G-EV, 2026-10-24)

Full evaluation: `ai/implementation/evaluations/G-aws-offline.md` (§7 has each item, §8 the owner's list). **Phase G passes with findings.** The code and harness are ready for L-0, except for two gaps:
- **F4 (not-ready, agent):** the AWS test hooks need `AWS_REGION`, but the driver does not set it. Until it does, the owner exports `AWS_REGION=us-east-1`.
- **F5 (not-ready, owner allowlist):** add `*.cloudfront-kvs.global.api.aws` to the allowlist. SST's Router writes routes to the CloudFront KeyValueStore there. L-0 confirms the host.

**Ready:**
- the regions (PAR-060, `setup-account --region`);
- the credential preflight, which names `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or accepts `AWS_PROFILE`, web-identity or container sources, then calls STS;
- the usage caps (PAR-282/283);
- the schedule and cost estimates.

**Owner-action:**
- the account (AdministratorAccess recommended; the least-privilege list above also needs `iam:CreateServiceLinkedRole`, `cloudfront-keyvaluestore` and `ssm` on `/sst/*`);
- the credential variables;
- the allowlist, including the Pulumi plugin hosts in a fresh sandbox;
- CloudFront verification and the quotas;
- the $25 budget alarm;
- answers to §5 Q4–Q5 and §5.1 Q1/Q3/Q4/Q7 before L-1.

## 5. Risks and open questions for you

1. Does Google stay mocked in the AWS phase? I assumed yes, so the Google-dependent criteria stay not-run.
2. Can you allowlist the AWS hosts on the proxy and provide the credential variables above?
3. A new temporary account may be blocked from creating CloudFront distributions. That would block AWS-AC-001, AWS-AC-004 and AWS-AC-006, and every deploy.
4. If the Data API keeps a pooled connection to the old database, `CREATE DATABASE … TEMPLATE` fails. The design names no fallback. Do you pre-approve the Cloudflare-style page copy (DEC-0096) or `pg_terminate_backend` as the fallback, so the live run doesn't stall while the account is running?
5. Same question more broadly: do you pre-approve the design's named fallbacks (two-phase router update, aws.md:68) and "make an assumption and continue" for the live run?
6. The fakes' fidelity (type mapping, error text, size errors) is a real risk. L-1 runs the case sets first to surface gaps early.
7. COMPL-AC-004's R2-token clause has no AWS equivalent. Please confirm the reading in decision 10.
8. PROV-AC-006 needs a second region, which means one more VPC and log bucket. Is that acceptable?
9. FILES-AC-003's expired-ticket clause may pass on S3 but fail on Cloudflare (DEC-0101). That is a divergence, not a defect.
10. DEC-0110 (no `./targets/aws`), still open for your review, is now superseded (by DEC-0447).
11. Proposed AWS usage caps: at most 3 stages at once, the $25 budget alarm, and stop on throttling. Please approve them or set your own.

### 5.1 Owner questions from the phase G decision drafts (G-INT, 2026-10-24)

1. **Conflict, `.`/`..` names (DEC-0464 vs FILES-AC-002):** on AWS a name that is only `.` or `..` is `FILES.INVALID_NAME` (URLs cannot carry it), but FILES-AC-002's shared case round-trips `".."` and fails in G-T3's S3 pre-check; choose: forbid both names in FILES-REQ-002 on every target (recommended), accept a target difference, or send them through `@aws-sdk/client-s3`.
2. **Remove keeps state (DEC-0491):** unlike Cloudflare (DEC-0084), a failed `sst remove` on AWS keeps the stage's SST state and passphrase so a later `remove` can retry (no by-name fallback for cluster, Function or CloudFront); confirm.
3. **`kms:Decrypt` for SSM (DEC-0481):** the Function role is not granted `kms:Decrypt`, on the reading that the AWS-managed `aws/ssm` key allows SSM use by account principals; confirm, or have it granted on that key.
4. **CloudFront `Origin` forwarding (DEC-0468):** the router's origin request policy must pass `Origin` to the Function URL unchanged, or every session POST through CloudFront is `AUTH.REQUEST_FORGERY`; confirm that phase L may change the policy if SST's default drops it.
5. **Go TLS via `SSL_CERT_FILE` (DEC-0495):** SST/Pulumi get `SSL_CERT_FILE` = `NODE_EXTRA_CA_CERTS` (unless you set your own), which replaces Go's system roots; confirm this for the sandbox, to be verified at L-0.
6. **PAR-214 vs PAR-215 for NULL-heavy results (DEC-0453):** if phase L shows such results pass PAR-215 but exceed the Data API's 1 MiB, choose: count NULL as 8 bytes in sql.md §2.3, or add a row cap.
7. **Usage caps as parameters (DEC-0501):** Q11's caps are now PAR-282 (2,000 hook API calls per run) and PAR-283 (3 test-stage clusters at once); approve or set your own.

### Critical Files for Implementation
- /home/user/cloud-app/docs/components/aws.md
- /home/user/cloud-app/packages/framework/src/provision/core/operations.ts
- /home/user/cloud-app/packages/framework/src/targets/cloudflare/stage.ts
- /home/user/cloud-app/packages/framework/src/provision/cloudflare/sst.ts
- /home/user/cloud-app/packages/framework/src/sql/guard.ts
- /home/user/cloud-app/tests/compliance/harness/expected.ts
