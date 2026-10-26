# AWS target: deferred to a later release (index)

The owner rescoped the first release to local and Cloudflare (2026-10-24, DEC-0508). The AWS work was moved off `main` to the branch **`aws`** (head `07be83f`). This file is the entry point for picking it up again. Read §1 first; open the linked files only for the part you need.

## 1. Where things stand (read first)
- **Built and tested offline (phase G): complete.** Branch `aws`. Evidence: `validation/local/phase-G/SUMMARY.md`. Evaluation: `ai/implementation/evaluations/G-aws-offline.md` (verdict: pass with findings). Decisions DEC-0432…0507. Parameters PAR-120/121, PAR-272…276, PAR-281…284.
- **Never run live.** All 85 AWS criteria are not-run. The phase plan, including the live phase L and the readiness checklist, is `ai/implementation/plan-aws.md` on branch `aws`.
- **Blocker found before going live: the database design.** The owner's AWS test accounts are Pluralsight sandboxes (§2). There, Aurora Serverless v2 with the RDS Data API (DEC-0074, aws.md) cannot be used. Pick a database design (§3) before any live work.
- **Restoring:** merge `main` into `aws` (expect conflicts in the shared refactors listed in §6), or start a branch from `aws` and port the work forward.

## 2. Test accounts: Pluralsight AWS cloud sandbox (binding limits)
- **Source:** https://help.pluralsight.com/hc/en-us/articles/24425443133076-AWS-cloud-sandbox. The page blocks browsers; read it through `https://help.pluralsight.com/api/v2/help_center/en-us/articles/24425443133076.json`. Read on 2026-10-24, page updated 2026-10-16.
- **Owner's rules:** a violation gets the account silently deleted. Accounts are flat-fee and unlimited. Each one lasts 4 hours. Credentials are an IAM access key ID and secret, with no session token. The environment has full network access.
- **Limits that matter here:**
  - regions us-east-1 and us-west-2 only;
  - Lambda: at most 2048 MB per function and 10 functions in total;
  - RDS: only t3/t4g micro, small or medium, at most 50 GB, no provisioned IOPS;
  - Budgets and Cost Explorer: not supported;
  - PrivateLink (interface VPC endpoints): will not support;
  - IAM: the cloud_user and admin roles must not be modified;
  - EC2: t2/t3/t3a/t4g micro, small or medium, at most 9 instances.
  
  CloudFront, S3, SSM, Secrets Manager, KMS, VPC, CloudWatch and the Resource Groups Tagging API are supported.
- **Already applied on branch `aws`:**
  - DEC-0506: at most 8 Lambda functions (PAR-284); budget alarm removed;
  - DEC-0507: region guard under `PROTOTYPE_AWS_SANDBOX=pluralsight`.
- **Session plan (4 h each, fresh account each time, teardown starts at about 3h15, commit evidence during the session):**
  - S1: credential check, database probe, setup-account, first deploy, AWS-AC-001…006, smoke, the live-only questions (§5), remove;
  - S2: the full `compliance --target aws`;
  - S3: re-run failures after offline fixes, PROV-AC-006 in us-west-2, and PROV-AC-004 (every sandbox is a fresh account).

## 3. Database decision (open, owner)
- **The problem:** the RDS Data API is "not supported on T DB instance classes" (https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.limitations.html). Aurora Serverless v2 uses `db.serverless`, which is not on the sandbox's t3/t4g list.
- **A. Keep Aurora Serverless v2 and the Data API.** Probe whether `db.serverless` is permitted, accepting that the probe may cost a sandbox, or ask Pluralsight. This keeps the design that is right for real accounts.
- **B. RDS PostgreSQL on db.t4g.micro with direct `pg` connections.** Lambda would sit either in the VPC behind a NAT gateway (no PrivateLink endpoints allowed) or outside it with a public database protected by TLS, a password and a security group. This is a significant redesign, and AWS-AC-005 (paused cluster) is dropped.
- **C. Provisioned Aurora on db.t4g.medium with direct connections.** It has B's networking problem and adds nothing.
- **D. Neon serverless Postgres (owner suggestion, 2026-10-24).** Researched, see §4. Recommendation was: Neon on AWS only first, keeping D1 on Cloudflare; decide separately whether to unify on Postgres everywhere.

