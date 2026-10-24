// The S3 handler bridge, runtime-neutral (workerd + D1, Node + PGlite).
// Framework-style POST routes rebuild a Request and forward it to `auth.handler()`, then strip
// BA's Set-Cookie and delete the BA session row; the framework would issue `__Host-session` here.
import { eq, sql } from "drizzle-orm";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { makeAuth, BASE_PATH } from "./auth.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Rebuild a request for BA: fixed origin URL, JSON body, only allow-listed headers (never Cookie/Host/X-Forwarded-*). */
function rebuild(env, incoming, baPath, { method = "POST", body, query } = {}) {
  const url = new URL(env.origin + BASE_PATH + baPath);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const headers = new Headers({ accept: "application/json" });
  if (body !== undefined) headers.set("content-type", "application/json");
  for (const h of ["origin", "cf-connecting-ip", "user-agent"]) {
    const v = incoming.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function forward(env, auth, incoming, baPath, opts) {
  const res = await auth.handler(rebuild(env, incoming, baPath, opts));
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, setCookieNames: setCookie.map((c) => c.split("=")[0]), location: res.headers.get("location") };
}

export function createApp(env) {
  const { db, schema, outbox } = env;
  const S = schema.__framework_auth_session;
  const mail = {
    async send(kind, to, url, token) {
      await db.insert(outbox).values({ kind, to, url, token, createdAt: Date.now() });
    },
  };
  const count = async (table, where) => {
    const q = db.select({ n: sql`count(*)` }).from(table);
    const rows = await (where ? q.where(where) : q);
    return Number(rows[0].n);
  };

  return async function fetch(request, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    // One BA instance per request.
    const t0 = Date.now();
    const auth = makeAuth({ ...env, mail, background: ctx?.waitUntil?.bind(ctx), hasher: url.searchParams.get("hasher") ?? env.hasher });
    const built = Date.now() - t0;
    const input = request.method === "POST" && request.headers.get("content-type")?.includes("json") ? await request.json() : {};

    // Raw passthrough (no rebuild): BA sees the caller's URL/Host/Origin/Cookie as-is. /raw/<ba path>
    if (p.startsWith("/raw/")) {
      const r = await auth.handler(new Request(new URL(BASE_PATH + p.slice(4), request.url), { method: "POST", headers: request.headers, body: JSON.stringify(input) }));
      return json({ status: r.status, body: await r.json().catch(() => null) });
    }
    switch (p) {
      case "/api/auth/password/sign-up": {
        const r = await forward(env, auth, request, "/sign-up/email", { body: { name: input.name, email: input.email, password: input.password } });
        return json({ ba: r, builtMs: built });
      }
      case "/api/auth/password/verify": {
        // BA's verify-email is a GET; the framework's POST turns into a server-side GET (no state-changing GET is exposed).
        const r = await forward(env, auth, request, "/verify-email", { method: "GET", query: { token: input.token } });
        return json({ ba: r });
      }
      case "/api/auth/password/sign-in": {
        const r = await forward(env, auth, request, "/sign-in/email", { body: { email: input.email, password: input.password, rememberMe: false } });
        const out = { ba: r };
        if (r.status === 200 && r.body?.token) {
          const before = await count(S, eq(S.token, r.body.token));
          await db.delete(S).where(eq(S.token, r.body.token));
          const after = await count(S, eq(S.token, r.body.token));
          out.bridge = { subject: r.body.user.id, displayName: r.body.user.name, baSessionRowsBefore: before, baSessionRowsAfter: after, frameworkWouldIssue: "__Host-session" };
        }
        return json(out); // no Set-Cookie copied from BA
      }
      case "/api/auth/password/forgot": {
        const r = await forward(env, auth, request, "/request-password-reset", { body: { email: input.email } });
        return json({ ba: r });
      }
      case "/api/auth/password/reset": {
        const r = await forward(env, auth, request, "/reset-password", { body: { token: input.token, newPassword: input.password } });
        return json({ ba: r });
      }
      case "/spike/mail": {
        const rows = await db.select().from(outbox).where(eq(outbox.to, url.searchParams.get("to")));
        return json(rows);
      }
      case "/spike/counts": {
        const out = {};
        for (const [k, t] of Object.entries(schema)) out[k] = await count(t);
        out.spike_outbox = await count(outbox);
        return json(out);
      }
      case "/spike/rate-limit-rows": {
        return json(await db.select().from(schema.__framework_auth_rate_limit));
      }
      case "/spike/bench": {
        // One hash + one verify; timings taken by the caller from outside (workerd freezes clocks during compute).
        const mode = url.searchParams.get("mode");
        const pw = "correct horse battery staple";
        const h = mode === "default" ? { hash: hashPassword, verify: verifyPassword } : mode === "none" ? null : env.hashers?.[mode];
        const op = url.searchParams.get("op") ?? "both";
        if (!h) return json({ mode, op: "noop" });
        let hash = env.benchHash?.[mode];
        if (op !== "verify" || !hash) hash = await h.hash(pw);
        if (env.benchHash) env.benchHash[mode] = hash;
        const ok = op === "hash" ? null : await h.verify({ hash, password: pw });
        return json({ mode, op, ok, format: hash.replace(/[0-9a-f]/g, "x").replace(/x+/g, (m) => `x{${m.length}}`) });
      }
    }
    return json({ error: "not found" }, 404);
  };
}
