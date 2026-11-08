// A small Cloudflare API client for the live-pass runner: JSON calls, R2 objects through
// api.cloudflare.com (the framework's own way, no S3 credentials), pagination, and token checks.
// Every call is reported to `onCall` (method, path, status, time), never with a header or body.

export const API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * @param {{ token: string, accountId: string, fetchImpl?: typeof fetch, onCall?: (c: object) => void, label?: string }} o
 */
export function createApi({ token, accountId, fetchImpl = fetch, onCall = () => {}, label = "admin" }) {
  const account = (path) => `/accounts/${accountId}${path}`;

  /**
   * @param {string} method
   * @param {string} path  starting with "/", relative to /client/v4
   * @param {{ json?: unknown, body?: BodyInit, contentType?: string, raw?: boolean, headers?: Record<string,string> }} [o]
   */
  async function call(method, path, o = {}) {
    const headers = { authorization: `Bearer ${token}`, ...(o.headers ?? {}) };
    let body = o.body;
    if (o.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(o.json);
    } else if (o.contentType !== undefined) {
      headers["content-type"] = o.contentType;
    }
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl(`${API_BASE}${path}`, { method, headers, body });
    } catch (e) {
      onCall({ at: new Date(started).toISOString(), token: label, method, path, status: null, ms: Date.now() - started, error: String(e?.cause?.code ?? e) });
      return { status: 0, ok: false, body: null, text: "", error: String(e?.cause?.code ?? e) };
    }
    const text = await res.text();
    let parsed = null;
    if (!o.raw) {
      try {
        parsed = text === "" ? null : JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    const success = parsed !== null && typeof parsed === "object" && "success" in parsed ? parsed.success === true : res.ok;
    onCall({ at: new Date(started).toISOString(), token: label, method, path, status: res.status, ms: Date.now() - started, success });
    return { status: res.status, ok: res.ok && success, body: parsed, text, headers: Object.fromEntries(res.headers) };
  }

  return { call, account, accountId, label };
}

/** The `result` of a successful answer, or a thrown error naming what failed. */
export function resultOf(r, what) {
  if (r.ok) return r.body?.result;
  throw new Error(`${what} failed: ${describe(r)}`);
}

/** "HTTP 403 (10000 Authentication error)" */
export function describe(r) {
  const errors = Array.isArray(r.body?.errors) ? r.body.errors.map((e) => `${e.code} ${e.message}`).join("; ") : "";
  return `HTTP ${r.status}${errors === "" ? "" : ` (${errors})`}${r.error ? ` ${r.error}` : ""}`;
}

/** Every item of a paged list (page/per_page, or cursor). */
export async function listAll(api, path, { perPage = 50, pick = (b) => b?.result, max = 5000 } = {}) {
  const out = [];
  let page = 1;
  let cursor;
  const sep = path.includes("?") ? "&" : "?";
  for (;;) {
    const q = cursor !== undefined ? `${sep}per_page=${perPage}&cursor=${encodeURIComponent(cursor)}` : `${sep}per_page=${perPage}&page=${page}`;
    const r = await api.call("GET", `${path}${q}`);
    if (!r.ok) return { ok: false, status: r.status, error: describe(r), items: out };
    const items = pick(r.body) ?? [];
    out.push(...items);
    const info = r.body?.result_info ?? {};
    if (typeof info.cursor === "string" && info.cursor !== "" && (info.is_truncated === true || items.length === perPage)) {
      cursor = info.cursor;
    } else if (cursor === undefined && (typeof info.total_pages === "number" ? page < info.total_pages : items.length === perPage)) {
      page += 1;
    } else {
      break;
    }
    if (out.length >= max || page > 100) break;
  }
  return { ok: true, status: 200, items: out };
}

/** Verifies a token as an account token, else as a user token: { ok, id, status, expiresOn, kind, error }. */
export async function verifyToken(fetchImpl, token, accountId, onCall) {
  for (const [kind, path] of [
    ["account", `/accounts/${accountId}/tokens/verify`],
    ["user", "/user/tokens/verify"],
  ]) {
    const api = createApi({ token, accountId, fetchImpl, onCall, label: "verify" });
    const r = await api.call("GET", path);
    if (r.ok) return { ok: true, kind, id: r.body.result.id, status: r.body.result.status, expiresOn: r.body.result.expires_on ?? null, notBefore: r.body.result.not_before ?? null };
    if (kind === "user") return { ok: false, httpStatus: r.status, error: describe(r) };
  }
  return { ok: false };
}

const objectPath = (api, bucket, key) => api.account(`/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`);

/** An R2 bucket as a key-value store (used for the state, the checkpoint and the records). */
export function r2Store(api, bucket, prefix = "") {
  return {
    bucket,
    async get(key) {
      const r = await api.call("GET", objectPath(api, bucket, `${prefix}${key}`), { raw: true });
      if (r.status === 404) return null;
      if (r.status < 200 || r.status >= 300) throw new Error(`reading R2 object ${bucket}/${prefix}${key} failed: HTTP ${r.status}`);
      return r.text;
    },
    async put(key, body, contentType = "application/json") {
      const r = await api.call("PUT", objectPath(api, bucket, `${prefix}${key}`), { body, contentType });
      if (r.status < 200 || r.status >= 300) throw new Error(`writing R2 object ${bucket}/${prefix}${key} failed: ${describe(r)}`);
    },
    async list(subPrefix = "") {
      const keys = [];
      let cursor;
      do {
        const q = `?per_page=1000&prefix=${encodeURIComponent(`${prefix}${subPrefix}`)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const r = await api.call("GET", api.account(`/r2/buckets/${bucket}/objects${q}`));
        if (r.status === 404) return [];
        if (!r.ok) throw new Error(`listing R2 bucket ${bucket} failed: ${describe(r)}`);
        for (const o of r.body.result ?? []) keys.push({ key: o.key, size: o.size, uploaded: o.last_modified ?? o.uploaded });
        const info = r.body.result_info ?? {};
        cursor = info.is_truncated === true && info.cursor ? info.cursor : undefined;
      } while (cursor !== undefined);
      return keys;
    },
  };
}

/** Creates the bucket when absent; returns "created" or "exists". Throws with Cloudflare's reason. */
export async function ensureBucket(api, bucket) {
  const got = await api.call("GET", api.account(`/r2/buckets/${bucket}`));
  if (got.ok) return "exists";
  const r = await api.call("POST", api.account("/r2/buckets"), { json: { name: bucket } });
  if (r.ok) return "created";
  const enable = Array.isArray(r.body?.errors) && r.body.errors.some((e) => e.code === 10042) ? " R2 is not enabled on the test Cloudflare account: enable it in that account's dashboard (runbook section 1, step 2)." : "";
  throw new Error(`creating the R2 bucket ${bucket} failed: ${describe(r)}.${enable}`);
}

/** Lists every object key of a bucket (empty when the bucket does not exist). */
export async function listObjects(api, bucket, prefix = "") {
  return r2Store(api, bucket).list(prefix);
}
