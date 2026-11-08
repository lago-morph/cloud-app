// The tools a step uses (`ctx`): commands, HTTP, the Cloudflare API with the owner's token and the
// everyday token, the secrets directory, members and roles, snapshots, the server-side collection
// and the final hand-over. Everything a tool records passes through the run's scrubber.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createApi, describe, listAll, verifyToken } from "./cloudflare.mjs";
import { childEnv, runCommand } from "./exec.mjs";
import { authDbRows, copyLogBucket, d1Query, ensureObservability, matching, queryWorkersLogs } from "./server.mjs";
import { diffSnapshots, takeSnapshot } from "./snapshot.mjs";
import { addProdConfig } from "./steps.mjs";

import { missingGroups, OWNER_GROUPS, OWNER_TOKEN_NAME } from "./groups.mjs";
import { RewindRequest } from "./engine.mjs";
import { SECRET } from "./secrets.mjs";

const pad = (n) => String(n).padStart(3, "0");

/**
 * @param {{ holder: { state: any }, env: Record<string, string|undefined>, vault: { dir: string, values: Record<string,string>, reload: () => void, save: (name: string, value: string) => void },
 *   scrubber: any, recorder: any, api: any, repoDir: string, workdir: string, print: (t: string) => void, nextSeq: () => number }} deps
 */
