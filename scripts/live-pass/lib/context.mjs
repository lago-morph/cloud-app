// The tools a step uses (`ctx`): commands, HTTP, the Cloudflare API with the admin and everyday
// tokens, snapshots, the server-side collection and the final hand-over. Everything a tool
// records passes through the run's scrubber.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createApi, describe, listAll, verifyToken } from "./cloudflare.mjs";
import { childEnv, runCommand } from "./exec.mjs";
import { authDbRows, copyLogBucket, d1Query, ensureObservability, matching, queryWorkersLogs } from "./server.mjs";
import { diffSnapshots, takeSnapshot } from "./snapshot.mjs";
import { addProdConfig } from "./steps.mjs";

/**
 * The admin token's permission groups, as the API names them (the dashboard shows "Write" as
 * "Edit"). The final hand-over token holds the same groups.
 */
export const ADMIN_GROUPS = [
  "Account API Tokens Write",
  "Account Settings Read",
  "D1 Write",
  "OAuth Client Write",
  "Secrets Store Write",
  "Workers Observability Write",
  "Workers R2 Storage Write",
  "Workers Scripts Write",
];

const pad = (n) => String(n).padStart(3, "0");

/**
 * @param {{ holder: { state: any }, env: Record<string, string|undefined>, scrubber: any, recorder: any, api: any, repoDir: string, workdir: string, print: (t: string) => void, nextSeq: () => number }} deps
 */
