# Spike G-S1 — AWS pins, Lambda shape, Hono adapter, Data API driver, SDK proxy

**Question** (plan-aws.md §3, G-S1). Which single AWS SDK v3 version do we pin, and do the ten
clients, `aws-sdk-client-mock` and `@types/aws-lambda` install together? Does SST 4.17.2 accept
`runtime: "nodejs22.x"` and `architecture: "arm64"`? Does Hono 4.13.13's `hono/aws-lambda`
handle Function URL (payload 2.0) events and several Set-Cookie headers? Does drizzle 0.45.4's
`aws-data-api/pg` driver type-check behind the framework's `portableHandle` and SQL guard? How
does SDK v3 reach an HTTPS proxy on Node 22.22?

**Verdict.** All five pass.
1. **Pin `@aws-sdk/client-*` at 3.1153.0.** That is the version SST 4.17.2 already pulls in for
   client-lambda. All ten clients install with `aws-sdk-client-mock` 4.1.0 and `@types/aws-lambda`
   8.10.164.
2. SST 4.17.2 accepts both values. Its defaults are different: `nodejs24.x` and `x86_64`. So the
   program must set both explicitly.
3. Hono's adapter emits `cookies: [a, b]` for a v2 event. Two type mismatches need a boundary
   cast. The subpath is also deprecated in favour of `@hono/aws-lambda`.
4. The driver type-checks behind `portableHandle` without a cast on the builder members, and runs
   through the guard against a mocked client.
5. **`NODE_USE_ENV_PROXY=1` does not make SDK v3 use the proxy.** The SDK only goes through the
   proxy when given an explicit `NodeHttpHandler` whose
   `httpsAgent = new https.Agent({ proxyEnv: process.env })`. This uses Node's own agent, so no
   extra dependency is needed. Node `fetch` (aws4fetch) still needs `NODE_USE_ENV_PROXY=1`.

No AWS endpoint was contacted: every SDK client was mocked or pointed at `*.invalid` or a local
host. The npm registry was the only remote host. Throwaway code, not a workspace member. The
root `package.json` and lockfile are unchanged, and the spike's own `package-lock.json` was
deleted before commit.

## Environment

Node v22.22.0, npm 10.9.4, worktree reset to `origin/claude/implement-local-cloudflare` (1b474c1),
`npm ci` at the root, then `npm install --workspaces=false` inside this directory.

## 1. Pins and sizes

