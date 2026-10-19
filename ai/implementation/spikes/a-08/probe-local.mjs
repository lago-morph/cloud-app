// Local D1 (wrangler 4.149.0 getPlatformProxy -> Miniflare/workerd). Usage:
//   node probe-local.mjs [binding|exec]
// binding: D1Database binding prepare().bind().all() (what a Worker uses)
// also tries db.batch([...]) and db.exec(sql) for the statement-size boundary.
import { getPlatformProxy } from "wrangler";
import { probeAll, shortErr, literalOfBytes, selectParams } from "./probe-lib.mjs";

const log = (s) => console.log(s);
const proxy = await getPlatformProxy({ configPath: "./wrangler.local.jsonc", persist: false });
const db = proxy.env.DB;
const run = async (sql, params) => {
  try { await db.prepare(sql).bind(...params).all(); return { ok: true }; }
  catch (e) { return { ok: false, error: shortErr(e) }; }
};
log("== local D1 via getPlatformProxy, prepare().bind().all()");
const res = await probeAll(run, log);
log("== batch() boundary");
for (const n of [100, 101, 32767]) {
  const { sql, params } = selectParams(n);
  try { await db.batch([db.prepare(sql).bind(...params)]); log(`batch params n=${n}: ok`); }
  catch (e) { log(`batch params n=${n}: ERR ${shortErr(e)}`); }
}
for (const n of [100_001, 1_000_000]) {
  const { sql } = literalOfBytes(n);
  try { await db.batch([db.prepare(sql)]); log(`batch bytes n=${n}: ok`); }
  catch (e) { log(`batch bytes n=${n}: ERR ${shortErr(e)}`); }
  try { await db.exec(sql); log(`exec bytes n=${n}: ok`); }
  catch (e) { log(`exec bytes n=${n}: ERR ${shortErr(e)}`); }
}
log("== summary " + JSON.stringify({ maxParams: res.maxParams.max, maxBytes: res.maxBytes.max }));
await proxy.dispose();
