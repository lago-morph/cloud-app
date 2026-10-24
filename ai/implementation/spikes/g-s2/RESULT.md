# G-S2 — SST AWS stage program, offline

Date: 2026-10-24. Base: `origin/claude/implement-local-cloudflare` `1b474c1`, after `npm ci`. SST 4.17.2 (PAR-100), `@pulumi/aws` 7.20.0 (PAR-109), `@pulumi/pulumi` 3.215.0, Node 22.22.0.

**Network.** No AWS call was made: no request to `*.amazonaws.com`, `*.on.aws` or CloudFront, and no `sst deploy` against AWS. The mock runs and the SST experiment ran inside `unshare -rn` (no network namespace, loopback only, via `scripts/offline.sh`), with every `AWS_*` variable removed. Two calls went to other hosts:
- the npm registry, once: `sst install` of the experiment app, so the `random` provider could be resolved;
- `raw.githubusercontent.com`, to read SST's Go sources at tag `v4.17.2`. The same source was read the same way for root cause 2026-10-23-pass1. Copies are in `sst-src-v4.17.2/`:

  | Copy | Source path |
  | --- | --- |
  | `aws.go` | `pkg/project/provider/aws.go` |
  | `provider.go` | `pkg/project/provider/provider.go` |
  | `run.go` | `pkg/project/run.go` |
  | `project.go` | `pkg/project/project.go` |
  | `js.go` | `pkg/js/js.go` |
  | `deploy.go` | `cmd/sst/deploy.go` |
  | `main.go` | `cmd/sst/main.go` |
  | `cli.go` | `cmd/sst/cli/project.go` |

The TypeScript component sources come from a cached SST 4.17.2 platform (`.sst/platform`, `version` = `4.17.2`). Below, `platform/…` means `.sst/platform/src/components/…`.

## Verdict
- **Program written, type-checked and run under Pulumi mocks, offline.**
  - `program.ts` generates `sst.config.ts` from JSON inputs, the same way `FW/src/provision/cloudflare/sst.ts` does.
  - Both variants type-check against the cached platform types: the full program and the first-deploy step-3 program. A negative control fails as it should.
  - Both variants evaluate under `@pulumi/pulumi/runtime` `setMocks`, offline. 13 structural tests over the recorded resources and dependency edges pass. A negative control (a Function that reads `database.secretArn`) makes the step-3 safety test fail.
- **Q1 `router.url` → Function environment: no cycle.** One phase is enough, so aws.md:68's two-phase fallback is not needed.
- **Q2 credentials secret:**
  - SST creates it: `aws.secretsmanager.Secret` `DatabaseProxySecret`, with `recoveryWindowInDays: 0` hard-coded (`platform/aws/aurora.ts:890-912`).
  - **No transform** sets its recovery window, because `AuroraArgs.transform` has no secret entry. None is needed.
  - It is not RDS-managed.
- **Q3 `--target` on AWS: same behaviour as on Cloudflare.** A first deploy fails with `Target not found`. Two further findings bind the AWS design:
  - `--target-dependents` redeploys anything that depends on a target's output, with its new code, even when the target itself is unchanged.
  - Children of a target are included.
- **Q4 `home: "aws"`:**
  - It is bootstrapped by SST itself, per region, on every command that loads the home (deploy, remove, diff, refresh, unlock, secret …). `sst install` does not load it.
  - The bootstrap creates `sst-asset-<rand>` and the versioned `sst-state-<rand>` buckets, both with TLS-only policies, the ECR repository `sst-asset`, and the SSM parameter `/sst/bootstrap`.
  - Each stage also gets the SSM SecureString `/sst/passphrase/<app>/<stage>`.
- **Found along the way:**
  - SST 4.17.2's Lambda role always trusts the account root as well as Lambda (`function.ts:2279`). The program overrides it.
  - Function URL CORS defaults to `*`. The program turns it off.
  - `state: { purge: true }` makes `sst remove` delete the stage's SST state and its passphrase.

## 1. The program (`program.ts`, generated into `out/sst.config.ts` and `out/step3/sst.config.ts`)