```
$ npm ls @aws-sdk/client-lambda          # root
`-- sst@4.17.2 > @aws/durable-execution-sdk-js@1.0.2 > @aws-sdk/client-lambda@3.1153.0
$ npm view @aws-sdk/client-s3 time       # 3.1153.0: 2026-10-19; latest 3.1156.0 (2026-10-22)
$ npm view aws-sdk-client-mock dist-tags.latest   # 4.1.0 (deps: sinon ^18.0.1, @types/sinon ^17.0.3, tslib)
$ npm view @types/aws-lambda dist-tags.latest     # 8.10.164 (2026-09-29)
$ npm install --no-audit --no-fund --workspaces=false   # in this dir
added 94 packages in 45s
$ npm ls --depth=0
+-- @aws-sdk/client-{ec2,iam,lambda,rds-data,rds,resource-groups-tagging-api,s3,secrets-manager,ssm,sts}@3.1153.0
+-- @types/aws-lambda@8.10.164   +-- aws-sdk-client-mock@4.1.0
+-- drizzle-orm@0.45.4  +-- hono@4.13.13  +-- typescript@6.0.3  +-- vitest@5.0.5  +-- @types/node@22.20.5
```

The ten clients share one `@aws-sdk/core@3.978.5` (23 dependents, a single copy) and one
`@smithy/node-http-handler@4.12.1`. The clients' internal ranges float (`^`), and this fresh
install resolved `@aws-sdk/token-providers@3.1155.0`. The root lockfile is what fixes the
transitive versions. The root currently has `@aws-sdk/core@3.978.4` from SST, so the integrator's
`npm install` will move it to the newest compatible version or nest a copy. Either is fine.

Installed sizes (`du -sh`; whole spike `node_modules` = 165 MB):

| Package | Size | Package | Size |
| --- | --- | --- | --- |
| client-ec2 | 27 MB | client-sts | 820 KB |
| client-rds | 6.4 MB | client-resource-groups-tagging-api | 732 KB |
| client-ssm | 5.5 MB | client-rds-data | 604 KB |
| client-iam | 5.1 MB | @aws-sdk/core | 1.9 MB |
| client-s3 | 4.6 MB | @aws-sdk/nested-clients | 2.3 MB |
| client-lambda | 3.3 MB | @smithy/* (all) | 8.8 MB |
| client-secrets-manager | 1.1 MB | aws-sdk-client-mock / sinon | 184 KB / 5.2 MB |
| @types/aws-lambda | 348 KB | | |

**Lambda bundle estimate.** `src/lambda-runtime-deps.ts` re-exports what the HTTP Lambda carries:
rds-data, s3 and ssm clients, the drizzle Data API driver and `hono/aws-lambda`. Built with the
root esbuild 0.28.2 (`--bundle --platform=node --target=node22 --format=esm --minify`), it is
886 KB, or 248 KB gzipped, and it imports cleanly in Node. The ec2, iam, rds, sts,
secrets-manager, tagging and lambda clients are CLI or provisioning only and must stay out of the
Lambda bundle (core.md:89 already restricts what the bundle may contain).

## 2. SST 4.17.2: runtime and architecture

Source: the SST 4.17.2 platform extracted by an earlier run
(`<scratchpad>/repro/.sst/platform`, `version` = `4.17.2`), file
`src/components/aws/function.ts`:

```
363:  runtime?: Input<"nodejs18.x" | "nodejs20.x" | "nodejs22.x" | "nodejs24.x" | "go" | "rust" | ... >;
354:   * @default `"nodejs24.x"`
774:  architecture?: Input<"x86_64" | "arm64">;
1765:    const runtime = output(args.runtime ?? "nodejs24.x");
1769:    const architecture = output(args.architecture).apply((v) => v ?? "x86_64");
1888:      return output(args.memory).apply((memory) => memory ?? "1024 MB");
2625:              architectures: [architecture],
```

The same union is embedded in `node_modules/sst-linux-x64/bin/sst` (4.17.2), which also has the
Go runtime's table `nodejs24.x nodejs22.x nodejs20.x …`. A type check was also run.
`<scratchpad>/sstcheck/check.ts` imports `FunctionArgs` from that platform and assigns
`{ runtime: "nodejs22.x", architecture: "arm64", memory: "1024 MB" }`, plus two
`@ts-expect-error` lines for `"nodejs23.x"` and `"arm"`. It gives **0 errors in check.ts**: both
expected errors fired, so there was no TS2578. The 138 errors reported are all inside the
platform sources, which need SST's ambient globals (`$app`, …). G-S2 type-checks with those
globals present.

**Consequence.** The defaults are `nodejs24.x` / `x86_64`, so the program must set
`runtime: "nodejs22.x"` and `architecture: "arm64"` explicitly. Otherwise the Lambda would run
Node 24, while PAR-111 says Node 22.22.0. The managed runtime's patch level is AWS's choice;
G-S2/L items should record the deployed `process.version`.

## 3. Hono 4.13.13 `hono/aws-lambda` with Function URL events

Test: `test/hono-function-url.test.ts`. Fixtures: `fixtures/function-url-events.ts`, payload 2.0
with `routeKey "$default"`, `accountId "anonymous"`, cookies split into `cookies[]`, and one
base64 body.

```
$ npx vitest run
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

Observed:
- `getProcessor` selects the v2 processor when `rawPath` is present and `requestContext.http` is
  present (handler.js:309, 317).
- Request cookies `["a=1","b=two"]` become `Cookie: a=1; b=two`.
- Two `setCookie` calls come out as
  `cookies: ["session=s1; Path=/; HttpOnly; Secure; SameSite=Lax", "login_state=st; Max-Age=600; Path=/api; HttpOnly; Secure; SameSite=Lax"]`,
  and `set-cookie` is removed from `headers` (handler.js:170–174, 195–196). This is the offline
  half of AWS-AC-006.