## 4. Neon research (2026-10-24)
**Fit:**
- **No VPC:** Lambda and Workers reach it over the internet. This removes the VPC, Aurora, the Data API, its fake, the cluster cap and the engine check, about 1,000 lines plus tests.
- **Errors:** the HTTP driver's `NeonDbError.code` carries the SQLSTATE.
- **Transactions:** `atomic` maps to `drizzle-orm/neon-http` `db.batch()`, which is non-interactive like D1's batch. Interactive transactions need a per-request WebSocket `Pool`.
- **Copies:** `CREATE DATABASE` over SQL (up to 500 per branch) or copy-on-write branches. Branch restore keeps the connection string, but the docs disagree on how backups are kept, so probe it.
- **Free plan:** 100 projects; 10 branches per project (hard cap); 1 GB per project; 100 CU-hours per project per month; scale to zero after 5 min, resuming in a few hundred ms.
- **API:** 700 requests/min, 423 Locked on overlapping operations. Project-scoped API keys are available.

**Risks:**
- Edge-to-single-region latency if Cloudflare also uses Neon. Hyperdrive or Smart Placement mitigate it; Hyperdrive's free tier is 100k queries/day.
- The Neon driver can't talk to PGlite or stock Postgres; Neon Local is a proxy to a cloud branch.
- A full switch rewrites D1 provisioning.
- Size: Cloudflare 25–35 files, AWS 20–25, about 24 spec and skill docs. Repo impact detail: SQL adapters in `src/sql/{d1,postgres,data-api}.ts` share `portableHandle`. A Neon adapter is about 30 lines on the `postgres.ts` pattern.

**Recommendation recorded:**
1. Neon for AWS only (about 20–25 files), turning AWS-AC-005 into a scale-to-zero check.
2. If unifying everywhere, prefer plain `pg` over TCP with Hyperdrive on Workers, the pooled endpoint on Lambda and a local Postgres for `dev`, so local work doesn't depend on Neon. Spike Hyperdrive local mode and `atomic` over `pg` first.

**Sources:**
- https://neon.com/docs/serverless/serverless-driver
- https://neon.com/docs/introduction/plans
- https://neon.com/pricing
- https://neon.com/docs/guides/branch-restore
- https://neon.com/docs/manage/databases
- https://neon.com/docs/reference/api/key-concepts
- https://neon.com/docs/local/neon-local
- https://neon.com/docs/connect/connection-pooling
- https://neon.com/docs/guides/cloudflare-hyperdrive
- https://developers.cloudflare.com/hyperdrive/platform/pricing/
- https://orm.drizzle.team/docs/connect-neon

## 5. Questions only a live run can answer (plan-aws.md §5.1 on branch `aws`)
- whether reading SSM SecureString needs `kms:Decrypt` (DEC-0481);
- whether CloudFront forwards `Origin` to the Function URL; if not, every session POST fails as forgery (DEC-0468);
- whether Go TLS works through `SSL_CERT_FILE` (DEC-0495); probably moot in the sandbox, which has full network access;
- whether NULL-heavy results pass PAR-215 but exceed PAR-214 (DEC-0453); moot if the Data API goes;
- whether a failed `sst remove` keeps its state (DEC-0491), which needs owner review;
- whether the usage caps PAR-282 (2,000 calls per run) and PAR-283 (3 clusters) are approved;
- whether CloudFront KeyValueStore needs the host `*.cloudfront-kvs.global.api.aws`; moot with full network access;
- whether the tag lookup lists just-deleted resources, which would show up as false leftovers.

## 6. What moved and what stayed
- **Removed from `main`** (still on `aws`):
  - `src/targets/aws/`, `src/provision/aws/`;
  - `src/sql/data-api*.ts`, `src/files/aws/`, `src/log/aws/`, `src/secrets/aws.ts`;
  - the AWS build path and CLI wiring;
  - `tests/compliance/criteria/{aws,_cloud/aws}/`;
  - the aws-precheck suites;
  - the AWS SDK dependencies;
  - `validation/local/phase-G/`, the spikes `g-s1`/`g-s2`;
  - `plan-aws.md`, the `g-*` decision drafts and `G-aws-offline.md`.
- **Kept on `main`, because Cloudflare uses them:**
  - the shared S3/SigV4 signing in `src/files/s3/`;
  - `src/files/disposition.ts` and `src/targets/stage.ts`;
  - the per-target operations factory;
  - the time-bounded test fixes;
  - the `dryRun` evidence marker and skip-notes reporter;
  - the `.`/`..` ban (DEC-0505).
- **Spec:** `docs/components/aws.md` and the AWS sections of the other component docs are marked "deferred to a later release (branch `aws`)". The decisions stay in the log for the record.

## 7. Auth note
Release 1 replaces Google sign-in with Kinde (owner, 2026-10-24). Whatever login provider the release ends with, AWS must support it too when AWS resumes.
