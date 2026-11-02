// An API snapshot of the test account, taken with the admin token after every step (and before
// the first): Workers (bindings, compatibility, observability, secret names), the workers.dev
// subdomain, D1 databases, R2 buckets (object keys, lifecycle, CORS, the framework's records in
// sst-state), Secrets Store stores and secret names (never values; the API returns none), API
// tokens' names and permission groups, members and roles, and OAuth clients where readable.
// Each section records its own HTTP status, so a section the token cannot read says so.
import { describe, listAll } from "./cloudflare.mjs";

const pickBuckets = (b) => b?.result?.buckets ?? [];

async function section(fn) {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

const policyView = (p) => ({
  effect: p.effect,
  groups: (p.permission_groups ?? []).map((g) => g.name ?? g.id).sort(),
  resources: p.resources,
});

/** Takes one snapshot. `skipBuckets`: buckets whose objects are not listed (the records bucket). */
export async function takeSnapshot(api, { skipBuckets = [], objectLimit = 1000 } = {}) {
  const takenAt = new Date().toISOString();
  const a = (p) => api.account(p);

  const [account, members, tokens, oauthClients, workers, subdomain, d1, r2, secretsStore] = await Promise.all([
    section(async () => {
      const r = await api.call("GET", a(""));
      return r.ok ? { ok: true, name: r.body.result.name, type: r.body.result.type, created_on: r.body.result.created_on } : { ok: false, error: describe(r) };
    }),
    section(async () => {
      const l = await listAll(api, a("/members"));
      return { ok: l.ok, error: l.error, items: l.items.map((m) => ({ id: m.id, status: m.status, email: m.user?.email ?? m.email, userId: m.user?.id, roles: (m.roles ?? []).map((r) => r.name).sort(), policies: (m.policies ?? []).map(policyView) })) };
    }),
    section(async () => {
      const l = await listAll(api, a("/tokens"));
      return {
        ok: l.ok,
        error: l.error,
        items: l.items.map((t) => ({ id: t.id, name: t.name, status: t.status, issued_on: t.issued_on, modified_on: t.modified_on, expires_on: t.expires_on ?? null, not_before: t.not_before ?? null, last_used_on: t.last_used_on ?? null, policies: (t.policies ?? []).map(policyView) })),
      };
    }),
    section(async () => {
      const l = await listAll(api, a("/oauth_clients"));
      return { ok: l.ok, error: l.error, items: l.items };
    }),
    section(async () => {
      const l = await listAll(api, a("/workers/scripts"), { perPage: 100 });
      if (!l.ok) return { ok: false, error: l.error, items: [] };
      const items = await Promise.all(
        l.items.map(async (w) => {
          const name = w.id;
          const [settings, scriptSettings, secrets] = await Promise.all([
            api.call("GET", a(`/workers/scripts/${name}/settings`)),
            api.call("GET", a(`/workers/scripts/${name}/script-settings`)),
            api.call("GET", a(`/workers/scripts/${name}/secrets`)),
          ]);
          const s = settings.body?.result ?? {};
          return {
            name,
            created_on: w.created_on,
            modified_on: w.modified_on,
            handlers: w.handlers,
            compatibility_date: s.compatibility_date ?? w.compatibility_date,
            compatibility_flags: s.compatibility_flags ?? w.compatibility_flags,
            bindings: settings.ok ? (s.bindings ?? []) : { error: describe(settings) },
            observability: scriptSettings.ok ? scriptSettings.body.result?.observability ?? null : { error: describe(scriptSettings) },
            secretNames: secrets.ok ? (secrets.body.result ?? []).map((x) => ({ name: x.name, type: x.type })) : { error: describe(secrets) },
          };
        }),
      );
      return { ok: true, items };
    }),
    section(async () => {
      const r = await api.call("GET", a("/workers/subdomain"));
      return r.ok ? { ok: true, subdomain: r.body.result?.subdomain ?? null } : { ok: false, status: r.status, error: describe(r) };
    }),
    section(async () => {
      const l = await listAll(api, a("/d1/database"));
      return { ok: l.ok, error: l.error, items: l.items.map((d) => ({ uuid: d.uuid, name: d.name, created_at: d.created_at, num_tables: d.num_tables, file_size: d.file_size, version: d.version })) };
    }),
    section(async () => {
      const r = await api.call("GET", a("/r2/buckets?per_page=1000"));
      if (!r.ok) return { ok: false, error: describe(r), items: [] };
      const items = await Promise.all(
        pickBuckets(r.body).map(async (b) => {
          const out = { name: b.name, creation_date: b.creation_date, location: b.location };
          if (skipBuckets.includes(b.name)) return { ...out, objects: "not listed (records bucket)" };
          const [objects, lifecycle, cors] = await Promise.all([
            api.call("GET", a(`/r2/buckets/${b.name}/objects?per_page=${objectLimit}`)),
            api.call("GET", a(`/r2/buckets/${b.name}/lifecycle`)),
            api.call("GET", a(`/r2/buckets/${b.name}/cors`)),
          ]);
          out.objects = objects.ok ? (objects.body.result ?? []).map((o) => ({ key: o.key, size: o.size, last_modified: o.last_modified })) : { error: describe(objects) };
          out.objectsTruncated = objects.ok ? objects.body.result_info?.is_truncated === true : undefined;
          out.lifecycle = lifecycle.ok ? lifecycle.body.result : { status: lifecycle.status };
          out.cors = cors.ok ? cors.body.result : { status: cors.status };
          if (b.name === "sst-state" && Array.isArray(out.objects)) {
            out.frameworkRecords = {};
            for (const o of out.objects.filter((x) => x.key.startsWith("framework/") && x.key.endsWith(".json"))) {
              const got = await api.call("GET", a(`/r2/buckets/${b.name}/objects/${encodeURIComponent(o.key)}`), { raw: true });
              let body = got.text;
              try {
                body = JSON.parse(got.text);
              } catch {
                /* kept as text */
              }
              out.frameworkRecords[o.key] = got.status === 200 ? body : { status: got.status };
            }
          }
          return out;
        }),
      );
      return { ok: true, items };
    }),
    section(async () => {
      const l = await listAll(api, a("/secrets_store/stores"));
      if (!l.ok) return { ok: false, error: l.error, items: [] };
      const items = await Promise.all(
        l.items.map(async (s) => {
          const secrets = await listAll(api, a(`/secrets_store/stores/${s.id}/secrets`), { perPage: 100 });
          return {
            id: s.id,
            name: s.name,
            created: s.created,
            secrets: secrets.ok ? secrets.items.map((x) => ({ id: x.id, name: x.name, comment: x.comment, status: x.status, scopes: x.scopes, created: x.created, modified: x.modified })) : { error: secrets.error },
          };
        }),
      );
      return { ok: true, items };
    }),
  ]);

  return { takenAt, account, members, tokens, oauthClients, workers, subdomain, d1, r2, secretsStore };
}

const fp = (v) => JSON.stringify(v);

/** A flat map "kind:name" -> fingerprint, for the diff between two snapshots. */
export function summarize(s) {
  const out = {};
  const each = (sec, fn) => (Array.isArray(sec?.items) ? sec.items.forEach(fn) : undefined);
  each(s.workers, (w) => (out[`worker:${w.name}`] = fp({ m: w.modified_on, b: w.bindings, o: w.observability, s: w.secretNames, f: w.compatibility_flags })));
  each(s.d1, (d) => (out[`d1:${d.name}`] = fp({ u: d.uuid })));
  each(s.r2, (b) => {
    out[`bucket:${b.name}`] = fp({ l: b.lifecycle, c: b.cors });
    if (Array.isArray(b.objects)) out[`objects:${b.name}`] = fp(b.objects.map((o) => o.key));
    for (const [k, v] of Object.entries(b.frameworkRecords ?? {})) out[`record:${b.name}/${k}`] = fp(v);
  });
  each(s.secretsStore, (st) => {
    out[`store:${st.name}`] = fp({ id: st.id });
    if (Array.isArray(st.secrets)) st.secrets.forEach((x) => (out[`secret:${st.name}/${x.name}`] = fp({ id: x.id, c: x.comment, m: x.modified, st: x.status })));
  });
  each(s.tokens, (t) => (out[`token:${t.name}#${t.id}`] = fp({ s: t.status, p: t.policies, e: t.expires_on, m: t.modified_on })));
  each(s.members, (m) => (out[`member:${m.email}`] = fp({ s: m.status, r: m.roles })));
  each(s.oauthClients, (c) => (out[`oauth-client:${c.name ?? c.client_name ?? c.client_id ?? c.id}`] = fp({ id: c.client_id ?? c.id, r: c.redirect_uris, sc: c.scopes, o: c.optional_scopes })));
  if (s.subdomain?.ok) out["subdomain"] = fp(s.subdomain.subdomain);
  return out;
}

/** What changed between two snapshots: added, removed and changed keys of `summarize`. */
export function diffSnapshots(before, after) {
  const a = before === null ? {} : summarize(before);
  const b = summarize(after);
  const added = Object.keys(b).filter((k) => !(k in a)).sort();
  const removed = Object.keys(a).filter((k) => !(k in b)).sort();
  const changed = Object.keys(b).filter((k) => k in a && a[k] !== b[k]).sort();
  return { added, removed, changed };
}

/** Finds helpers over a snapshot. */
export const find = {
  worker: (s, name) => s.workers?.items?.find((w) => w.name === name),
  bucket: (s, name) => s.r2?.items?.find((b) => b.name === name),
  d1: (s, name) => s.d1?.items?.find((d) => d.name === name),
  tokens: (s, name) => (s.tokens?.items ?? []).filter((t) => t.name === name),
  token: (s, id) => s.tokens?.items?.find((t) => t.id === id),
  store: (s, name) => s.secretsStore?.items?.find((x) => x.name === name),
  secret: (s, store, name) => s.secretsStore?.items?.find((x) => x.name === store)?.secrets?.find?.((x) => x.name === name),
  member: (s, email) => s.members?.items?.find((m) => m.email === email),
  oauthClient: (s, name) => s.oauthClients?.items?.find((c) => (c.name ?? c.client_name) === name),
  binding: (w, name) => (Array.isArray(w?.bindings) ? w.bindings.find((b) => b.name === name) : undefined),
};
