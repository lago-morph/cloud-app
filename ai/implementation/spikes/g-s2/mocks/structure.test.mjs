// G-S2 structural tests over the Pulumi-mock reports written by run-mocks.mjs (node --test).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const load = (f) => JSON.parse(readFileSync(new URL(`../logs/${f}`, import.meta.url), "utf8"));
const full = load(process.env.G_S2_FULL ?? "mocks-full.json");
const step3 = load("mocks-step3.json");
const byName = (r) => new Map(r.resources.map((x) => [x.name, x]));
const F = byName(full);
const inputs = (n) => F.get(n).inputs;

/** Name of the top-level component a resource belongs to (walks parents up to the stack). */
function topOf(map, name) {
  let cur = map.get(name);
  while (cur && cur.parent && map.get(cur.parent) && map.get(cur.parent).type !== "pulumi:pulumi:Stack") cur = map.get(cur.parent);
  return cur?.name;
}
/** Transitive dependencies of `name`, including parents (Pulumi counts both for --target-dependents). */
function closure(map, name, seen = new Set()) {
  const r = map.get(name);
  if (!r) return seen;
  for (const d of [...r.dependsOn, ...(r.parent ? [r.parent] : [])]) {
    if (!seen.has(d) && map.has(d) && map.get(d).type !== "pulumi:pulumi:Stack") {
      seen.add(d);
      closure(map, d, seen);
    }
  }
  return seen;
}

test("both programs evaluate under mocks without error", () => {
  assert.equal(full.error, null);
  assert.equal(step3.error, null);
});

test("full program: exactly these custom resources (type, name)", () => {
  const got = full.resources.filter((r) => r.custom).map((r) => `${r.type} ${r.name}`).sort();
  const want = [
    "aws:cloudfront/cachePolicy:CachePolicy RouterServerCachePolicy",
    "aws:cloudfront/distribution:Distribution RouterCdnDistribution",
    "aws:cloudfront/function:Function RouterCloudfrontFunctionRequest",
    "aws:cloudfront/keyValueStore:KeyValueStore RouterKvStore",
    "aws:cloudwatch/logGroup:LogGroup HttpLogGroup",
    "aws:iam/role:Role HttpRole",
    "aws:lambda/function:Function HttpFunction",
    "aws:lambda/functionUrl:FunctionUrl HttpUrl",
    "aws:lambda/permission:Permission HttpPublicFunctionUrlAccess",
    "aws:lambda/permission:Permission HttpPublicInvokeFunction",
    "aws:rds/cluster:Cluster DatabaseCluster",
    "aws:rds/clusterInstance:ClusterInstance DatabaseInstance",
    "aws:rds/clusterParameterGroup:ClusterParameterGroup DatabaseClusterParameterGroup",
    "aws:rds/parameterGroup:ParameterGroup DatabaseParameterGroup",
    "aws:rds/subnetGroup:SubnetGroup DatabaseSubnetGroup",
    "aws:s3/bucket:Bucket FilesBucket",
    "aws:s3/bucket:Bucket SiteAssetsBucket",
    "aws:s3/bucketCorsConfiguration:BucketCorsConfiguration FilesCors",
    "aws:s3/bucketCorsConfiguration:BucketCorsConfiguration SiteAssetsCors",
    "aws:s3/bucketObjectv2:BucketObjectv2 HttpCode",
    "aws:s3/bucketPolicy:BucketPolicy FilesPolicy",
    "aws:s3/bucketPolicy:BucketPolicy SiteAssetsPolicy",
    "aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock FilesPublicAccessBlock",
    "aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock SiteAssetsPublicAccessBlock",
    "aws:secretsmanager/secret:Secret DatabaseProxySecret",
    "aws:secretsmanager/secretVersion:SecretVersion DatabaseProxySecretVersion",
    "pulumi-nodejs:dynamic:Resource HttpRouteKey.sst.aws.KvKeys",
    "pulumi-nodejs:dynamic:Resource HttpRoutesUpdate.sst.aws.KvRoutesUpdate",
    "pulumi-nodejs:dynamic:Resource RouterCdnWaiter.sst.aws.DistributionDeploymentWaiter",
    "pulumi-nodejs:dynamic:Resource SiteAssetFiles.sst.aws.BucketFiles",
    "pulumi-nodejs:dynamic:Resource SiteInvalidation.sst.aws.DistributionInvalidation",
    "pulumi-nodejs:dynamic:Resource SiteKvKeys.sst.aws.KvKeys",
    "pulumi-nodejs:dynamic:Resource SiteRoutesUpdate.sst.aws.KvRoutesUpdate",
    "random:index/randomBytes:RandomBytes LambdaEncryptionKey",
    "random:index/randomPassword:RandomPassword DatabasePassword",
  ];
  assert.deepEqual(got, want);
});

test("no NAT gateway, no VPC resource, no VPC-attached Lambda (AWS-AC-002 shape)", () => {
  assert.ok(!full.resources.some((r) => r.type.startsWith("aws:ec2/")));
  assert.equal(inputs("HttpFunction").vpcConfig, undefined);
  assert.deepEqual(inputs("DatabaseCluster").vpcSecurityGroupIds, ["sg-0ccc"]);
  assert.deepEqual(inputs("DatabaseSubnetGroup").subnetIds, ["subnet-0aaa", "subnet-0bbb"]);
});

