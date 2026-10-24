/// <reference path="./.sst/platform/config.d.ts" />
// Generated (G-S2 spike) for stage test-abc. Do not edit.
type Seconds = `${number} seconds`;
interface StageInput {
  app: string;
  region: string;
  provider: string;
  names: { filesBucket: string; logBucket: string; cluster: string; clusterArn: string; databaseSecret: string; function: string; secretsPath: string };
  vpc: { subnets: string[]; securityGroups: string[] };
  auroraVersion: string;
  scaling: { min: `${number} ACU`; max: `${number} ACU`; pauseAfter: `${number} minutes` };
  infrastructure: string[];
  code: null | {
    bundle: string;
    handler: string;
    assetsDirectory: string | null;
    environment: Record<string, string>;
    timeout: Seconds;
    readTimeout: Seconds;
    permissions: { actions: string[]; resources: string[] }[];
  };
}
const input: StageInput = {
  "app": "reference",
  "region": "us-east-1",
  "provider": "7.20.0",
  "names": {
    "filesBucket": "reference-test-abc-files-123456789012",
    "logBucket": "prototype-logs-123456789012",
    "cluster": "reference-test-abc",
    "clusterArn": "arn:aws:rds:us-east-1:123456789012:cluster:reference-test-abc",
    "databaseSecret": "reference-test-abc-database-credentials",
    "function": "reference-test-abc-http",
    "secretsPath": "/reference/test-abc/secrets/"
  },
  "vpc": {
    "subnets": [
      "subnet-0aaa",
      "subnet-0bbb"
    ],
    "securityGroups": [
      "sg-0ccc"
    ]
  },
  "auroraVersion": "17.5",
  "scaling": {
    "min": "0 ACU",
    "max": "4 ACU",
    "pauseAfter": "5 minutes"
  },
  "infrastructure": [
    "Files",
    "Database"
  ],
  "code": null
};

export default $config({
  app() {
    return {
      name: input.app,
      removal: "remove",
      home: "aws",
      // A remove that leaves no resources also deletes the stage's state objects and its
      // /sst/passphrase/<app>/<stage> parameter (run.go:673-682, provider.go:192-204).
      state: { purge: true },
      providers: { aws: { version: input.provider, region: input.region as aws.Region } },
    };
  },
  async run() {
    // The Aurora credentials secret has no component transform; name it so remove and
    // listStageResources can find it by exact name.
    $transform(aws.secretsmanager.Secret, (args, _opts, name) => {
      if (args && name === "DatabaseProxySecret") args.name = input.names.databaseSecret;
    });

    new sst.aws.Bucket("Files", {
      transform: { bucket: (args) => { args.bucket = input.names.filesBucket; } },
    });

    const database = new sst.aws.Aurora("Database", {
      engine: "postgres",
      version: input.auroraVersion,
      dataApi: true,
      scaling: input.scaling,
      vpc: input.vpc,
      transform: {
        cluster: (args) => {
          args.clusterIdentifier = input.names.cluster;
          args.skipFinalSnapshot = true;
          args.deletionProtection = false;
        },
      },
    });

    const c = input.code;
    if (!c) return { databaseSecretArn: database.secretArn, clusterArn: database.clusterArn };

    const router = new sst.aws.Router("Router");
    if (c.assetsDirectory !== null) {
      new sst.aws.StaticSite("Site", { path: c.assetsDirectory, router: { instance: router } });
    }
    const http = new sst.aws.Function("Http", {
      name: input.names.function,
      bundle: c.bundle,
      handler: c.handler,
      runtime: "nodejs22.x",
      architecture: "arm64",
      timeout: c.timeout,
      environment: { ...c.environment, FRAMEWORK_PUBLIC_ORIGIN: router.url },
      permissions: c.permissions,
      url: {
        cors: false,
        router: { instance: router, path: "/api", readTimeout: c.readTimeout },
      },
      transform: {
        // SST 4.17.2 function.ts createRole tests `!dev` on an Output (always truthy), so it always
        // writes the dev trust policy, which also trusts the account root. Trust Lambda only.
        role: (args) => {
          args.assumeRolePolicy = aws.iam.assumeRolePolicyForPrincipal({ Service: "lambda.amazonaws.com" });
        },
      },
    });
    return { databaseSecretArn: database.secretArn, clusterArn: database.clusterArn, url: router.url, functionUrl: http.url };
  },
});
