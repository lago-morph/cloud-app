// Bundle-size breakdown with wrangler-like esbuild settings (conditions workerd,worker,browser; node:* external).
// Prints raw/minified/gzip sizes and the biggest packages; also a baseline without BA (drizzle D1 only).
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = new URL(".", import.meta.url).pathname;
mkdirSync(HERE + "dist-size", { recursive: true });
writeFileSync(
  HERE + "dist-size/baseline.js",
  `import { drizzle } from "drizzle-orm/d1"; import { sql } from "drizzle-orm";
export default { async fetch(r, env) { return Response.json(await drizzle(env.DB).all(sql\`select 1\`)); } };`,
);

async function size(entry, minify) {
  const r = await build({
    entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", write: false, minify, metafile: true,
    conditions: ["workerd", "worker", "browser"], mainFields: ["browser", "module", "main"], external: ["node:*"], logLevel: "error",
  });
  const code = r.outputFiles[0].contents;
  return { bytes: code.length, gzip: gzipSync(code).length, meta: r.metafile };
}
const kib = (n) => (n / 1024).toFixed(1) + " KiB";
for (const [name, entry] of [["baseline (drizzle d1 only)", HERE + "dist-size/baseline.js"], ["spike worker-min (BA + drizzle adapter)", HERE + "src/worker-min.js"]]) {
  const raw = await size(entry, false);
  const min = await size(entry, true);
  console.log(`${name}: raw ${kib(raw.bytes)} (gzip ${kib(raw.gzip)}); minified ${kib(min.bytes)} (gzip ${kib(min.gzip)})`);
  if (name.startsWith("spike")) {
    const byPkg = {};
    for (const [path, info] of Object.entries(min.meta.outputs[Object.keys(min.meta.outputs)[0]].inputs)) {
      const m = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
      const k = m ? m[1] : "(spike src)";
      byPkg[k] = (byPkg[k] ?? 0) + info.bytesInOutput;
    }
    for (const [k, v] of Object.entries(byPkg).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${k.padEnd(32)} ${kib(v)} (minified)`);
  }
}