test("Function: bundle, runtime, timeout PAR-270, env with router.url, no link resources", () => {
  const f = inputs("HttpFunction");
  assert.equal(f.name, "reference-test-abc-http");
  assert.equal(f.runtime, "nodejs22.x");
  assert.deepEqual(f.architectures, ["arm64"]);
  assert.equal(f.timeout, 55);
  assert.equal(f.handler, "index.handler");
  const env = f.environment.variables;
  assert.equal(env.FRAMEWORK_PUBLIC_ORIGIN, "https://d111111abcdef8.cloudfront.net");
  assert.ok(!Object.keys(env).some((k) => k.startsWith("SECRET_")));
  assert.deepEqual(Object.keys(env).filter((k) => k.startsWith("SST_RESOURCE_")), ["SST_RESOURCE_App"]);
  const build = full.rpcCalls.find((c) => c.method === "Runtime.Build").params;
  assert.match(build.bundle, /fixture\/bundle$/);
  assert.deepEqual(build.links, {});
});

test("Function role: trusts Lambda only; inline policy is exactly the explicit permissions", () => {
  const role = inputs("HttpRole");
  assert.deepEqual(role.assumeRolePolicy.Statement.map((s) => s.Principal), [{ Service: "lambda.amazonaws.com" }]);
  assert.deepEqual(role.managedPolicyArns, ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]);
  const doc = JSON.parse(role.inlinePolicies[0].policy);
  const resources = doc.Statement.flatMap((s) => s.resources).sort();
  assert.deepEqual(resources, [
    "arn:aws:rds:us-east-1:123456789012:cluster:reference-test-abc",
    "arn:aws:s3:::prototype-logs-123456789012/reference/test-abc/*",
    "arn:aws:s3:::reference-test-abc-files-123456789012",
    "arn:aws:s3:::reference-test-abc-files-123456789012/*",
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:reference-test-abc-database-credentials-AbCdEf",
    "arn:aws:ssm:us-east-1:123456789012:parameter/reference/test-abc/secrets/*",
  ]);
  assert.ok(doc.Statement.every((s) => s.effect === "Allow" && !s.actions.some((a) => a.includes("*"))));
});

test("Function URL: public (no OAC), no Lambda-level CORS; router route /api with readTimeout PAR-271", () => {
  assert.equal(inputs("HttpUrl").authorizationType, "NONE");
  assert.equal(inputs("HttpUrl").cors, undefined);
  assert.equal(inputs("HttpRoutesUpdate.sst.aws.KvRoutesUpdate").entry.split(",")[3], "/api");
  const meta = JSON.parse(inputs("HttpRouteKey.sst.aws.KvKeys").entries.metadata);
  assert.equal(meta.origin.timeouts.readTimeout, 60);
});

test("Site: on the router; SPA fallback via the router function, no distribution custom error responses", () => {
  const meta = JSON.parse(inputs("SiteKvKeys.sst.aws.KvKeys").entries.metadata);
  assert.equal(meta.custom404, "/index.html");
  assert.equal(meta.errorResponseCode, undefined);
  assert.deepEqual(inputs("RouterCdnDistribution").customErrorResponses ?? [], []);
});

test("Aurora: Data API, 0-4 ACU, pause 300 s, fixed id, no final snapshot, no deletion protection", () => {
  const c = inputs("DatabaseCluster");
  assert.equal(c.engine, "aurora-postgresql");
  assert.equal(c.engineVersion, "17.5");
  assert.equal(c.enableHttpEndpoint, true);
  assert.deepEqual(c.serverlessv2ScalingConfiguration, { maxCapacity: 4, minCapacity: 0, secondsUntilAutoPause: 300 });
  assert.equal(c.clusterIdentifier, "reference-test-abc");
  assert.equal(c.skipFinalSnapshot, true);
  assert.equal(c.deletionProtection, false);
  assert.equal(c.manageMasterUserPassword, undefined);
  assert.equal(inputs("DatabaseInstance").instanceClass, "db.serverless");
});

test("credentials secret: SST-created, fixed name, recovery window 0", () => {
  assert.deepEqual(inputs("DatabaseProxySecret"), { name: "reference-test-abc-database-credentials", recoveryWindowInDays: 0 });
  assert.equal(F.get("DatabaseProxySecret").parent, "Database");
});

test("Files bucket: fixed name, forceDestroy", () => {
  assert.deepEqual(inputs("FilesBucket"), { bucket: "reference-test-abc-files-123456789012", forceDestroy: true });
});

test("step 3 safety: nothing of Http, Site or Router depends on Files or Database (no --target-dependents edge)", () => {
  for (const r of full.resources) {
    const top = topOf(F, r.name);
    if (!["Http", "Site", "Router"].includes(top)) continue;
    const reach = [...closure(F, r.name)].map((d) => topOf(F, d));
    assert.ok(!reach.includes("Files") && !reach.includes("Database"), `${r.name} reaches ${reach.join(",")}`);
  }
});

test("no cycle: the Router depends on nothing of Http or Site; the Function depends on the Router", () => {
  for (const r of full.resources.filter((x) => topOf(F, x.name) === "Router")) {
    const reach = [...closure(F, r.name)].map((d) => topOf(F, d));
    assert.ok(!reach.includes("Http") && !reach.includes("Site"), `${r.name} reaches ${reach.join(",")}`);
  }
  assert.ok(F.get("HttpFunction").dependsOn.includes("RouterCdnDistribution"));
});

test("first-deploy step 3 program: only Files and Database (plus their link refs)", () => {
  const tops = new Set(step3.resources.filter((r) => r.type !== "pulumi:pulumi:Stack").map((r) => topOf(byName(step3), r.name)));
  assert.deepEqual([...tops].sort(), ["Database", "DatabaseLinkRef", "Files", "FilesLinkRef"]);
  assert.equal(step3.rpcCalls.length, 0);
});