| Logical name | Component | Arguments (all inputs embedded as JSON) |
| --- | --- | --- |
| `Files` | `sst.aws.Bucket` | `transform.bucket`: `bucket = <app>-<stage>-files-<account>` |
| `Database` | `sst.aws.Aurora` | `engine: "postgres"`, `version` (PAR-110, an input), `dataApi: true`, `scaling {min "0 ACU", max "4 ACU", pauseAfter "5 minutes"}` (PAR-212/213), `vpc {subnets, securityGroups}` from setup-account (DEC-0074); `transform.cluster`: `clusterIdentifier = <app>-<stage>`, `skipFinalSnapshot = true`, `deletionProtection = false`. A global `$transform(aws.secretsmanager.Secret)` names `DatabaseProxySecret` `<app>-<stage>-database-credentials`. |
| `Router` | `sst.aws.Router` | none (no domain, DEC-0073; `protection` defaults to `"none"`) |
| `Site` | `sst.aws.StaticSite` | `path` (prebuilt client, no `build`), `router: { instance: router }` |
| `Http` | `sst.aws.Function` | `name = <app>-<stage>-http`, `bundle`, `handler`, `runtime "nodejs22.x"`, `architecture "arm64"`, `timeout "55 seconds"` (PAR-270), `environment {…variables, FRAMEWORK_DATABASE, FRAMEWORK_DATABASE_SECRET_ARN, FRAMEWORK_DATABASE_CLUSTER_ARN, FRAMEWORK_PUBLIC_ORIGIN: router.url}`, explicit `permissions` (below), **no `link`**, `url { cors: false, router { instance: router, path: "/api", readTimeout: "60 seconds" } }` (PAR-271), `transform.role`: Lambda-only trust policy |

App settings: `removal: "remove"`, `home: "aws"`, `state: { purge: true }`, `providers: { aws: { version: "7.20.0", region } }`.

The step-3 variant is used on a first deploy (no code yet). It declares only `Files` and `Database`, and returns `databaseSecretArn` and `clusterArn` as outputs.

The explicit permissions use exact identifiers only. Wildcards appear only in object-key or parameter-path positions, never as a `<app>-<stage>-*` name wildcard (provisioning.md "Stage resources"):
- `rds-data:{ExecuteStatement,BatchExecuteStatement,BeginTransaction,CommitTransaction,RollbackTransaction}` on `arn:aws:rds:<region>:<acct>:cluster:<app>-<stage>`;
- `secretsmanager:GetSecretValue` on the secret's full ARN (an input read back after step 3);
- `s3:{GetObject,PutObject,DeleteObject}` on `arn:aws:s3:::<files>/*`, and `s3:ListBucket` on the bucket;
- `s3:PutObject` on `arn:aws:s3:::prototype-logs-<acct>/<app>/<stage>/*` (LOG-REQ-004 prefix; no read);
- `ssm:GetParameter` on `arn:aws:ssm:<region>:<acct>:parameter/<app>/<stage>/secrets/*`.

The only managed policy SST adds is `AWSLambdaBasicExecutionRole`. Without `link`, SST adds no other statement, which `structure.test.mjs` checks.

### Type-check
Command: `sh typecheck.sh <cached platform>` (output in `logs/typecheck.txt`).
- `setup-platform.mjs` builds `out/.sst/platform` from the cache. It symlinks every entry and writes `config.d.ts` the way `sst install` writes it for `providers: { aws }`: the cached Cloudflare and random variants use the same template, with `import * as _aws from "@pulumi/aws"`.
- `tsc` runs strict over both programs and passes.
- The negative control `negative.sst.config.ts.txt` must fail, and does: TS2322 for `"55 secs"`, `link: 3` and `readTimeout: "60 minutes"`; TS2820 for `"postgresql"`.
- Note: `DurationMinutes` accepts `"16 minutes"`. The Lambda 15-minute cap is checked only at runtime.

## 2. Pulumi mocks: feasible, done
Command: `unshare -rn sh ../../../../scripts/offline.sh sh mocks.sh`. Output is in `logs/mocks-run.txt` and `logs/mocks-{full,step3}.json`, and the tests in `logs/structure-test.txt`.

