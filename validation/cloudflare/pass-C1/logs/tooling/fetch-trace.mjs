// Preload: appends one line per outgoing request (pid, method, host, path; account ID redacted,
// query strings dropped, status) to $FETCH_TRACE_LOG. No headers or bodies are logged.
import { appendFileSync } from "node:fs";
import https from "node:https";
const acct = process.env.CLOUDFLARE_ACCOUNT_ID || "\u0000none";
const out = process.env.FETCH_TRACE_LOG;
const red = (s) => s.split(acct).join("<ACCOUNT>");
const log = (line) => { if (out) try { appendFileSync(out, `${new Date().toISOString()} pid=${process.pid} ${red(line)}\n`); } catch {} };
const orig = globalThis.fetch;
if (orig) {
  globalThis.fetch = async (input, init) => {
    let host = "?", path = "?", method = "GET";
    try {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      host = url.host; path = url.pathname;
      method = init?.method ?? (typeof input === "object" && input && "method" in input ? input.method : "GET");
    } catch {}
    try {
      const res = await orig(input, init);
      log(`fetch ${method} ${host}${path} -> ${res.status}`);
      return res;
    } catch (e) {
      log(`fetch ${method} ${host}${path} -> ERROR ${e?.cause?.code ?? e?.name ?? "error"}`);
      throw e;
    }
  };
}
const origReq = https.request;
https.request = function (...args) {
  let req;
  try {
    const a = args[0];
    let host = "?", path = "?", method = "GET";
    if (typeof a === "string" || a instanceof URL) { const u = new URL(a); host = u.host; path = u.pathname; const o = args[1]; if (o && typeof o === "object" && o.method) method = o.method; }
    else if (a && typeof a === "object") { host = a.hostname ?? a.host ?? "?"; path = String(a.path ?? "/").split("?")[0]; method = a.method ?? "GET"; }
    req = origReq.apply(this, args);
    req.on("response", (res) => log(`https ${method} ${host}${path} -> ${res.statusCode}`));
    req.on("error", (e) => log(`https ${method} ${host}${path} -> ERROR ${e?.code ?? "error"}`));
    return req;
  } catch (e) { if (req) return req; throw e; }
};
