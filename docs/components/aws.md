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

The HTTP Lambda timeout (PAR-270) MUST exceed the database resume budget (PAR-210) plus the log-write wait (PAR-260). The CloudFront read timeout (PAR-271) MUST be strictly greater than the Lambda timeout.

## 2. Design

Resources are created by SST (PAR-100), using `sst.aws.Router`, `StaticSite`, `Function` with a Function URL, `Aurora` (Postgres engine PAR-110, Data API enabled, PAR-212, PAR-213), and `Bucket`. Raw Pulumi AWS resources (PAR-109) are used only where SST has no component.

The router is created first; the Function's route is attached to it, and `router.url` is passed to the Function as the stage's public origin, so the origin is known before runtime. If the pinned SST cannot do this, the deploy uses a two-phase update. SPA fallback for deep links uses a viewer-request or router function for non-`/api` paths only, never distribution-level custom error responses, so API error responses reach the browser unchanged.

The region is the account setting recorded by `setup-account` (default PAR-060); every stage in the account uses it (DEC-0075). Aurora clusters use one VPC per account and region, created by `setup-account` with no NAT gateway and no bastion host, so the number of stages is not limited by the VPC quota (DEC-0074).

The stage's public origin is its CloudFront URL; custom domains are not supported (DEC-0073). The HTTP entry uses Hono's AWS Lambda adapter. SDK clients are created once per cold start. Runtime S3 calls (log writes, file operations) send `x-amz-expected-bucket-owner` with the account ID.

### Deploy mechanics

How this target implements the per-target operations (PROV §2, Per-target operations):
- **`setupAccount`** creates the shared log bucket in the chosen region (LOG §2), the shared network (DEC-0074) and the provisioning tool's state home on AWS, and checks that this account owns them. The region is read back from the log bucket's location. Before creating anything in a new region, it checks that PAR-110 is offered there with the Data API and the minimum capacity of PAR-212.
- **`deploy`** runs SST with the components above. The current database is an input; it is not in the provisioning tool's state.
- **`setSecret`** writes the SecureString parameter `/<app>/<stage>/secrets/<name>` (SEC-REQ-003).
- **`stopApp`** sets the HTTP Lambda's reserved concurrency to zero. **`startApp`** removes the reserved concurrency through the Lambda API. The provisioning tool does not undo a change made outside its state, so the start is always an explicit CLI call, made on every deploy (PROV-REQ-002 step 6) and after a failed migration or check (MIG-REQ-003).
- **`createDatabase`, `copyDatabase` and `dropDatabase`** run through the Data API from the CLI against the stage's cluster, after waiting for it to resume (PAR-210; MIG §2).
- **`remove`** empties the stage's S3 bucket, drops the CLI-owned databases, deletes the parameters under `/<app>/<stage>/`, and runs the provisioning tool's removal with the final Aurora snapshot skipped. The database-credentials secret is deleted without a recovery window, unless it is RDS-managed (PROV §2, Removal).
- **`listStageResources`** reports the stage's cluster, credentials secret, buckets, Function, distribution and parameters by their identifiers, and the databases by the exact database pattern.

## 3. Uses

All capability components, PROV.

## 4. Acceptance criteria

| ID | Criterion | Verifies | Where |
| --- | --- | --- | --- |
| AWS-AC-001 | A deployed test stage serves the client and the API from the CloudFront origin; deep links serve the client; an API 403 and an unknown API path's 404 keep their JSON ErrorResponse through CloudFront. | AWS-REQ-001 | Cloud |
| AWS-AC-002 | The stage contains no NAT gateway and no VPC-attached Lambda. | AWS-REQ-002 | Cloud |
| AWS-AC-003 | IAM policy simulation against the stage role shows that the Lambda role cannot read another stage's bucket, secrets, or database, and cannot read the log bucket. | AWS-REQ-003 | Cloud |
| AWS-AC-004 | The protected-route acceptance criteria (AUTH-AC-004, AUTH-AC-007) pass when sent directly to the Function URL. | AWS-REQ-004 | Cloud |
| AWS-AC-005 | One slow test: wait until the cluster is observably paused (bounded; if it never pauses, record not-run with the reason), then send one request. Within PAR-270 it returns 2xx or `SQL.UNAVAILABLE`, never a gateway timeout. | AWS-REQ-005 | Cloud |
| AWS-AC-006 | A reference route that sets two cookies delivers both, through CloudFront and directly at the Function URL. | AWS-REQ-001 | Cloud |

## 5. Portability note

This component is where AWS names belong: the Lambda and CloudFront runtime shape, the stage's resources and the per-target operations of PROV §2. App source and app-facing contracts do not change for it (SYS-REQ-001, SYS-REQ-003). Another target is a sibling component of the same shape plus one adapter per capability, and touches only the shared places the component map lists (§1); this component does not change.
