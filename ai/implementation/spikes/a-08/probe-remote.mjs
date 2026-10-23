// Remote D1. Usage: D1_ID=<uuid> node probe-remote.mjs binding|http
//  binding: getPlatformProxy with a `remote: true` D1 binding (wrangler remote bindings: the
//           binding calls go to a real Worker binding on Cloudflare) — what a deployed Worker sees.
//  http:    D1 HTTP API POST /accounts/:id/d1/database/:uuid/query {sql, params}. No Authorization
//           header is sent; the sandbox proxy injects the token for api.cloudflare.com.
// Run under A-01's environment (see wr.sh) plus NODE_USE_ENV_PROXY=1 for Node fetch.
import { writeFileSync, rmSync } from "node:fs";
import { probeAll, shortErr, selectParams, literalOfBytes } from "./probe-lib.mjs";

const mode = process.argv[2];
const id = process.env.D1_ID;
const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
const log = (s) => console.log(s);
let run, dispose = async () => {};

if (mode === "binding") {
  const { getPlatformProxy } = await import("wrangler");
  const cfg = "./wrangler.remote.generated.jsonc";
  writeFileSync(cfg, JSON.stringify({
    name: "spike2djg358e-a08-remote",
    compatibility_date: "2026-10-01",
    d1_databases: [{ binding: "DB", database_name: "spike2djg358e-a08-limits", database_id: id, remote: true }],
  }));
  const proxy = await getPlatformProxy({ configPath: cfg, persist: false });
  const db = proxy.env.DB;
  run = async (sql, params) => {
    try { await db.prepare(sql).bind(...params).all(); return { ok: true }; }
    catch (e) { return { ok: false, error: shortErr(e) }; }
  };
  dispose = async () => {
    log("== batch() boundary (remote binding)");
    for (const n of [100, 101]) {
      const { sql, params } = selectParams(n);
      try { await db.batch([db.prepare(sql).bind(...params)]); log(`batch params n=${n}: ok`); }
      catch (e) { log(`batch params n=${n}: ERR ${shortErr(e)}`); }
    }
    for (const n of [100_000, 100_001]) {
      const { sql } = literalOfBytes(n);
      try { await db.batch([db.prepare(sql)]); log(`batch bytes n=${n}: ok`); }
      catch (e) { log(`batch bytes n=${n}: ERR ${shortErr(e)}`); }
      try { await db.exec(sql); log(`exec bytes n=${n}: ok`); }
      catch (e) { log(`exec bytes n=${n}: ERR ${shortErr(e)}`); }
    }
    await proxy.dispose(); rmSync(cfg);
  };
} else if (mode === "http") {
  const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${id}/query`;
  run = async (sql, params) => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql, params }) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) return { ok: true };
      const msg = (body.errors || []).map((e) => `${e.code}: ${e.message}`).join("; ");
      return { ok: false, error: shortErr(`HTTP ${res.status} ${msg}`) };
    } catch (e) { return { ok: false, error: shortErr(e) }; }
  };
} else throw new Error("mode?");

log(`== remote D1 via ${mode}`);
const res = await probeAll(run, log);
await dispose();
log("== summary " + JSON.stringify({ maxParams: res.maxParams.max, maxBytes: res.maxBytes.max }));
