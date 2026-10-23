/// <reference path="./.sst/platform/config.d.ts" />
// Only `sst install` is run on this (downloads Pulumi + providers); no deploy, no cloud call.
export default $config({
  app() {
    return { name: "spikea10", home: "cloudflare", providers: { cloudflare: "6.15.0" } };
  },
  async run() {},
});
