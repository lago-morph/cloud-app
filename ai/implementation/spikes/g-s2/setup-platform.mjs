// G-S2: builds out/.sst/platform from a cached SST 4.17.2 platform (no network, no `sst install`).
// Usage: node setup-platform.mjs <cached .sst/platform dir>
// Every entry is symlinked except config.d.ts, which is written as `sst install` writes it for
// `providers: { aws }` (same template as the generated random/cloudflare ones in the cache).
import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cached = resolve(process.argv[2] ?? "");
if (readFileSync(join(cached, "version"), "utf8").trim() !== "4.17.2") throw new Error("cached platform is not SST 4.17.2");
const awsVersion = JSON.parse(readFileSync(join(cached, "node_modules/@pulumi/aws/package.json"), "utf8")).version;
if (awsVersion !== "7.20.0") throw new Error(`@pulumi/aws ${awsVersion}, expected 7.20.0 (PAR-109)`);

const target = join(here, "out/.sst/platform");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const entry of readdirSync(cached)) {
  if (entry === "config.d.ts" || entry.startsWith("sst.config.")) continue;
  symlinkSync(join(cached, entry), join(target, entry));
}
writeFileSync(
  join(target, "config.d.ts"),
  `import "./src/global.d.ts"
import "../types.generated"
import { AppInput, App, Config } from "./src/config"
import * as _aws from "@pulumi/aws";


declare global {
  // @ts-expect-error
  export import aws = _aws
  interface Providers {
    providers?: {
      "aws"?:  (_aws.ProviderArgs & { package?: string, version: string }) | string;
    }
  }
  export const $config: (
    input: Omit<Config, "app"> & {
      app(input: AppInput): Promise<Omit<App, "providers"> & Providers> | (Omit<App, "providers"> & Providers);
    },
  ) => Config;
}
`,
);
console.log(`platform view at ${target} (SST 4.17.2, @pulumi/aws ${awsVersion})`);
