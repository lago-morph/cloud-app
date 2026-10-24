# Decision drafts — g-s1

Evidence for every entry: `ai/implementation/spikes/g-s1/RESULT.md`, plus the spike's tests and probe in the same directory. All of it is offline, and no AWS endpoint was contacted.

### DEC-PENDING-g-s1-1 — One AWS SDK v3 version, 3.1153.0, for every client; client-mock and Lambda types pinned
Origin: ai-proposed · Status: accepted · Affects: PAR-111, new PAR-120, PAR-121, `packages/framework/package.json`

The framework pins these at exactly 3.1153.0:
- `@aws-sdk/client-{rds-data,s3,ssm,lambda,sts,rds,secrets-manager,ec2,iam,resource-groups-tagging-api}`.

The framework also pins these dev dependencies:
- `aws-sdk-client-mock` 4.1.0;
- `@types/aws-lambda` 8.10.164.

Reasons:
- SST 4.17.2 already pulls in `@aws-sdk/client-lambda@3.1153.0`, so the clients share one version with it.
- All ten clients install together with one `@aws-sdk/core` (3.978.5) and one `@smithy/node-http-handler` (4.12.1).
- `aws-sdk-client-mock` 4.1.0 intercepts `RDSDataClient` 3.1153.0 in the spike's tests.

The clients' transitive ranges float. The root lockfile fixes them.

Bundle rule:
- The HTTP Lambda bundle contains only rds-data, s3 and ssm. With drizzle's Data API driver and `hono/aws-lambda`, that is 886 KB minified, 248 KB gzipped.
- ec2, iam, rds, sts, secrets-manager, lambda and tagging are CLI or provisioning only.
- The bundle carries its own pinned SDK. It does not rely on the copy in the managed runtime.

### DEC-PENDING-g-s1-2 — The HTTP Lambda sets runtime `nodejs22.x`, architecture `arm64` and memory 1024 MB explicitly
Origin: ai-proposed · Status: accepted · Affects: new PAR-272, PAR-273, PAR-274, AWS-REQ-001, G-S2 program

SST 4.17.2 accepts both values: `FunctionArgs.runtime` includes `"nodejs22.x"`, and `architecture` is `"x86_64" | "arm64"`. A type check against the cached 4.17.2 platform gives no errors for these values and rejects `"nodejs23.x"` and `"arm"`.

SST's defaults are `nodejs24.x`, `x86_64` and `1024 MB` (function.ts:1765, 1769, 1888). The program must therefore set runtime and architecture. Otherwise the Lambda runs Node 24, against PAR-111's Node 22.22.0.

- **arm64** costs less per GB-second. The bundle is pure JavaScript with no native modules, so it can run there.
- **1024 MB** is SST's default. Lambda CPU scales with memory, which shortens cold starts and SigV4/JSON work. At PAR-001's load the cost difference is negligible.

The managed runtime's Node patch level is AWS's choice. The live phase records the deployed `process.version`.

### DEC-PENDING-g-s1-3 — The Lambda entry uses `hono/aws-lambda` from the pinned Hono, with one boundary cast
Origin: ai-proposed · Status: accepted · Affects: AWS-REQ-001, AWS-AC-006, AWS-AC-004, `FW/src/targets/aws/`

Hono 4.13.13's `handle(app)` behaves correctly for Function URL (payload 2.0) events:
- It selects the v2 processor.
- It joins `event.cookies` into `Cookie`.
- It returns several Set-Cookie headers as `cookies: [a, b]` and drops them from `headers`.
- It decodes base64 bodies.
- It keeps JSON error bodies.

The fixture test is in the spike. It is the offline half of AWS-AC-006.

Hono's event types require fields that real Function URL events and @types/aws-lambda leave out: `body`, `requestContext.authorizer` and `authentication`. So the entry takes the @types/aws-lambda `APIGatewayProxyEventV2` and passes it with `as unknown as LambdaEvent`.

`c.req.url` comes from the `Host` header. The framework's origin keeps coming from configuration (DEC-0044).

`hono/aws-lambda` is marked deprecated in favour of `@hono/aws-lambda`, which is at 1.0.1. It still adds no dependency, so it stays. The switch is a pin change at Hono v5.

### DEC-PENDING-g-s1-4 — The Data API adapter wraps drizzle `aws-data-api/pg` in `portableHandle` and classifies SDK errors itself
Origin: ai-proposed · Status: accepted · Affects: SQL-REQ-006, SQL-AC-006, sql.md §2 (AWS), new PAR-275, `FW/src/sql/`

`drizzle(client, { resourceArn, secretArn, database })` passes through `withValueRules` and then `portableHandle` with the existing guard. It type-checks under the framework's strict settings. The driver's database is assignable without a cast to the `PortableDb` members, and the only cast is postgres.ts's `as unknown as DrizzleDb`. It runs selects and inserts correctly against a mocked `RDSDataClient`, and an insert without `returning` gives `undefined`.

The adapter must also do the following:
- **(a) Resume retry.** It finds `DatabaseResumingException` by `name` on the cause chain, which runs DrizzleQueryError → SDK exception. It retries with PAR-275 backoff until PAR-210, then fails with `SQL.UNAVAILABLE`. Today's guard turns this into `CORE.INTERNAL`.
- **(b) Constraint errors.** It maps SQLState 23505 and 23503 to `SQL.CONFLICT`. A Data API `DatabaseErrorException` carries the SQLState only in its message and has no pg `code`. The message shape is assumed and must be confirmed live.
- **(c) SDK retry.** It creates the `RDSDataClient` with `maxAttempts: 1`, so the framework's loop is the only retry. That keeps the time budget exact, and fake timers can test it.

