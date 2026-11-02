// Server-side events of the run, collected with the admin token.
//
// What the framework already records, and how the runner collects it:
// - Stage Workers write their log entries (framework failures and app `log.write` calls, each with
//   its request ID) to the shared R2 bucket `prototype-logs` (LOG-REQ-004): copied object by object.
// - The auth app and the admin app write one JSON line per event to the Worker console only
//   ("admin signed in", "grant refused: …", "sign-in refused: …", "… failed"). The console is not
//   kept unless the Worker's observability (Workers Logs) is on, so the runner turns it on for every
//   Worker in the test account (script settings, no redeploy) and reads the events back through
//   the Workers Observability query API. Workers Logs also records each invocation: URL, status,
//   outcome, timing, and the RPC calls of the auth app's `AuthApp` entrypoint.
// - The auth app's D1 database holds who signed in with which role (`users`) and the app registry
//   (`registry`): read with D1 queries, without the one-time code and PKCE columns.
import { describe, listAll } from "./cloudflare.mjs";

export const LOG_BUCKET = "prototype-logs";
export const OBSERVABILITY = { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: true, head_sampling_rate: 1 } };

/** Turns Workers Logs on for each named Worker where it is off; returns what it found and did. */
export async function ensureObservability(api, scriptNames) {
  const out = [];
  for (const name of scriptNames) {
    const got = await api.call("GET", api.account(`/workers/scripts/${name}/script-settings`));
    const before = got.ok ? (got.body.result?.observability ?? null) : null;
    const on = before?.enabled === true && before?.logs?.enabled !== false && before?.logs?.invocation_logs !== false;
    if (on) {
      out.push({ script: name, before, action: "already on" });
      continue;
    }
    const r = await api.call("PATCH", api.account(`/workers/scripts/${name}/script-settings`), { json: { observability: OBSERVABILITY } });
    out.push({ script: name, before, action: r.ok ? "turned on" : `turning on failed: ${describe(r)}` });
  }
  return out;
}

/** The events list in a telemetry query answer, whatever its exact nesting. */
export function eventsOf(result) {
  if (Array.isArray(result?.events?.events)) return result.events.events;
  if (Array.isArray(result?.events)) return result.events;
  if (Array.isArray(result?.invocations)) return result.invocations;
  return [];
}

/**
 * Every Workers Logs event between two times (ms), oldest window first. A window that answers the
 * query limit is split in two, so nothing is cut off.
 */
export async function queryWorkersLogs(api, fromMs, toMs, { limit = 2000, depth = 0 } = {}) {
  const body = { queryId: `live-pass-${fromMs}-${toMs}`, timeframe: { from: fromMs, to: toMs }, view: "events", limit, dry: true, parameters: {} };
  const r = await api.call("POST", api.account("/workers/observability/telemetry/query"), { json: body });
  if (!r.ok) return { ok: false, error: describe(r), windows: [{ fromMs, toMs, error: describe(r) }], events: [] };
  const events = eventsOf(r.body.result);
  if (events.length >= limit && depth < 12 && toMs - fromMs > 2000) {
    const mid = Math.floor((fromMs + toMs) / 2);
    const a = await queryWorkersLogs(api, fromMs, mid, { limit, depth: depth + 1 });
    const b = await queryWorkersLogs(api, mid, toMs, { limit, depth: depth + 1 });
    return { ok: a.ok && b.ok, error: a.error ?? b.error, windows: [...a.windows, ...b.windows], events: [...a.events, ...b.events] };
  }
  return { ok: true, windows: [{ fromMs, toMs, count: events.length, statistics: r.body.result?.statistics ?? r.body.result?.run?.statistics }], events };
}

/** Events whose text contains every one of `needles` (case-insensitive). */
export function matching(events, needles) {
  return events.filter((e) => {
    const t = JSON.stringify(e).toLowerCase();
    return needles.every((n) => t.includes(n.toLowerCase()));
  });
}

/** The log bucket's object keys not yet copied, with each object's body. */
export async function copyLogBucket(api, already = new Set()) {
  const keys = [];
  let cursor;
  do {
    const q = `?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const r = await api.call("GET", api.account(`/r2/buckets/${LOG_BUCKET}/objects${q}`));
    if (r.status === 404) return { ok: true, absent: true, entries: [] };
    if (!r.ok) return { ok: false, error: describe(r), entries: [] };
    for (const o of r.body.result ?? []) keys.push(o.key);
    cursor = r.body.result_info?.is_truncated === true ? r.body.result_info.cursor : undefined;
  } while (cursor);
  const entries = [];
  for (const key of keys.filter((k) => !already.has(k))) {
    const got = await api.call("GET", api.account(`/r2/buckets/${LOG_BUCKET}/objects/${encodeURIComponent(key)}`), { raw: true });
    let body = got.text;
    try {
      body = JSON.parse(got.text);
    } catch {
      /* kept as text */
    }
    entries.push({ key, status: got.status, body });
  }
  return { ok: true, entries, total: keys.length };
}

/** Runs one SQL statement on a D1 database: { ok, rows, error }. */
export async function d1Query(api, databaseId, sql, params = []) {
  const r = await api.call("POST", api.account(`/d1/database/${databaseId}/query`), { json: { sql, params } });
  if (!r.ok) return { ok: false, status: r.status, error: describe(r), rows: [] };
  const first = Array.isArray(r.body.result) ? r.body.result[0] : r.body.result;
  return { ok: true, rows: first?.results ?? [], meta: first?.meta };
}

/** The auth app's records, without one-time codes, PKCE verifiers, nonces or state hashes. */
export const AUTH_DB_QUERIES = {
  users: "SELECT sub, email, role, updated_at FROM users ORDER BY updated_at",
  registry: "SELECT app, return_url FROM registry ORDER BY app, return_url",
  codes: "SELECT sub, app, return_url, expires_at, used FROM codes ORDER BY expires_at",
  sign_ins: "SELECT app, return_url, expires_at FROM sign_ins ORDER BY expires_at",
};

export async function authDbRows(api, databaseId) {
  const out = {};
  for (const [name, sql] of Object.entries(AUTH_DB_QUERIES)) out[name] = await d1Query(api, databaseId, sql);
  return out;
}

/** The D1 database ID of a name, or null. */
export async function d1Id(api, name) {
  const l = await listAll(api, api.account(`/d1/database?name=${encodeURIComponent(name)}`));
  return l.items.find((d) => d.name === name)?.uuid ?? null;
}
