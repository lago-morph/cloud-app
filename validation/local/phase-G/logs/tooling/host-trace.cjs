// G-RUN host trace preload (NODE_OPTIONS=--require). Appends one line per distinct (process, kind, host)
// to $HOST_TRACE_DIR/hosts-<pid>-<thread>.log: DNS lookups, socket connects, http(s).request targets
// (incl. proxy CONNECT authorities) and undici (fetch) request origins. Hosts only: no paths, headers or bodies.
const dir = process.env.HOST_TRACE_DIR;
if (dir) {
  const fs = require("node:fs");
  const path = require("node:path");
  const { threadId } = require("node:worker_threads");
  const file = path.join(dir, `hosts-${process.pid}-${threadId}.log`);
  const seen = new Set();
  const rec = (kind, host) => {
    const key = `${kind} ${host}`;
    if (seen.has(key)) return;
    seen.add(key);
    try { fs.appendFileSync(file, `${new Date().toISOString()} pid=${process.pid} t=${threadId} ${key}\n`); } catch {}
  };
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  rec("start", JSON.stringify(process.argv.slice(1, 3)));
  const dns = require("node:dns");
  const wrap = (obj, name, kind) => {
    const orig = obj && obj[name];
    if (typeof orig !== "function") return;
    obj[name] = function (host, ...rest) { try { rec(kind, String(host)); } catch {} return orig.call(this, host, ...rest); };
  };
  wrap(dns, "lookup", "dns");
  wrap(dns, "resolve", "dns-resolve");
  wrap(dns, "resolve4", "dns-resolve");
  wrap(dns, "resolve6", "dns-resolve");
  wrap(dns.promises, "lookup", "dns");
  wrap(dns.promises, "resolve", "dns-resolve");
  const net = require("node:net");
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    try {
      let o = args[0];
      if (Array.isArray(o)) o = o[0];
      if (o && typeof o === "object") { if (o.path) rec("connect-ipc", "unix"); else rec("connect", `${o.host ?? "localhost"}:${o.port}`); }
      else if (typeof o === "number" || /^\d+$/.test(String(o))) rec("connect", `${typeof args[1] === "string" ? args[1] : "localhost"}:${o}`);
      else if (typeof o === "string") rec("connect-ipc", "unix");
    } catch {}
    return origConnect.apply(this, args);
  };
  for (const modName of ["node:http", "node:https"]) {
    const mod = require(modName);
    for (const fn of ["request", "get"]) {
      const orig = mod[fn];
      mod[fn] = function (...args) {
        try {
          const a = args[0];
          let host;
          let method = "GET";
          let p = "";
          if (typeof a === "string" || a instanceof URL) {
            const u = new URL(a);
            host = u.host;
            const o = args[1];
            if (o && typeof o === "object") method = o.method ?? method;
          } else if (a && typeof a === "object") {
            host = `${a.hostname ?? a.host ?? "localhost"}${a.port ? `:${a.port}` : ""}`;
            method = a.method ?? method;
            p = String(a.path ?? "");
          }
          rec(`${modName.slice(5)}-request`, host);
          if (String(method).toUpperCase() === "CONNECT") rec("proxy-connect", p);
        } catch {}
        return orig.apply(this, args);
      };
    }
  }
  try {
    const dc = require("node:diagnostics_channel");
    dc.subscribe("undici:request:create", ({ request }) => { try { rec("undici-request", String(request.origin)); } catch {} });
    dc.subscribe("undici:client:connected", ({ connectParams }) => { try { rec("undici-connected", `${connectParams?.hostname}:${connectParams?.port}`); } catch {} });
  } catch {}
}