`mocks/run-mocks.mjs` reproduces how SST evaluates a program (`run.go:136-188`, `js.go:55-145`):
- esbuild bundles `import { run } from "platform/src/auto/run.ts"; import mod from "sst.config.ts"; export default await run(mod.run)`, with SST's banner, `define` of `$app`, `$cli` and `$dev`, `inject` of `platform/src/shim/run.js`, SST's `External` list, and the `InjectGlobals` plugin (it prepends `import * as aws …; import * as sst …` to the config).
  - Gotcha: `InjectGlobals` skips any path containing `.sst`, so a config file named `step3.sst.config.ts` gets no globals. Each variant is therefore its own `sst.config.ts`.
- The bundle is imported inside `runtime.runInPulumiStack` after `runtime.setMocks(...)`. The `MockMonitor.registerResource` hook also records each resource's parent, dependencies and property dependencies (URNs).
- A local HTTP stub at `SST_SERVER` answers the CLI RPCs the components call:
  - `Provider.Aws.Bootstrap` (`platform/aws/helpers/bootstrap.ts`), with fake bucket names;
  - `Runtime.Build`, returning `{handler, out: bundle}` (`function.ts:2098`). It is called even when `bundle` is set.
- Mocked invokes: `getPartition`, `getRegion`, `getCallerIdentity`, `getPolicyDocument` (inputs echoed plus `json`, like the real data source).

Limits of the mock run:
- No provider ran, so there is no AWS-side validation: engine version availability, name rules, quotas, Data API on the cluster.
- The dynamic providers did not run: `KvKeys`, `KvRoutesUpdate`, `BucketFiles`, the distribution waiter and invalidation. Neither did the CLI's real `Runtime.Build`, which copies and zips the bundle.
- Outputs such as ARNs and the distribution domain are fabricated.
- The mocks show the evaluated inputs and the dependency graph, not a plan or diff.

### Exact resource types created (full program, from `logs/mocks-full.json`)
Components (`sst:*`): `sst:aws:Bucket` Files, `sst:aws:Aurora` Database, `sst:aws:Router` Router, `sst:aws:CDN` RouterCdn, `sst:aws:StaticSite` Site, `sst:aws:Bucket` SiteAssets, `sst:aws:Function` Http, and `sst:sst:LinkRef` FilesLinkRef, DatabaseLinkRef, RouterLinkRef, SiteLinkRef, HttpLinkRef.