export function contextFactory(deps) {
  const { holder, env, vault, scrubber, recorder, api, repoDir, workdir, print } = deps;
  const state = () => holder.state;
  const onApiCall = (c) => recorder.append("api-calls.jsonl", c);
  let lastSnapshot = null;
  let everyday = null;
  let everydayValue = null;

  const projectDir = () => join(workdir, "project", state().appName);
  const projectReady = () => existsSync(join(projectDir(), "node_modules", "@lago-morph", "prototype-framework", "package.json"));

  return (base, step) => {
    const seqOf = () => deps.nextSeq();
    const fileName = (kind, label, ext = "json") => `${kind}/${pad(seqOf())}-${step.id}${label ? `-${label}` : ""}.${ext}`;

    // `base` has live getters (`state`, `facts`): inherit them, never copy them (a spread would freeze them).
    const ctx = Object.assign(Object.create(base), {
      env,
      vault,
      api,
      repoDir,
      workdir,
      scrubber,
      onApiCall,
      secret(name, value) {
        scrubber.add(name, value);
      },

      /** A value of the secrets directory (read again from disk: the agent may just have saved it). */
      secretValue(name) {
        vault.reload();
        return vault.values[name];
      },

      /** Saves a value the runner made (mode 600) and keeps it out of every record. */
      saveSecret(name, value) {
        scrubber.add(name, value);
        vault.save(name, value);
      },

      /** A command; no token reaches it unless `set` names it (DEC-0793). */
      async exec(argv, { cwd = projectDir(), set = {}, input, timeoutMs, label = "cmd" } = {}) {
        const protectIds = [state().facts.ownerTokenId].filter(Boolean);
        const rec = await runCommand({ argv, cwd, env: childEnv(env, { accountId: state().accountId, set, protectIds }), input, timeoutMs, scrubber, label, echo: true });
        const file = fileName("commands", label);
        recorder.json(file, { step: step.id, ...rec });
        base.addCommand({ file, label, argv: rec.argv, exitCode: rec.exitCode, durationMs: rec.durationMs });
        return rec;
      },

      /** A framework command. A part-2 step's command gets the everyday token; a step passes a starter token itself. */
      async fw(args, options = {}) {
        if (!projectReady()) await ctx.ensureProject({ force: false });
        if (step.session === 2) await ctx.ensureEveryday();
        const value = step.session === 2 ? ctx.secretValue(SECRET.everyday) : undefined;
        if (step.session === 2 && !value && step.id !== "R1") throw new RewindRequest(["R1"], "the everyday token's value was lost with a container and could not be rolled again through the API: R1 asks for it");
        const set = { ...(value ? { CLOUDFLARE_API_TOKEN: value } : {}), ...(options.set ?? {}) };
        return ctx.exec([join(projectDir(), "node_modules", ".bin", "prototype-framework"), ...args], { timeoutMs: 25 * 60_000, ...options, set });
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
        const value = ctx.secretValue(SECRET.everyday) ?? "";
        if (everyday === null || value !== everydayValue) {
          everyday = createApi({ token: value, accountId: state().accountId, onCall: onApiCall, label: "everyday" });
          everydayValue = value;
        }
        return everyday;
      },

      /** Rolls a token's value (PUT …/tokens/<id>/value): { ok, value } or { ok: false, error }. The value is never recorded. */
      async rollToken(id) {
        const r = await api.call("PUT", api.account(`/tokens/${id}/value`), { json: {} });
        const value = typeof r.body?.result === "string" ? r.body.result : undefined;
        return r.ok && value ? { ok: true, value } : { ok: false, status: r.status, error: describe(r) };
      },

      /**
       * The everyday token's value, rolled again (and saved) when the secrets directory lacks it: a new
       * container starts with only what the agent saved from the owner's first message.
       */
      async ensureEveryday() {
        const id = state().facts.everydayTokenId;
        if (ctx.secretValue(SECRET.everyday) || !id) return { rolled: false };
        const r = await ctx.rollToken(id);
        if (r.ok) ctx.saveSecret(SECRET.everyday, r.value);
        base.note(r.ok ? "the everyday token's value was not in the secrets directory (a new container): the runner rolled it again" : `the everyday token's value is missing and rolling it failed: ${r.error}`);
        return { rolled: r.ok, error: r.error };
      },

      /** Every role of the test Cloudflare account (the list has several pages: "Administrator" is not on the first). */
      async roles() {
        const l = await listAll(api, api.account("/roles"));
        return { ok: l.ok, error: l.error, items: l.items.map((r) => ({ id: r.id, name: r.name })) };
      },

      /** Invites a person by email with the given role IDs (POST …/members). */
      async invite(email, roleIds) {
        const r = await api.call("POST", api.account("/members"), { json: { email, roles: roleIds, status: "pending" } });
        return { ok: r.ok, status: r.status, error: r.ok ? undefined : describe(r), id: r.body?.result?.id };
      },

      /** Sets a member's roles (PUT …/members/<id>). */
      async setMemberRoles(memberId, roleIds) {
        const r = await api.call("PUT", api.account(`/members/${memberId}`), { json: { roles: roleIds.map((id) => ({ id })) } });
        return { ok: r.ok, status: r.status, error: r.ok ? undefined : describe(r), roles: (r.body?.result?.roles ?? []).map((x) => x.name) };
      },

      /** Waits without the owner (a deploy settling, the role-refresh interval). */
      async wait(ms, why) {
        print(`(waiting ${Math.round(ms / 1000)} s: ${why}; nothing to do)`);
        await new Promise((r) => setTimeout(r, ms));
      },

      async tokenGroups(id) {
        if (!id) return null;
        const r = await api.call("GET", api.account(`/tokens/${id}`));
        return r.ok ? (r.body.result.policies ?? []).flatMap((p) => (p.permission_groups ?? []).map((g) => g.name)).sort() : null;
      },

      /** { required, optional }: the groups the owner's token lacks. */
      async ownerGroupsMissing() {
        return missingGroups((await ctx.tokenGroups(state().facts.ownerTokenId)) ?? []);
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

      /** What the analyst needs: the records' bucket and prefix, the test Cloudflare account's ID, and the same owner token. */
      async finalInstructions() {
        const handover = { bucket: state().bucket, prefix: state().prefix, accountId: state().accountId, token: OWNER_TOKEN_NAME, tokenId: state().facts.ownerTokenId, tokenGroups: OWNER_GROUPS, note: "The analysis and the cleanup use the owner's token live-pass-owner; no new token is made." };
        recorder.json("handover.json", handover);
        base.setFacts({ handover });
        const missing = await ctx.ownerGroupsMissing();
        base.observe("the owner's token covers the analysis and the cleanup", { expected: OWNER_GROUPS, observed: missing.required.length + missing.optional.length === 0 ? "all held" : `missing: ${[...missing.required, ...missing.optional].join(", ")}`, pass: missing.required.length === 0 });
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
