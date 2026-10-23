/// <reference path="./.sst/platform/config.d.ts" />

// Spike A-03: does an SST/Pulumi update of a Worker keep secrets that were set
// separately through the Cloudflare API?
// A03_VARIANT selects the handler file and a plain-text variable, so successive
// deploys change the script content and its bindings.
// A03_NOKV=1 drops the KV link (a binding-set change).
// A03_KEEP=1 applies the candidate fallback (see RESULT.md) through a transform.
export default $config({
  app(input) {
    return {
      name: "spikeuekwqgqb",
      removal: "remove",
      home: "cloudflare",
      providers: {
        cloudflare: "6.15.0",
      },
    };
  },
  async run() {
    const variant = process.env.A03_VARIANT ?? "v1";
    const kv = new sst.cloudflare.Kv("Kv");
    const worker = new sst.cloudflare.Worker("Api", {
      handler: `src/${variant.startsWith("v1") ? "v1" : "v2"}.ts`,
      url: true,
      link: process.env.A03_NOKV === "1" ? [] : [kv],
      environment: { SPIKE_VARIANT: variant },
      transform: process.env.A03_KEEP === "1"
        ? {
            worker: (args: any) => {
              args.keepBindings = ["secret_text", "secret_key"];
            },
          }
        : undefined,
    });
    return { url: worker.url };
  },
});