- JSON body, base64 body and status pass through. An unknown `/api` path keeps its JSON 404 body.
- `c.req.url` is built from the `Host` header (the Function URL host). So for AWS-AC-004 /
  DEC-0044 the framework must take the origin from configuration, as aws.md says.

Findings for G items:
- **Type mismatch.** Hono's own `APIGatewayProxyEventV2` requires `body: string | null`, and its
  `requestContext` requires `authorizer` and `authentication`. @types/aws-lambda's type, like a
  real Function URL GET with auth type NONE, leaves these out. Under
  `exactOptionalPropertyTypes`, the entry needs one boundary cast:
  `handle(app)(event as unknown as LambdaEvent, ctx)`. The runtime does not need those fields.
- **Deprecation.** Every export of `hono/aws-lambda` in 4.13.13 is marked "will be removed in v5.
  Install `@hono/aws-lambda`". That package exists (1.0.1, peer `hono >=4.13.9 || ^5.0.0-0`).
  Recommendation: use `hono/aws-lambda` now, because it adds no dependency and PAR-104 already
  pins it. Switching becomes a pin change when Hono moves to v5. This spike did not test
  `@hono/aws-lambda`.

## 4. drizzle 0.45.4 `aws-data-api/pg` behind `portableHandle`

`src/data-api.ts` mirrors `postgresDb` (packages/framework/src/sql/postgres.ts). It calls
`drizzle(client, { resourceArn, secretArn, database })`, then `withValueRules`, then
`portableHandle({ dialect: "postgres", db, guard: createGuard(options) })`, importing the real
framework sources.

The type-level proof assigns the driver's `AwsDataApiPgDatabase` with **no cast** to
`Pick<PgDatabase<PgQueryResultHKT>, "select" | "selectDistinct" | "insert" | "update" | "delete" | "$with" | "with">`.
The only cast is the same `as unknown as DrizzleDb` that postgres.ts already uses: a class
instance does not satisfy an index-signature record. The spike tsconfig extends the root
`tsconfig.node.json`, so it is just as strict as the framework.

```
$ npx tsc -p tsconfig.json        # 0 errors
```

The spike maps `drizzle-orm` to its own copy (tsconfig `paths`, vitest `resolve.dedupe`). That way
the framework sources and the driver share one drizzle instance: the root copy cannot resolve
`@aws-sdk/client-rds-data` until the root depends on it. In the framework this goes away once
`@aws-sdk/client-rds-data` is a framework dependency.

Runtime check (`test/data-api-handle.test.ts`, `aws-sdk-client-mock` on `RDSDataClient` with
endpoint `https://data-api.invalid`):
- `select().from(kv).where(eq(kv.key,"k1"))` sends `ExecuteStatement` with the cluster/secret ARNs,
  `database: "app"`, sql `select "key", "value" from "__framework_kv" where "__framework_kv"."key" = :1`,
  and parameters `[{name:"1", value:{stringValue:"k1"}}]`. It maps `records` to
  `[{key:"k1",value:"v1"}]`.
- An insert without `returning` resolves to `undefined` (SQL-REQ-004).
- `DatabaseResumingException` (exported by client-rds-data 3.1153.0) comes out of today's guard as
  `CORE.INTERNAL "database error: resuming"`. The cause chain is
  `Error (DrizzleQueryError) -> DatabaseResumingException`. **The AWS adapter must classify by the
  SDK exception's `name` on the cause chain, and retry within PAR-210** (sql.md:157).
- A Data API constraint error (`DatabaseErrorException`, SQLState only in the message text) has no
  pg `code` field. Today's guard therefore gives `CORE.INTERNAL`, not `SQL.CONFLICT`. **The AWS
  adapter must map SQLState 23505/23503 from the message.** The exact message shape here is
  assumed and must be confirmed in the live phase. Until then, SQL-AC-006 conflict on AWS is only
  pre-checked.

## 5. How SDK v3 reaches the proxy

