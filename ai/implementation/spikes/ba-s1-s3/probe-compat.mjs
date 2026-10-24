// Which Node APIs does workerd expose for a given compatibility date/flags? (nodejs_compat question)
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const script = `
export default { async fetch() {
  const out = {};
  for (const m of ["node:crypto", "node:async_hooks", "node:buffer"]) {
    try { const mod = await import(m); out[m] = Object.keys(mod).length + " exports" + (m === "node:crypto" ? ", scrypt=" + typeof mod.scrypt : ""); } catch (e) { out[m] = "ERR " + String(e.message).slice(0, 80); }
  }
  out.process = typeof globalThis.process;
  out.getBuiltinModule = typeof globalThis.process?.getBuiltinModule;
  out.ALSviaGetBuiltin = typeof globalThis.process?.getBuiltinModule?.("node:async_hooks")?.AsyncLocalStorage;
  out.globalAsyncLocalStorage = typeof globalThis.AsyncLocalStorage;
  return Response.json(out);
} }`;

const cases = [
  ["2026-10-01", []],
  ["2026-10-01", ["nodejs_compat"]],
  ["2026-10-01", ["nodejs_als"]],
  ["2026-10-01", ["no_nodejs_compat"]],
  ["2024-09-23", []],
  ["2024-09-23", ["nodejs_compat"]],
  ["2025-09-01", []],
  ["2026-01-01", []],
  ["2026-04-01", []],
  ["2026-07-01", []],
  ["2026-07-15", []],
  ["2026-08-01", []],
  ["2026-08-15", []],
  ["2026-09-01", []],
];
for (const [date, flags] of cases) {
  let mf;
  try {
    mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "p", modules: true, script, compatibilityDate: date, compatibilityFlags: flags }] }));
    const r = await mf.dispatchFetch("http://x/");
    console.log(date, JSON.stringify(flags), await r.text());
  } catch (e) {
    console.log(date, JSON.stringify(flags), "LOAD ERROR", String(e.message).split("\n")[0]);
  } finally {
    await mf?.dispose();
  }
}
