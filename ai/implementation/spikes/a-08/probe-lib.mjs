// Shared probes for A-08. `run(sql, params)` executes one statement and resolves
// { ok: true } or { ok: false, error: "<message>" }.

export function selectParams(n) {
  // SELECT ?1+?2+... style is long; use a list of anonymous parameters.
  const sql = "SELECT " + Array.from({ length: n }, () => "?").join(",");
  return { sql, params: Array.from({ length: n }, (_, i) => i) };
}

export function numberedParam(k) {
  // One parameter whose index is k (?k); SQLite needs k <= max variable number.
  return { sql: `SELECT ?${k}`, params: Array.from({ length: k }, (_, i) => i) };
}

export function inList(n) {
  const sql = "SELECT count(*) AS c FROM t WHERE id IN (" + Array.from({ length: n }, () => "?").join(",") + ")";
  return { sql, params: Array.from({ length: n }, (_, i) => i) };
}

export function multiInsert(rows) {
  // 2 params per row
  const sql = "INSERT INTO t (id, v) VALUES " + Array.from({ length: rows }, () => "(?,?)").join(",");
  const params = [];
  for (let i = 0; i < rows; i++) params.push(1_000_000 + i, "x");
  return { sql, params };
}

export function literalOfBytes(totalBytes) {
  // SELECT '<x…x>' AS s  — total UTF-8 byte length exactly totalBytes, no parameters.
  const fixed = "SELECT '' AS s".length;
  const sql = "SELECT '" + "x".repeat(totalBytes - fixed) + "' AS s";
  if (Buffer.byteLength(sql) !== totalBytes) throw new Error("size calc");
  return { sql, params: [] };
}

export function paramOfBytes(bytes) {
  // Short statement, one large bound text value (statement size vs value size).
  return { sql: "SELECT length(?) AS n", params: ["x".repeat(bytes)] };
}

// Largest n in [lo, hi] for which ok(n) is true, assuming monotone; lo must be ok.
export async function maxOk(run, make, lo, hi, log) {
  let firstErr = null;
  const okAt = async (n) => {
    const { sql, params } = make(n);
    const r = await run(sql, params);
    log(`  n=${n} -> ${r.ok ? "ok" : "ERR " + r.error}`);
    if (!r.ok && !firstErr) firstErr = r.error;
    return r.ok;
  };
  if (!(await okAt(lo))) return { max: null, firstErr };
  if (await okAt(hi)) return { max: `>=${hi}`, firstErr };
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await okAt(mid)) lo = mid; else hi = mid;
  }
  return { max: lo, firstErr };
}

export async function probeAll(run, log, { paramHi = 40000, sizeHi = 2_000_000 } = {}) {
  const results = {};
  const setup = await run("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)", []);
  log(`setup: ${JSON.stringify(setup)}`);
  await run("DELETE FROM t", []);
  await run("INSERT INTO t (id, v) VALUES (1,'a'),(2,'b')", []);

  // Exact boundary checks first (documented D1 limits: 100 params, 100,000 bytes).
  for (const [name, make, ns] of [
    ["select-anon-params", selectParams, [100, 101, 999, 1000, 32766, 32767]],
    ["select-numbered-?k", numberedParam, [100, 101, 32766, 32767]],
    ["in-list", inList, [100, 101]],
    ["multi-insert-rows(2 params/row)", multiInsert, [50, 51]],
    ["statement-bytes", literalOfBytes, [99_999, 100_000, 100_001, 1_000_000]],
    ["bound-text-bytes", paramOfBytes, [100_001, 1_000_000]],
  ]) {
    for (const n of ns) {
      const { sql, params } = make(n);
      const r = await run(sql, params);
      if (name.startsWith("multi-insert")) await run("DELETE FROM t WHERE id >= 1000000", []);
      log(`${name} n=${n}: ${r.ok ? "ok" : "ERR " + r.error}`);
      results[`${name}@${n}`] = r.ok ? "ok" : r.error;
    }
  }

  log("search: max anonymous params");
  results.maxParams = await maxOk(run, selectParams, 1, paramHi, log);
  log(`=> ${JSON.stringify(results.maxParams)}`);
  log("search: max statement bytes");
  results.maxBytes = await maxOk(run, literalOfBytes, 100, sizeHi, log);
  log(`=> ${JSON.stringify(results.maxBytes)}`);
  await run("DROP TABLE IF EXISTS t", []);
  return results;
}

export function shortErr(e) {
  const m = String(e && e.message ? e.message : e);
  // Long SQL is echoed in some messages: keep the head and the tail, collapse x-runs.
  const c = m.replace(/x{20,}/g, (r) => `x…(${r.length} x)`);
  return c.length > 400 ? c.slice(0, 200) + " … " + c.slice(-200) : c;
}