`src/proxy-probe.mjs` is fully local. It creates a self-signed certificate at run time for the
made-up host `spike-s3.example.test`, a TLS server on 127.0.0.1 that answers ListBuckets, and a
logging CONNECT proxy on 127.0.0.1 that tunnels only that host. Each variant runs
`src/proxy-client.mjs` in a child process with `HTTPS_PROXY=<local proxy>`,
`NO_PROXY=localhost,127.0.0.1` and `NODE_EXTRA_CA_CERTS=<cert>`. The host does not resolve, so a
client that ignores the proxy fails with `ENOTFOUND`.

```
$ node src/proxy-probe.mjs <scratchpad>
{"env":"(none)","variant":"sdk-default","ok":false,"code":"ENOTFOUND","proxySaw":[]}
{"env":"NODE_USE_ENV_PROXY=1","variant":"sdk-default","ok":false,"code":"ENOTFOUND","proxySaw":[]}
{"env":"NODE_USE_ENV_PROXY=1","variant":"sdk-globalAgent","ok":true,"buckets":1,"status":200,"proxySaw":["CONNECT spike-s3.example.test:46097"]}
{"env":"(none)","variant":"sdk-agent-proxyEnv","ok":true,"buckets":1,"status":200,"proxySaw":["CONNECT spike-s3.example.test:46097"]}
{"env":"unset HTTPS_PROXY unset https_proxy","variant":"sdk-agent-proxyEnv","ok":false,"code":"ENOTFOUND","proxySaw":[]}
{"env":"NO_PROXY=…,spike-s3.example.test","variant":"sdk-agent-proxyEnv","ok":false,"code":"ENOTFOUND","proxySaw":[]}
{"env":"(none)","variant":"fetch","ok":false,"code":"ENOTFOUND","proxySaw":[]}
{"env":"NODE_USE_ENV_PROXY=1","variant":"fetch","ok":true,"status":200,"proxySaw":["CONNECT spike-s3.example.test:46097"]}
```

(Lines shortened. Runs with `NODE_USE_ENV_PROXY=1` also print
`[UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental`.)

Reading:
- `NODE_USE_ENV_PROXY=1` configures only Node's **global** agents and `fetch`. SDK v3's
  `NodeHttpHandler` creates its own `https.Agent`, so the env flag has no effect on it.
- **Recommended:** every Node-side SDK client the CLI creates (provisioning, setup-account,
  database operations, smoke) gets
  `requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ keepAlive: true, proxyEnv: process.env }) })`.
  - This needs no new dependency (no `https-proxy-agent`).
  - It honours `NO_PROXY`.
  - When no proxy variable is set it connects directly, so it is harmless in Lambda, where none is
    set. The HTTP Lambda may still use the SDK default handler.
  - The alternative, passing `https.globalAgent` under `NODE_USE_ENV_PROXY=1`, also works. But it
    depends on the env flag and on an experimental code path.
- `@types/node` 22.20.5 (PAR-111) does not declare `proxyEnv` on `AgentOptions` (grep: no match),
  so the framework needs a small local type extension for that one option.
- aws4fetch (FILES, Node side) uses global `fetch`, so the CLI process still needs
  `NODE_USE_ENV_PROXY=1`. That matches the A-01 environment.
- TLS through the sandbox proxy additionally needs `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`
  (already preset here), or `AWS_CA_BUNDLE`.
- Not tested against the real sandbox proxy: `registry.npmjs.org` is in its `NO_PROXY`, and every
  other host would be a non-npm remote. The local proxy shows which code paths honour
  `HTTPS_PROXY`. The live phase (L) confirms against AWS.

## Files

- `package.json`: exact pins (lockfile deleted).
- `tsconfig.json`, `vitest.config.ts`.
- `src/data-api.ts`, `test/data-api-handle.test.ts`: Q4.
- `fixtures/function-url-events.ts`, `test/hono-function-url.test.ts`: Q3.
- `src/proxy-probe.mjs`, `src/proxy-client.mjs`: Q5.
- `src/lambda-runtime-deps.ts`: bundle-size probe.

To rerun: `npm install --workspaces=false && npx tsc -p tsconfig.json && npx vitest run && node src/proxy-probe.mjs <tmpdir>`.

Leftovers: none. No cloud resources were created.