export function contextFactory(deps) {
  const { holder, env, scrubber, recorder, api, repoDir, workdir, print } = deps;
  const state = () => holder.state;
  const onApiCall = (c) => recorder.append("api-calls.jsonl", c);
  let lastSnapshot = null;
  let everyday = null;

  const projectDir = () => join(workdir, "project", state().appName);
  const projectReady = () => existsSync(join(projectDir(), "node_modules", "@lago-morph", "prototype-framework", "package.json"));

  return (base, step) => {
    const seqOf = () => deps.nextSeq();
    const fileName = (kind, label, ext = "json") => `${kind}/${pad(seqOf())}-${step.id}${label ? `-${label}` : ""}.${ext}`;

    // `base` has live getters (`state`, `facts`): inherit them, never copy them (a spread would freeze them).
    const ctx = Object.assign(Object.create(base), {
      env,
      api,
      repoDir,
      workdir,
      scrubber,
      onApiCall,
      secret(name, value) {
        scrubber.add(name, value);
      },

      async exec(argv, { cwd = projectDir(), set = {}, input, timeoutMs, label = "cmd" } = {}) {
        const protectIds = [state().facts.adminTokenId].filter(Boolean);
        const rec = await runCommand({ argv, cwd, env: childEnv(env, { session: state().session, set, protectIds }), input, timeoutMs, scrubber, label, echo: true });
        const file = fileName("commands", label);
        recorder.json(file, { step: step.id, ...rec });
        base.addCommand({ file, label, argv: rec.argv, exitCode: rec.exitCode, durationMs: rec.durationMs });
        return rec;
      },

      async fw(args, options = {}) {
        if (!projectReady()) await ctx.ensureProject({ force: false });
        return ctx.exec([join(projectDir(), "node_modules", ".bin", "prototype-framework"), ...args], { timeoutMs: 25 * 60_000, ...options });
      },

      async ensureProject({ force }) {
        const dir = projectDir();
        const version = state().version;
        if (projectReady() && !force) return;
        if (projectReady()) {
          base.observe("app project", { expected: "present in this container", observed: `reused ${dir}`, pass: null });
        } else {
          if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
          const rec = await ctx.exec(["npm", "create", `@lago-morph/prototype-app@${version}`, "--", dir, "--name", state().appName], { cwd: workdir, set: { npm_config_yes: "true" }, label: "create-app", timeoutMs: 20 * 60_000 });
          base.observe("npm create", { check: "P2", expected: "exit 0", observed: rec.exitCode, pass: rec.exitCode === 0 });
        }
        const pkg = join(dir, "node_modules", "@lago-morph", "prototype-framework", "package.json");
        const installed = existsSync(pkg) ? JSON.parse(readFileSync(pkg, "utf8")).version : null;
        const pinned = /^\d+\.\d+\.\d+/.test(version);
        base.observe("framework version", { check: "P2", expected: pinned ? version : `the version npm's dist-tag ${version} names`, observed: installed ?? "not installed", pass: installed !== null && (!pinned || installed === version) });
        if (installed === null) throw new Error(`the app was not created: ${pkg} is missing (see the create-app command record)`);
        if (state().facts.frameworkVersion && state().facts.frameworkVersion !== installed) {
          base.observe("same version as session 1", { expected: state().facts.frameworkVersion, observed: installed, pass: false });
        }
        base.setFacts({ frameworkVersion: installed });
        if (addProdConfig(dir)) {
          const git = await ctx.exec(["sh", "-c", "git add config/cloudflare && git -c user.name=live-pass -c user.email=live-pass@invalid commit -q -m 'Production stage values file (live pass)' || true"], { cwd: dir, label: "commit-prod-config" });
          base.observe("production values file", { check: "P2", expected: "config/cloudflare/prodcheck.json committed", observed: git.exitCode, pass: git.exitCode === 0 });
        }
      },

      async http(url, { method = "GET", headers = {}, body, json = false } = {}) {
        const started = Date.now();
        let res;
        try {
          res = await fetch(url, { method, headers, body, redirect: "manual" });
        } catch (e) {
          const rec = { at: new Date(started).toISOString(), step: step.id, method, url, error: String(e?.cause?.code ?? e) };
          recorder.append("http.jsonl", rec);
          return { status: 0, error: rec.error, cookieNames: [], cookieHeader: "" };
        }
        const text = await res.text();
        const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
        const pairs = setCookies.map((c) => c.split(";")[0]);
        let parsed;
        if (json) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = undefined;
          }
        }
        const location = res.headers.get("location") ?? undefined;
        recorder.append("http.jsonl", { at: new Date(started).toISOString(), ms: Date.now() - started, step: step.id, method, url, status: res.status, location, setCookie: setCookies, body: text.length > 2000 ? `${text.slice(0, 2000)}…` : text });
        return { status: res.status, location, cookieNames: pairs.map((p) => p.split("=")[0]), cookieHeader: pairs.join("; "), text, json: parsed };
      },

      async verify(token) {
        return verifyToken(fetch, token, state().accountId, onApiCall);
      },

      everydayApi() {
        if (everyday === null) everyday = createApi({ token: env.CLOUDFLARE_API_TOKEN ?? "", accountId: state().accountId, onCall: onApiCall, label: "everyday" });
        return everyday;
      },

      async tokenGroups(id) {
        if (!id) return null;
        const r = await api.call("GET", api.account(`/tokens/${id}`));
        return r.ok ? (r.body.result.policies ?? []).flatMap((p) => (p.permission_groups ?? []).map((g) => g.name)).sort() : null;
      },

      async adminGroupsMissing() {
        const groups = (await ctx.tokenGroups(state().facts.adminTokenId)) ?? [];
        return ADMIN_GROUPS.filter((g) => !groups.includes(g));
      },

      starterTokens() {
        const out = {};
        for (const n of ["CLOUDFLARE_BOOTSTRAP_TOKEN", "LIVE_PASS_BOOTSTRAP_LONG", "LIVE_PASS_BOOTSTRAP_RERUN"]) if (env[n]) out[n] = env[n];
        return out;
      },

      async freshSnapshot() {
        lastSnapshot = await takeSnapshot(api, { skipBuckets: [state().bucket] });
        return lastSnapshot;
      },

      diff(a, b) {
        return diffSnapshots(a, b);
      },

      async d1With(which, dbId, sql) {
        if (!dbId) return { ok: false, error: "no database ID", rows: [] };
        return d1Query(which, dbId, sql);
      },

      async authDb() {
        const id = state().facts.authDbId;
        if (!id) return { users: { ok: false, rows: [] }, registry: { ok: false, rows: [] } };
        const rows = await authDbRows(api, id);
        recorder.json(fileName("server/auth-db", null), rows);
        return rows;
      },

      /** Workers Logs events since this step started that contain every needle; waits for them unless wait is false. */
      async logsSince(needles, { scripts = [], wait = true, timeoutMs = 150_000 } = {}) {
        const from = (base.state.pending?.record?.startedAtMs ?? Date.now() - 600_000) - 60_000;
        const deadline = Date.now() + (wait ? timeoutMs : 0);
        let result;
        for (;;) {
          const q = await queryWorkersLogs(api, from, Date.now());
          const events = scripts.length === 0 ? q.events : q.events.filter((e) => scripts.some((s) => JSON.stringify(e).includes(s)));
          result = { ok: q.ok, error: q.error, total: events.length, events, matched: matching(events, needles) };
          if (!q.ok || result.matched.length > 0 || Date.now() >= deadline) break;
          await new Promise((r) => setTimeout(r, 15_000));
        }
        recorder.json(fileName("server/workers-logs", null), { from: new Date(from).toISOString(), to: new Date().toISOString(), needles, scripts, ok: result.ok, error: result.error, events: result.events });
        return result;
      },

      /** Everything server-side so far: Workers Logs of the whole run, the log bucket, the auth app's rows. */
      async collectServer(label) {
        const from = Date.parse(state().createdAt) - 60_000;
        const q = await queryWorkersLogs(api, from, Date.now());
        recorder.json(`server/workers-logs-${label}.json`, { from: new Date(from).toISOString(), to: new Date().toISOString(), ok: q.ok, error: q.error, windows: q.windows, count: q.events.length, events: q.events });
        base.observe("Workers logs", { expected: "the run's events, from the Workers Observability API", observed: q.ok ? `${q.events.length} events` : q.error, pass: q.ok ? true : null });
        const logs = await copyLogBucket(api);
        for (const e of logs.entries) recorder.json(`server/log-bucket/${e.key}`, e.body);
        base.observe("log bucket", { expected: "every object of prototype-logs copied", observed: logs.ok ? (logs.absent ? "bucket absent" : `${logs.entries.length} objects`) : logs.error, pass: logs.ok ? true : null });
        if (state().facts.authDbId) {
          const rows = await authDbRows(api, state().facts.authDbId);
          recorder.json(`server/auth-db-${label}.json`, rows);
          base.observe("auth app records", { expected: "users and registry rows", observed: { users: rows.users.rows.length, registry: rows.registry.rows.length }, pass: rows.users.ok ? true : null });
        }
      },

      /** Prints the final token's groups and link, and what to hand to the analyst. */
      async finalInstructions() {
        const pg = await listAll(api, api.account("/tokens/permission_groups"), { perPage: 1000 });
        const byName = new Map(pg.items.map((g) => [g.name, g.id]));
        const keys = ADMIN_GROUPS.filter((n) => byName.has(n)).map((n) => ({ key: byName.get(n), type: n.endsWith(" Read") ? "read" : "edit" }));
        const missing = ADMIN_GROUPS.filter((n) => !byName.has(n));
        const link = `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=${encodeURIComponent(JSON.stringify(keys))}&name=live-pass-analysis`;
        const handover = { bucket: state().bucket, prefix: state().prefix, accountId: state().accountId, finalTokenGroups: ADMIN_GROUPS, finalTokenLink: link, groupsNotResolved: missing };
        recorder.json("handover.json", handover);
        base.setFacts({ handover });
        base.observe("final token groups resolved", { expected: ADMIN_GROUPS, observed: missing.length === 0 ? "all resolved" : `not resolved: ${missing.join(", ")}`, pass: pg.ok ? missing.length === 0 : null, note: pg.ok ? undefined : pg.error });
      },
    });
    return ctx;
  };
}