The clock, the random source and the error source are injected (sql.md:157).

### DEC-PENDING-g-s1-5 — Node-side SDK clients reach a proxy through an explicit `NodeHttpHandler` with a `proxyEnv` agent
Origin: ai-proposed · Status: accepted · Affects: CLI, PROV AWS operations, compliance harness, live phase L

A local CONNECT proxy shows the following:
- With or without `NODE_USE_ENV_PROXY=1`, SDK v3's default `NodeHttpHandler` ignores `HTTPS_PROXY`, because it builds its own `https.Agent`.
- `new NodeHttpHandler({ httpsAgent: new https.Agent({ keepAlive: true, proxyEnv: process.env }) })` goes through the proxy on Node 22.22.0. It honours `NO_PROXY`, and it connects directly when no proxy variable is set.

Every SDK client the CLI, provisioning or the harness creates uses this handler. It needs no `https-proxy-agent` dependency, and it is harmless in Lambda, where no proxy variable is set.

`@types/node` 22.20.5 does not declare `proxyEnv`, so the code needs a local type extension for that option.

Node `fetch` (aws4fetch) honours the proxy only under `NODE_USE_ENV_PROXY=1`. The CLI environment keeps that flag, as A-01 found. Proxy TLS also needs `NODE_EXTRA_CA_CERTS`, which is preset in this sandbox.

Fallback: `httpsAgent: https.globalAgent` with `NODE_USE_ENV_PROXY=1`. It works, but it depends on an experimental code path (`UNDICI-EHPA` warning).

### DEC-PENDING-g-s1-6 — AWS-AC-005's wait for a paused cluster is bounded
Origin: ai-proposed · Status: accepted · Affects: AWS-AC-005, new PAR-281

The slow test does the following:
1. It sends no traffic to the cluster.
2. Every 30 seconds it polls the cluster's observable pause state. G-S2 or an L item names the API.
3. It stops after PAR-281 (15 minutes).
4. If the cluster has not paused by then, it records AWS-AC-005 as not-run, with the reason and the last observed state.

The bound comes from three parts:
- PAR-213's 5-minute pause delay;
- up to 10 minutes for the pause to take effect and become visible;
- a short tail.

That keeps one live run under about 20 minutes, including the timed request.

## Parameter changes

These IDs are proposed. The `-INT` item confirms or renumbers them. PAR-115 stays unused.

- **PAR-111** (AWS SDKs part): "to be recorded in the AWS phase" → "AWS SDK v3 3.1153.0 for every `@aws-sdk/client-*` the framework uses: rds-data, s3, ssm, lambda, sts, rds, secrets-manager, ec2, iam, resource-groups-tagging-api". Reason: it is the version SST 4.17.2 already resolves for client-lambda, and the ten clients share one `@aws-sdk/core` (DEC-PENDING-g-s1-1).
- **New PAR-120** (Dependency pins): `aws-sdk-client-mock` 4.1.0. A framework dev dependency for SDK unit tests. Reason: it is the latest version, and it works with the 3.1153.0 clients in the spike.
- **New PAR-121** (Dependency pins): `@types/aws-lambda` 8.10.164. A framework dev dependency, used for the Lambda entry's event and result types. Reason: it is the latest version (2026-09-29), and the spike's fixtures type-check against it under TypeScript 6.0.3 with the framework's settings (`skipLibCheck` on, as in the framework).
- **New PAR-272** (AWS deployment): HTTP Lambda runtime `nodejs22.x`. Category ai-proposed. Reason: it matches PAR-111's Node 22.22.0, and SST's default is `nodejs24.x`, so it must be set (DEC-PENDING-g-s1-2).
- **New PAR-273** (AWS deployment): HTTP Lambda architecture `arm64`. Category ai-proposed. Reason: lower cost, and the bundle has no native modules. SST's default is `x86_64`.
- **New PAR-274** (AWS deployment): HTTP Lambda memory 1024 MB. Category ai-proposed. Reason: it is SST's default, CPU scales with memory, and at PAR-001's load the cost is negligible.
- **New PAR-275** (AWS deployment, or SQL): Data API resume backoff. Base 250 ms, factor 2, cap 5 s, full jitter, so delay n = random(0, min(5 s, 250 ms × 2ⁿ)). Retries stop when the next attempt would pass PAR-210. Category ai-proposed. Reasons:
  - An Aurora resume from 0 ACU usually takes about 15 s.
  - Short early delays catch a resume already in progress.
  - The cap keeps the wasted wait after the resume under 5 s.
  - Full jitter spreads the retries of concurrent requests.
  - Fewer than about 15 calls fit in the 45-second PAR-210 budget.
- **New PAR-281** (Testing): AWS-AC-005 pause wait. At most 15 minutes, polling every 30 s. If the cluster has not paused by then, the criterion is recorded as not-run with the reason. Category ai-proposed. Reason: PAR-213 (5 min) plus slack for the pause to take effect, which keeps the slow test bounded (DEC-PENDING-g-s1-6).