| Parent | Pulumi type | Logical name |
| --- | --- | --- |
| Files | `aws:s3/bucket:Bucket` | FilesBucket (`bucket` fixed, `forceDestroy: true`) |
| Files | `aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock` | FilesPublicAccessBlock |
| Files | `aws:s3/bucketCorsConfiguration:BucketCorsConfiguration` | FilesCors |
| Files | `aws:s3/bucketPolicy:BucketPolicy` | FilesPolicy (TLS only) |
| Database | `random:index/randomPassword:RandomPassword` | DatabasePassword |
| Database | `aws:secretsmanager/secret:Secret` | DatabaseProxySecret (`name` fixed, `recoveryWindowInDays: 0`) |
| Database | `aws:secretsmanager/secretVersion:SecretVersion` | DatabaseProxySecretVersion (`{username, password}`) |
| Database | `aws:rds/subnetGroup:SubnetGroup` | DatabaseSubnetGroup |
| Database | `aws:rds/clusterParameterGroup:ClusterParameterGroup` | DatabaseClusterParameterGroup |
| Database | `aws:rds/parameterGroup:ParameterGroup` | DatabaseParameterGroup |
| Database | `aws:rds/cluster:Cluster` | DatabaseCluster (`aurora-postgresql`, `provisioned`, `enableHttpEndpoint`, `{min 0, max 4, secondsUntilAutoPause 300}`, `skipFinalSnapshot`, `storageEncrypted`, `deletionProtection: false`, `databaseName: "reference"`, `masterUsername: "postgres"`) |
| Database | `aws:rds/clusterInstance:ClusterInstance` | DatabaseInstance (`db.serverless`) |
| Router | `aws:cloudfront/keyValueStore:KeyValueStore` | RouterKvStore |
| Router | `aws:cloudfront/cachePolicy:CachePolicy` | RouterServerCachePolicy |
| Router | `aws:cloudfront/function:Function` | RouterCloudfrontFunctionRequest (viewer-request) |
| RouterCdn | `aws:cloudfront/distribution:Distribution` | RouterCdnDistribution (`waitForDeployment: false`, no `customErrorResponses`, origin request policy `b689b0a8-…` = AllViewerExceptHostHeader) |
| RouterCdn | `pulumi-nodejs:dynamic:Resource` | RouterCdnWaiter (`sst.aws.DistributionDeploymentWaiter`) |
| SiteAssets | `aws:s3/bucket:Bucket`, `…BucketPublicAccessBlock`, `…BucketCorsConfiguration`, `…BucketPolicy` | SiteAssetsBucket, SiteAssetsPublicAccessBlock, SiteAssetsCors, SiteAssetsPolicy |
| Site | `pulumi-nodejs:dynamic:Resource` | SiteAssetFiles (`BucketFiles`), SiteKvKeys (`KvKeys`), SiteRoutesUpdate (`KvRoutesUpdate`), SiteInvalidation (`DistributionInvalidation`) |
| (stack) | `random:index/randomBytes:RandomBytes` | LambdaEncryptionKey (SST_KEY) |
| Http | `aws:cloudwatch/logGroup:LogGroup` | HttpLogGroup (`/aws/lambda/<fn>`) |
| Http | `aws:iam/role:Role` | HttpRole (inline policy = explicit permissions; `AWSLambdaBasicExecutionRole`) |
| Http | `aws:s3/bucketObjectv2:BucketObjectv2` | HttpCode (the zip, uploaded to the bootstrap **asset** bucket) |
| Http | `aws:lambda/function:Function` | HttpFunction (`nodejs22.x`, `arm64`, 55 s, 1024 MB default) |
| Http | `aws:lambda/functionUrl:FunctionUrl` | HttpUrl (`NONE`, `BUFFERED`, no CORS) |
| Http | `aws:lambda/permission:Permission` | HttpPublicFunctionUrlAccess, HttpPublicInvokeFunction (`principal "*"`) |
| Http | `pulumi-nodejs:dynamic:Resource` | HttpRouteKey (`KvKeys`, metadata `{host, origin.timeouts.readTimeout: 60}`), HttpRoutesUpdate (`KvRoutesUpdate`, entry `url,<ns>,,/api`) |

The step-3 program creates only the Files and Database subtrees above, plus FilesLinkRef and DatabaseLinkRef. No RPC call is made: no Function, no build and no bootstrap lookup.

Physical names. SST's `Component` naming transform (`platform/component.ts:66-395`) gives each unnamed resource `<app>-<stage>-<logical>-<rand8>` and adds `ignoreChanges` on the name field. An explicit name is kept. The program fixes four names:
- the files bucket;
- the cluster identifier;
- the secret name;
- the function name.

Every other name is generated: the role, the parameter and subnet groups, the instance, the site bucket, the CloudFront function and the KV store. Every resource is also tagged `sst:app` and `sst:stage`: SST's AWS provider sets these as `defaultTags` (`aws.go:118-128`).

## 3. The four questions

### Q1. Can `router.url` feed the Function's environment without a cycle? **Yes.**
- `Router.url` is the CDN's URL (`router.ts:2445-2449`). The Router has no inputs from its routes. A `url.router` route is attached afterwards, by the Function writing into the Router's KeyValueStore:
  - `normalizeRouteArgs` (`router.ts:3221-3264`) reads only `instance.url`, the KV store ARN and namespace, the distribution id/ARN and the protection;
  - the Function creates `HttpRouteKey` (`KvKeys`) and `HttpRoutesUpdate` (`function.ts:2836-2890`).
