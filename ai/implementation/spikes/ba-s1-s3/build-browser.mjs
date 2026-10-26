// Bundle worker-min.js WITHOUT the "workerd"/"node" export conditions (so BA's default hasher resolves to
// @noble/hashes pure-JS scrypt), node:* left external. Probe: does BA run with no Node APIs at all?
import { build } from "esbuild";

const HERE = new URL(".", import.meta.url).pathname;
const r = await build({
  entryPoints: [HERE + "src/worker-min.js"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  conditions: ["worker", "browser"],
  mainFields: ["browser", "module", "main"],
  external: ["node:*"],
  outfile: HERE + "dist-browser/worker-min.js",
  metafile: true,
  minify: false,
  logLevel: "warning",
});
const out = Object.entries(r.metafile.outputs).find(([k]) => k.endsWith(".js"));
console.log("bytes", out[1].bytes, "imports", JSON.stringify(out[1].imports.map((i) => i.path)));