/** After every step: a snapshot (and its diff from the previous one), Workers Logs turned on, the records uploaded. */
export function afterStepFactory({ holder, recorder, api, nextSeq, recordsStore }) {
  return async (ctx, step, record) => {
    const snap = await takeSnapshot(api, { skipBuckets: [holder.state.bucket] });
    const prevKey = holder.state.facts.lastSnapshotFile;
    let prev = null;
    if (prevKey) {
      // In a new container (session 2) the previous snapshot is only in the records bucket.
      const text = recorder.read(prevKey) ?? (await recordsStore.get(prevKey).catch(() => null));
      if (text !== null) prev = JSON.parse(text);
    }
    const file = `snapshots/${pad(nextSeq())}-after-${step.id}.json`;
    recorder.json(file, snap);
    const diff = diffSnapshots(prev, snap);
    record.snapshot = file;
    record.snapshotDiff = diff;
    const scripts = (snap.workers?.items ?? []).map((w) => w.name);
    if (scripts.length > 0) {
      const obs = await ensureObservability(api, scripts);
      record.observability = obs;
      recorder.append("observability.jsonl", { at: new Date().toISOString(), afterStep: step.id, scripts: obs });
    }
    ctx.setFacts({ lastSnapshotFile: file });
  };
}

export { describe };