- The recorded edges confirm this. `HttpFunction` depends on `RouterCdnDistribution` (the environment value), and nothing under `Router` depends on anything under `Http` or `Site`. The test "no cycle" checks this.
- The distribution's domain is known as soon as it is created (`waitForDeployment: false`), so the Function does not wait for propagation.
- **Two-phase fallback (aws.md:68): not needed.** If a later SST made it necessary: deploy step 5 with `FRAMEWORK_PUBLIC_ORIGIN` taken from the previous deploy's `url` output, then, if the output changed (only on the stage's first deploy), run one more `sst deploy` with the new literal value. Root cause 2026-10-23-pass1 showed that SST targets resolve only against stored state; the same applies here, so this second run is untargeted.

### Q2. Is the credentials secret SST-created, and which transform sets its recovery window? **SST-created; no transform. It is 0 already.**
- `aurora.ts:890-912` `createSecret()` always runs for a non-`ref`, non-`dev` Aurora:
  - `new secretsmanager.Secret(`${name}ProxySecret`, { recoveryWindowInDays: 0 })`;
  - plus `SecretVersion` holding `{username, password}`.
- The cluster's `masterPassword` is SST's `RandomPassword` `DatabasePassword` (or `args.password`), and `manageMasterUserPassword` is never set. So this is not an RDS-managed secret, and the password is also in SST's encrypted state.
- The cluster is tagged `sst:ref:password = <secret ARN>`.
- `AuroraArgs.transform` (`aurora.ts:455-479`) covers `subnetGroup`, `clusterParameterGroup`, `instanceParameterGroup`, `cluster`, `instance` and `proxy` only. There is no secret transform.
  - The only way to change the secret's arguments is a global `$transform(aws.secretsmanager.Secret, …)` (`component.ts:465-488`, a stack transformation that runs after the component's naming transform). The program uses it only to set the name.
- With the window at 0, the provider deletes the secret without recovery when `sst remove` destroys it. The provider documents this (`@pulumi/aws/secretsmanager/secret.d.ts:77`: "`0` to force deletion without recovery"), and `ForceDeleteWithoutRecovery` appears in the cached `pulumi-resource-aws` v7.20.0 binary.
- So `remove` gets force deletion through SST. Its by-name fallback must call `DeleteSecret` with `ForceDeleteWithoutRecovery: true`.
- Not verified here: whether `CreateSecret` with the same name succeeds immediately after a forced delete. AWS deletes asynchronously. Check it in phase L (deploy right after remove).
- The Data API needs the secret's **full** ARN, which has a random 6-character suffix. The program does not read it from the component's output, because that would make the Function a dependent of `Database` (Q3). It is read back from step 3's `databaseSecretArn` output and passed in as a literal.

### Q3. How does `--target` behave for step 3 on AWS? **As on Cloudflare, plus two binding consequences.**
- **Source.** The lookup is in the target-neutral `run.go:348-360`: each `--target` name is matched by `URN.Name()` against `completed.Resources` of the pulled checkpoint, and SST then adds `--target-dependents`.
  - On AWS the checkpoint is `app/<app>/<stage>.json` in the state bucket (`aws.go:547`, `getData` `:555-580`). A missing key returns `nil`, `PullState` turns that into `ErrStateNotFound` (`provider.go:254-262`), and `run.go:98-121` runs `pulumi stack init`. So `Resources` is empty and every target fails with `Target not found`.
  - `--target` takes a comma-separated list (`deploy.go:152-155`).
  - `--exclude` exists too, with `--exclude-dependents` (`run.go:362-375`).
- **Local experiment** (`target-experiment/`; pinned binary, `home: "local"`, `random` provider, offline). Components: `Files` (RandomPet) with child `FilesChild`; `Database` (a ComponentResource) with child `DatabaseCluster`; `FnEdge`, whose keepers use `files.id` and `cluster.result`; `FnLiteral`, which uses literal strings only; `Router`; `FnRouter`, which depends on `Router`.

  | Run | Inputs changed | Command | Result |
  | --- | --- | --- | --- |
  | r1 | — (new stage) | `deploy --target Files,Database` | exit 1, `✕  Target not found: Files` |
  | r2 | — | `deploy` | all 9 created |
  | r3 | code, Database child, Files child, Router | `deploy --target Files,Database` | `FilesChild`, `DatabaseCluster` replaced (**children of a target are included**). `FnEdge` replaced with the **new code** (dependent of a changed target). `FnLiteral`, `Router`, `FnRouter` untouched. |
  | r4 | code only | `deploy --target Files,Database` | **`FnEdge` replaced with the new code although neither target changed.** Nothing else touched. |
  | r5 | — | `remove` | all deleted |

