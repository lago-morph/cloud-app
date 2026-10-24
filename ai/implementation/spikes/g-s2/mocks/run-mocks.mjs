// G-S2: evaluates a generated sst.config.ts under Pulumi mocks, offline.
// Usage: node mocks/run-mocks.mjs <out/xxx.sst.config.ts> <report.json>
// Run it as `unshare -rn sh ../../../../scripts/offline.sh node mocks/run-mocks.mjs …` so no network exists.
//
// It reproduces what SST 4.17.2 does in pkg/project/run.go:160-188 (fetched source, see RESULT.md):
// esbuild-bundles `import { run } from "platform/src/auto/run.ts"; import mod from "<config>";
// export default await run(mod.run)` with `$app`/`$cli`/`$dev` defined, `platform/src/shim/run.js`
// injected and the provider namespaces (`aws`, `sst`) as globals. Instead of the Pulumi engine
// and the SST CLI's RPC server it uses `runtime.setMocks` and a local RPC stub for the three
// RPC methods the components call: Provider.Aws.Bootstrap, Runtime.Build (and Provider.Aws.Appsync,
// which is lazy and unused outside dev).
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

for (const k of Object.keys(process.env)) if (k.startsWith("AWS_")) delete process.env[k];

const configPath = resolve(process.argv[2]);
const reportPath = resolve(process.argv[3]);
// js.go's InjectGlobals skips any path containing ".sst", so the file must be named sst.config.ts.
if (!configPath.endsWith("/sst.config.ts")) throw new Error("the program must be a file named sst.config.ts");
const root = dirname(configPath);
const platform = join(root, ".sst/platform");
const require = createRequire(join(platform, "package.json"));
const esbuild = require("esbuild");
const REGION = "us-east-1";
const ACCOUNT = "123456789012";

// Pulumi stack config, as SST passes it (aws:region from the provider args).
process.env.PULUMI_CONFIG = JSON.stringify({ "aws:region": REGION });

