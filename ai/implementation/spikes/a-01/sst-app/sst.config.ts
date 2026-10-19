/// <reference path="./.sst/platform/config.d.ts" />

// Spike A-01: minimal SST app with Cloudflare state home and one KV namespace
// (SST component) plus one raw Pulumi Cloudflare resource.
export default $config({
  app(input) {
    return {
      name: "spikewxlyyipn",
      removal: "remove",
      home: "cloudflare",
      providers: {
        cloudflare: "6.15.0",
      },
    };
  },
  async run() {
    const kv = new sst.cloudflare.Kv("Kv");
    const raw = new cloudflare.WorkersKvNamespace("RawKv", {
      accountId: process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID!,
      title: `spikewxlyyipn-${$app.stage}-rawkv`,
    });
    return { kvId: kv.id, rawTitle: raw.title };
  },
});