- **Consequences for the AWS step 3.**
  1. First deploy (the stage has no database): an **untargeted** deploy of the step-3 program, which declares `Files` and `Database` only. Later deploys: `--target Files,Database` with the full program. This is the DEC-0427 rule applied to AWS, and its guards apply here too:
     - choose the target from "the stage has a database";
     - refuse a database without code;
     - before an untargeted step 3, refuse if the Function exists. An untargeted run deletes Router, Site and Http from state.
  2. Nothing under Http, Site or Router may take a component **output** of `Files` or `Database`. They must use literal names and ARNs (inputs), or `--target-dependents` ships the new Lambda code in step 3 and breaks PROV-REQ-002 step 3's "no new app code".
     - `structure.test.mjs` "step 3 safety" checks this over the recorded edges.
     - Its negative control (`out/edge`: `EDGE: database.secretArn` in the environment, `logs/mocks-edge-negative.json`) fails it: `HttpFunction reaches Database`.
  3. `FilesLinkRef` and `DatabaseLinkRef` (`sst:sst:LinkRef`, created for every linkable component) are dependents of the targets and are updated in step 3. They are harmless: they hold no code.
  4. The Function's dependence on the Router is fine. The Router is never a step-3 target.

### Q4. How is `home: "aws"` bootstrapped, and what does it create?
- **When.** `Project.LoadHome` (`project.go:368-418`) runs for every command that uses `cli.InitProject` (`cli.go:51-122`): deploy, remove, diff, refresh, unlock, secret and others. `sst install` uses `project.New` only (`main.go:667-700`), so it makes **no AWS call**.
  - LoadHome calls `AwsProvider.Init` for `providers.aws` (`aws.go:64-136`). Init loads the default credential chain (or the profile or `assumeRoles`), takes the region from the provider args (default `us-east-1`), adds the default tags `sst:app`/`sst:stage`, and calls `Bootstrap(region)`. Then `home.Bootstrap()` runs the same code for the provider's region.
- **What** (`aws.go:142-201`, steps `:284-531`, applied once and versioned):
  - `ssm:GetParameter /sst/bootstrap` (String). If it is missing, or its `version` is below 5, the remaining steps run:
    0. `CreateBucket sst-asset-<rand12>`, plus an empty `PutBucketNotificationConfiguration`; `CreateBucket sst-state-<rand12>`, plus `PutBucketVersioning Enabled`.
    1. `ecr:CreateRepository sst-asset` (or `DescribeRepositories` if it exists).
    2. Legacy cleanup of `/sst/bootstrap/asset`.
    3. `PutBucketPolicy` on both buckets: deny `s3:*` when `aws:SecureTransport` is false.
    4. No-op.
  - Then `PutParameter /sst/bootstrap = {"version":5,"asset","assetEcrRegistryId","assetEcrUrl","state",…}` (Overwrite). This is per region.
- **Per stage:**
  - SSM SecureString `/sst/passphrase/<app>/<stage>` ("DO NOT DELETE…", `aws.go:551, 892-903`);
  - state objects in the state bucket: `app/<app>/<stage>.json`, `secret/<app>/<stage>.json`, `update/<app>/<stage>/…`, `summary/…`, `eventlog/…`, `snapshot/…` (`aws.go:547, 795-816`).
  - Function code zips go to the **asset** bucket (`HttpCode` above), so every deploy needs the bootstrap whatever the home.
- **Removal.** After a `remove` that leaves zero resources:
  - with `state.purge`: SST deletes those prefixes and the passphrase (`run.go:673-682`, `provider.go:192-204`, `aws.go:795-816`). This needs `s3:DeleteObjectVersion` and `s3:ListBucketVersions` (`config.ts:312-342`). The program sets `state: { purge: true }`.
  - without it: only `eventlog/` and `snapshot/` are cleaned.
  - The passphrase is **outside** `/<app>/<stage>/`, so `remove`'s SSM deletion does not cover it.