// --- RPC stub (the SST CLI's server, rpc.ts: POST /rpc, {method, params:[args]}) ---
const rpcCalls = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const { method, params } = JSON.parse(body);
    rpcCalls.push({ method, params: params[0] });
    let result;
    if (method === "Provider.Aws.Bootstrap") result = { asset: "sst-asset-mock000000", assetEcrRegistryId: ACCOUNT, assetEcrUrl: `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/sst-asset`, state: "sst-state-mock000000" };
    else if (method === "Runtime.Build") result = { handler: params[0].handler, out: params[0].bundle, errors: [], sourcemaps: [] };
    else return res.end(JSON.stringify({ error: `rpc: can't find method ${method}` }));
    res.end(JSON.stringify({ result }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.SST_SERVER = `http://127.0.0.1:${server.address().port}`;

// --- Bundle like SST ---
const work = join(root, ".sst");
mkdirSync(join(work, "artifacts"), { recursive: true });
const app = { name: "reference", stage: "test-abc", removal: "remove", home: "aws", protect: false, providers: { aws: { version: "7.20.0", region: REGION } } };
const cli = { command: "deploy", dev: false, paths: { home: join(process.env.HOME ?? "/root", ".config/sst"), root, work, platform }, state: { version: {} } };
// pkg/js/js.go: the provider shim is prepended to every loaded file outside `.sst` (the config).
const providerShim = `import * as aws from "@pulumi/aws";\nimport * as sst from ${JSON.stringify(join(platform, "src/components"))};\n`;
const injectGlobals = {
  name: "InjectGlobals",
  setup(build) {
    build.onLoad({ filter: /\.(js|ts|jsx|tsx)$/ }, async (args) => {
      if (args.path.startsWith(work) || args.path.includes(".sst")) return undefined;
      const { readFileSync } = await import("node:fs");
      return { contents: providerShim + readFileSync(args.path, "utf8"), loader: "default" };
    });
  },
};
const outfile = join(platform, `g-s2-eval.${Date.now()}.mjs`);
await esbuild.build({
  stdin: {
    contents: `import { run } from ${JSON.stringify(join(platform, "src/auto/run.ts"))};\nimport mod from ${JSON.stringify(configPath)};\nconst result = await run(mod.run);\nexport default result;\n`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  mainFields: ["module", "main"],
  nodePaths: [join(platform, "node_modules")],
  external: ["@pulumi/*", "undici", "@pulumiverse/*", "@sst-provider/*", "@aws-sdk/*", "esbuild", "archiver", "glob", "vite"],
  plugins: [injectGlobals],
  outfile,
  define: { $app: JSON.stringify(app), $cli: JSON.stringify(cli), $dev: "false" },
  inject: [join(platform, "src/shim/run.js")],
  banner: {
    js: `import { createRequire as topLevelCreateRequire } from 'module';
const require = topLevelCreateRequire(import.meta.url);
import { fileURLToPath as topLevelFileUrlToPath, URL as topLevelURL } from "url"
const __filename = topLevelFileUrlToPath(import.meta.url)
const __dirname = topLevelFileUrlToPath(new topLevelURL(".", import.meta.url))
`,
  },
  logLevel: "error",
});

// --- Mocks ---
const pulumi = require("@pulumi/pulumi");
// Record the dependency edges the SDK sends to the engine (the mock interface does not expose them):
// parent, `dependsOn`-style dependencies and per-property dependencies, by URN.
const edges = new Map();
const { MockMonitor } = require("@pulumi/pulumi/runtime/mocks");
const originalRegister = MockMonitor.prototype.registerResource;
MockMonitor.prototype.registerResource = function (req, callback) {
  const propertyDeps = {};
  req.getPropertydependenciesMap().forEach((v, k) => (propertyDeps[k] = v.getUrnsList()));
  edges.set(`${req.getName()}|${req.getType()}`, { parent: req.getParent(), dependencies: req.getDependenciesList(), propertyDeps });
  return originalRegister.call(this, req, callback);
};
const registrations = [];
const parents = new Map();
let n = 0;
const computed = (type, name, inputs) => {
  const id = `${name}-id`;
  const arnOf = (svc, res) => `arn:aws:${svc}:${REGION}:${ACCOUNT}:${res}`;
  switch (type) {
    case "aws:s3/bucket:Bucket": return { id: inputs.bucket, arn: `arn:aws:s3:::${inputs.bucket}`, bucketRegionalDomainName: `${inputs.bucket}.s3.${REGION}.amazonaws.com`, bucket: inputs.bucket };
    case "aws:rds/cluster:Cluster": return { id: inputs.clusterIdentifier, arn: arnOf("rds", `cluster:${inputs.clusterIdentifier}`), endpoint: "mock.cluster", readerEndpoint: "mock.reader", port: 5432, engine: inputs.engine, engineVersion: inputs.engineVersion };
    case "aws:secretsmanager/secret:Secret": return { id: arnOf("secretsmanager", `secret:${inputs.name}-AbCdEf`), arn: arnOf("secretsmanager", `secret:${inputs.name}-AbCdEf`) };
    case "aws:lambda/function:Function": return { id: inputs.name, arn: arnOf("lambda", `function:${inputs.name}`), qualifiedArn: arnOf("lambda", `function:${inputs.name}:$LATEST`), invokeArn: "mock", version: "$LATEST" };
    case "aws:lambda/functionUrl:FunctionUrl": return { id, functionUrl: `https://${name.toLowerCase()}mock.lambda-url.${REGION}.on.aws/` };
    case "aws:cloudfront/distribution:Distribution": return { id: "E2MOCKDIST", arn: `arn:aws:cloudfront::${ACCOUNT}:distribution/E2MOCKDIST`, domainName: "d111111abcdef8.cloudfront.net" };
    case "aws:cloudfront/keyValueStore:KeyValueStore": return { id, arn: `arn:aws:cloudfront::${ACCOUNT}:key-value-store/${id}` };
    case "aws:cloudfront/function:Function": return { id, arn: `arn:aws:cloudfront::${ACCOUNT}:function/${inputs.name ?? id}` };
    case "aws:iam/role:Role": return { id: inputs.name ?? id, arn: `arn:aws:iam::${ACCOUNT}:role/${inputs.name ?? id}`, name: inputs.name ?? id };
    case "random:index/randomPassword:RandomPassword": return { id, result: "mock-password" };
    case "random:index/randomBytes:RandomBytes": return { id, base64: "bW9jaw==", hex: "6d6f636b" };
    default: return { id, arn: arnOf("mock", `${type}/${name}`) };
  }
};
await pulumi.runtime.setMocks(
  {
    newResource(args) {
      const extra = computed(args.type, args.name, args.inputs);
      registrations.push({ seq: n++, type: args.type, name: args.name, custom: args.custom, inputs: args.inputs });
      return { id: extra.id ?? `${args.name}-id`, state: { ...args.inputs, ...extra } };
    },
    call(args) {
      switch (args.token) {
        case "aws:index/getPartition:getPartition": return { partition: "aws", dnsSuffix: "amazonaws.com", id: "aws" };
        case "aws:index/getRegion:getRegion": return { name: REGION, region: REGION, id: REGION };
        case "aws:index/getCallerIdentity:getCallerIdentity": return { accountId: ACCOUNT, arn: `arn:aws:iam::${ACCOUNT}:user/mock`, userId: "mock", id: ACCOUNT };
        // The real data source echoes its inputs (statements, …) and adds `json`.
        case "aws:iam/getPolicyDocument:getPolicyDocument": return { ...args.inputs, json: JSON.stringify({ Version: "2012-10-17", Statement: args.inputs.statements ?? [] }), id: "doc" };
        default: return args.inputs;
      }
    },
  },
  app.name,
  app.stage,
  false,
);
// --- Evaluate (inside a root stack, as the Pulumi language host does) ---
let outputs;
let error;
try {
  outputs = await pulumi.runtime.runInPulumiStack(async () => {
    pulumi.runtime.registerStackTransformation((a) => {
      const p = a.opts?.parent;
      parents.set(a.name + "|" + a.type, p && p.__pulumiType !== "pulumi:pulumi:Stack" ? p.__name ?? null : null);
      return undefined;
    });
    const mod = await import(pathToFileURL(outfile).href);
    return mod.default;
  });
  // Let apply-created resources register.
  for (let i = 0; i < 100; i++) await new Promise((r) => setTimeout(r, 20));
} catch (e) {
  error = String(e?.stack ?? e);
}
server.close();
const urnName = (urn) => urn.split("::").pop();
const tree = registrations.map((r) => {
  const e = edges.get(`${r.name}|${r.type}`) ?? { parent: "", dependencies: [], propertyDeps: {} };
  const deps = new Set([...e.dependencies, ...Object.values(e.propertyDeps).flat()].map(urnName));
  return { ...r, parent: parents.get(r.name + "|" + r.type) ?? (e.parent ? urnName(e.parent) : null), dependsOn: [...deps].sort() };
});
writeFileSync(reportPath, JSON.stringify({ config: configPath, error: error ?? null, outputs: outputs ?? null, rpcCalls, resources: tree }, null, 2));
console.log(error ? `ERROR: ${error.split("\n")[0]}` : `ok: ${tree.length} registrations, ${rpcCalls.length} RPC calls`);
process.exit(error ? 1 : 0);
