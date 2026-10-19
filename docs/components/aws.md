# AWS — AWS target

Runs an app on AWS: an HTTP Lambda behind CloudFront together with a static site, Aurora Serverless v2 through the Data API, S3, SSM Parameter Store, and the shared log bucket.

Contracts: none of its own. It implements the capability contracts for AWS.

## 1. Requirements

#### AWS-REQ-001 — Runtime shape
Origin: provenance-unclear · Derives from: SYS-REQ-001, SYS-REQ-008

Each stage MUST serve the API from a Lambda (Function URL) and the client from a static site bucket, both behind one CloudFront distribution and one origin (HTTP).

#### AWS-REQ-002 — No VPC-attached compute
Origin: owner-approved · Derives from: SYS-REQ-007

Lambdas MUST run outside any VPC, so the stage needs no NAT gateway. The database is reached only through the Data API (DEC-0037).

#### AWS-REQ-003 — Stage resources and least privilege
Origin: provenance-unclear · Derives from: SYS-REQ-024

Each stage MUST have its own:
- Aurora cluster, placed in the account's shared network;
- database-credentials secret;
- S3 bucket;
- `/<app>/<stage>/secrets/` parameters.

The Lambda role MUST be limited to that stage's resources, plus putting objects into the shared log bucket.

#### AWS-REQ-004 — Direct Function URL access
Origin: ai-proposed · Derives from: SYS-REQ-017

Requests reaching the Function URL directly, bypassing CloudFront, MUST be subject to exactly the same authentication and authorization as requests through CloudFront (DEC-0044).

#### AWS-REQ-005 — Timing
Origin: ai-proposed · Derives from: SYS-REQ-001

The HTTP Lambda timeout (PAR-270) MUST exceed the database resume budget (PAR-210). The CloudFront read timeout (PAR-271) MUST be at least the Lambda timeout.

## 2. Design

Resources are created by SST (PAR-100), using `sst.aws.Router`, `StaticSite`, `Function` with a Function URL, `Aurora` (Postgres engine PAR-110, Data API enabled, PAR-212, PAR-213), and `Bucket`. Raw Pulumi AWS resources (PAR-109) are used only where SST has no component.

The region is PAR-060 unless the stage configuration overrides it. Aurora clusters use one VPC per account and region, created by `setup-account` with no NAT gateway and no bastion host, so the number of stages is not limited by the VPC quota (DEC-0074).

The stage's public origin is its CloudFront URL; custom domains are not supported (DEC-0073). The HTTP entry uses Hono's AWS Lambda adapter. SDK clients are created once per cold start.

## 3. Uses

All capability components, PROV.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| AWS-AC-001 | A deployed test stage serves the client and the API from the CloudFront origin; deep links serve the client; unknown API paths return JSON 404s. | AWS-REQ-001 | Cloud |
| AWS-AC-002 | The stage contains no NAT gateway and no VPC-attached Lambda. | AWS-REQ-002 | Cloud |
| AWS-AC-003 | The Lambda role cannot read another stage's bucket, secrets, or database, and cannot read the log bucket. | AWS-REQ-003 | Cloud |
| AWS-AC-004 | The protected-route acceptance criteria (AUTH-AC-004, AUTH-AC-007) pass when sent directly to the Function URL. | AWS-REQ-004 | Cloud |
| AWS-AC-005 | A request arriving while Aurora is paused succeeds or returns `SQL.UNAVAILABLE`, never a gateway timeout. | AWS-REQ-005 | Cloud |