- **For `setupAccount`** (provisioning.md:58: it "bootstraps" the state home). The cheapest way to make SST bootstrap the region without deploying anything: write a minimal app (`home: "aws"`, `providers.aws.region`) and run `sst unlock --stage <setup>`. It is `InitProject` plus `ForceUnlock` (`main.go:862-889`), so its only stage effect is deleting a lock that does not exist. Then read `/sst/bootstrap` and record or verify the state bucket (owner check: `GetBucketLocation` and `HeadBucket` with `x-amz-expected-bucket-owner`). This is unverified until phase L.
- IAM the deployer needs for the bootstrap: `ssm:GetParameter`/`PutParameter`, `s3:CreateBucket`/`PutBucketVersioning`/`PutBucketPolicy`/`PutBucketNotification`, `ecr:CreateRepository`/`DescribeRepositories`.

## 4. Other findings
1. **SST 4.17.2 Lambda trust policy.** `function.ts:2279` reads `assumeRolePolicy: !dev ? assumeRolePolicyForPrincipal(lambda) : getPolicyDocumentOutput({lambda, arn:…:iam::<acct>:root})`, but there `dev` is the `Output` from `normalizeDev()` (`:1752`). An Output is always truthy, so SST always writes the dev policy, which also trusts the account root.
   - The first mock run showed it: the role trusted `lambda.amazonaws.com` and `arn:aws:iam::123456789012:root`.
   - The program sets `transform.role` to the Lambda-only policy, and a test checks it. This is relevant to AWS-AC-003.
2. **Function URL CORS** defaults to `allowOrigins/Methods/Headers: ["*"]` (`function.ts:1985-2003`). The program sets `cors: false`, so the Function URL adds no CORS headers of its own.
3. **Routing.**
   - The router function matches `/api` only as `/api` or `/api/…` (`router.ts:2165-2200`, longest prefix wins). The path is passed through unchanged.
   - The Site route has no prefix.
   - The SPA fallback is the router function's `custom404: "/index.html"` for the site route (`static-site.ts:1051`, `router.ts:2784`). The distribution has no `customErrorResponses`, so API 403/404 bodies pass unchanged (aws.md §2, AWS-AC-001).
4. **PAR-271 = 60 s is SST's and CloudFront's maximum** for `readTimeout` ("between 1 and 60 seconds", `router.ts:3153-3156`). It is applied per route through KV metadata, while the distribution's default origin keeps 20 s.
5. **PAR-110 version as an input.** With `version` set, SST stops ignoring `engineVersion` and `family` changes (`aurora.ts:941, 967, 1021`), so a different minor in the input means an in-place upgrade.
6. **Lambda memory** defaults to 1024 MB. G-S1 will set a PAR for it.
7. **SST adds `SST_KEY`, `SST_KEY_FILE` and `SST_RESOURCE_App`** to the environment, plus a stack-level `RandomBytes`, even without `link`. They are harmless. `SECRET_*` names are refused by the generator.
8. **Initial database.** Aurora's `databaseName` defaults to the app name (`reference`), so the cluster comes with one database the CLI does not own. The CLI's create, copy and drop statements run connected to `postgres` (migrations.md:86-91), so this does not get in the way.

## Files
- `program.ts`, `generate.ts`: the generator and the two inputs. `out/sst.config.ts` and `out/step3/sst.config.ts` are the generated programs (absolute fixture paths).
- `setup-platform.mjs`, `typecheck.sh`, `tsconfig.typecheck.json`, `tsconfig.negative.json`, `negative.sst.config.ts.txt`: the type-check.
- `mocks/run-mocks.mjs`, `mocks/structure.test.mjs`, `mocks.sh`: the mocks and the structural tests. `logs/`: their output.
- `target-experiment/`: the `--target` experiment's program, runner and run logs (SST's `level=` lines removed).
- `sst-src-v4.17.2/`: the SST Go sources cited above.

No cloud resources were created. The local experiment stage `gs2tgt/s1` was removed (r5). Its state lives only under `~/.config/sst/state` (`home: "local"`).
