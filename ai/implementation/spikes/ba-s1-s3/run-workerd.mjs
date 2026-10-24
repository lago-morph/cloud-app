// S1+S3 on workerd: runs the wrangler-bundled Worker (dist/worker.js) in Miniflare with a local D1 binding.
// Usage: node run-workerd.mjs [bundle=dist/worker.js] [flags=nodejs_compat]
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { scenario } from "./scenario.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const bundle = process.argv[2] ?? "dist/worker.js";
const flags = (process.argv[3] ?? "nodejs_compat").split(",").filter(Boolean);
const date = process.argv[4] ?? "2026-10-01";

export async function start({ bundle: b = bundle, flags: f = flags, hasher = "default", date: d = date } = {}) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [
      {
        name: "spike",
        modules: true,
        scriptPath: HERE + b,
        compatibilityDate: d,
        compatibilityFlags: f,
        d1Databases: ["DB"],
        bindings: { PUBLIC_ORIGIN: "http://localhost:8787", SECRET_FRAMEWORK_AUTH_SECRET: randomBytes(32).toString("base64url"), HASHER: hasher },
      },
    ],
  }));
  const d1 = await mf.getD1Database("DB");
  const ddl = readFileSync(HERE + "sql/sqlite.sql", "utf8").split(";").map((s) => s.trim()).filter(Boolean);
  await d1.batch(ddl.map((s) => d1.prepare(s)));
  const send = async (path, { method = "GET", body, headers = {}, host } = {}) => {
    const url = `http://${host ?? "localhost:8787"}${path}`;
    const res = await mf.dispatchFetch(url, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  return { mf, send, d1 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { mf, send } = await start();
  console.log(`workerd via miniflare; bundle=${bundle}; compatibility_date=${date}; compatibility_flags=${JSON.stringify(flags)}`);
  let ok = false;
  try {
    ok = await scenario(send, console.log);
  } finally {
    await mf.dispose();
  }
  process.exit(ok ? 0 : 1);
}
