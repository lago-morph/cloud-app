// An offline run of the whole live-pass runner, both sessions, through its command line: the real
// runner (scripts/live-pass/live-pass.mjs) against a fake Cloudflare world behind fetch
// (test-support/fake-world.mjs) and a stand-in for the framework CLI (test-support/fake-framework.mjs).
// The test plays the owner: it changes the fake world the way the browser steps would, then
// answers the runner's prompts. No network.
//
// Written from the brief: the runner executes the commands itself; owner steps need one short
// reply; a durable checkpoint in the test account separates session 1 (starter token) from
// session 2 (everyday and admin tokens only), resumed with one command; the records hold no secret.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "live-pass.mjs");
const WORLD_MODULE = join(HERE, "test-support", "fake-world.mjs");
const FAKE_FW = join(HERE, "test-support", "fake-framework.mjs");
const ACCOUNT = "0123456789abcdef0123456789abcdef";

type World = Record<string, any>;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "live-pass-run-"));
  const worldFile = join(dir, "world.json");
  const workdir = join(dir, "work");
  process.env.FAKE_CF_WORLD = worldFile;
  return { dir, worldFile, workdir };
}

describe("an offline live pass through both sessions", () => {
  it("reaches the checkpoint, resumes in session 2, finishes, and records no token value", async () => {
    const { worldFile, workdir } = setup();
    const fw = await import(pathToFileURL(WORLD_MODULE).href);
    const world: World = fw.newWorld(ACCOUNT);
    world.members = [
      { id: "m1", status: "accepted", user: { id: "u-owner", email: "owner@example.com" }, roles: [{ id: "r1", name: "Super Administrator - All Privileges" }] },
      { id: "m2", status: "accepted", user: { id: "u-tester", email: "tester@example.com" }, roles: [{ id: "r3", name: "HTTP Applications Read" }] },
    ];
    const admin = fw.addToken(world, { name: "live-pass-admin", groups: ["Account API Tokens Write", "Account Settings Read", "D1 Write", "OAuth Client Write", "Secrets Store Write", "Workers Observability Write", "Workers R2 Storage Write", "Workers Scripts Write"], expiresInS: 3 * 86_400 });
    const bootGroups = ["Workers Scripts Write", "OAuth Client Write", "Secrets Store Write", "Account API Tokens Write"];
    const boot = fw.addToken(world, { name: "prototype-framework-bootstrap", groups: bootGroups, expiresInS: 23 * 3600 });
    const long = fw.addToken(world, { name: "prototype-framework-bootstrap", groups: bootGroups });
    const rerun = fw.addToken(world, { name: "prototype-framework-bootstrap", groups: bootGroups, expiresInS: 23 * 3600 });
    writeFileSync(worldFile, JSON.stringify(world));

    // The app the release candidate would create, with the stand-in framework CLI.
    const project = join(workdir, "project", "livepass");
    mkdirSync(join(project, "node_modules", "@lago-morph", "prototype-framework"), { recursive: true });
    mkdirSync(join(project, "node_modules", ".bin"), { recursive: true });
    mkdirSync(join(project, "config", "cloudflare"), { recursive: true });
    writeFileSync(join(project, "node_modules", "@lago-morph", "prototype-framework", "package.json"), JSON.stringify({ version: "0.2.0-rc01" }));
    writeFileSync(join(project, "config", "cloudflare", "test.json"), '{ "values": {}, "framework": {} }\n');
    const bin = join(project, "node_modules", ".bin", "prototype-framework");
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_FW}" "$@"\n`);
    chmodSync(bin, 0o755);

    const baseEnv = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "/tmp",
      FAKE_CF_WORLD: worldFile,
      LIVE_PASS_WORKDIR: workdir,
      NODE_OPTIONS: `--import ${pathToFileURL(WORLD_MODULE).href}`,
      CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
      LIVE_PASS_ADMIN_TOKEN: admin,
    };
    let env: Record<string, string> = { ...baseEnv, CLOUDFLARE_BOOTSTRAP_TOKEN: boot, LIVE_PASS_BOOTSTRAP_LONG: long, LIVE_PASS_BOOTSTRAP_RERUN: rerun };
    const transcript: string[] = [];
    const run = (...args: string[]) => {
      const r = spawnSync(process.execPath, [RUNNER, ...args], { env, encoding: "utf8", timeout: 240_000 });
      transcript.push(`$ live-pass ${args.join(" ")} → ${String(r.status)}\n${r.stdout}${r.stderr}`);
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    };
    /** Runs `next` while the runner says its time budget is used up. */
    const settle = (r: { status: number | null; out: string }) => {
      let x = r;
      for (let i = 0; i < 20 && x.status === 11; i++) x = run("next");
      return x;
    };
    const change = (fn: (w: World) => void) => {
      const w = JSON.parse(readFileSync(worldFile, "utf8"));
      fn(w);
      writeFileSync(worldFile, JSON.stringify(w));
    };
    const expectPrompt = (r: { status: number | null; out: string }, step: string) => {
      if (r.status !== 10 || !r.out.includes(`OWNER STEP ${step} `)) throw new Error(`expected the owner prompt of ${step}, got exit ${String(r.status)}:\n${transcript.join("\n")}`);
    };

    // ---- Session 1 ----
    let r = settle(run("start"));
    expectPrompt(r, "P3");
    r = settle(run("answer", "ok"));
    expectPrompt(r, "S6");
    change((w) => {
      fw.addEvent(w, "prototype-admin", "admin signed in");
      fw.addEvent(w, "prototype-admin", "GET /callback", 403);
    });
    r = settle(run("answer", "ok"));
    expectPrompt(r, "S7");
    let signingId = "";
    change((w) => {
      // What page 1 does: the auth app, its database, the shared buckets, the record, the signing credential.
      const db = "db-auth-0001";
      w.d1.push({ uuid: db, name: "prototype-auth" });
      w.d1Rows[db] = { users: [], registry: [], codes: [], sign_ins: [] };
      w.workers["prototype-auth"] = { created_on: "x", modified_on: "x", compatibility_flags: ["nodejs_compat"], observability: null, secrets: [], bindings: [{ type: "d1", name: "DB", id: db }, { type: "secrets_store_secret", name: "AUTH_APP_CLIENT_ID" }, { type: "secrets_store_secret", name: "AUTH_APP_CLIENT_SECRET" }, { type: "plain_text", name: "AUTH_APP_ACCOUNT_ID" }, { type: "plain_text", name: "AUTH_APP_ORIGIN" }] };
      for (const b of ["prototype-logs", "sst-state", "prototype-backups"]) w.buckets[b] = { objects: {}, lifecycle: b === "prototype-backups" ? { rules: [{ id: "expire" }] } : null };
      w.buckets["sst-state"].objects["framework/account.json"] = { body: JSON.stringify({ setupVersion: 2, frameworkVersion: "0.2.0-rc01" }) };
      w.buckets["prototype-logs"].objects["livepass/prodcheck/2026/11/03/000000.000-error-r1.json"] = { body: JSON.stringify({ severity: "error", requestId: "r1" }) };
      fw.addToken(w, { name: "prototype-r2-signing", groups: ["Workers R2 Storage Write"] });
      signingId = w.tokens.at(-1).id;
      w.stores[0].secrets.push({ id: "s5", name: "PROTOTYPE_R2_ACCESS_KEY_ID", comment: signingId }, { id: "s6", name: "PROTOTYPE_R2_SECRET_ACCESS_KEY", comment: signingId });
    });
    r = settle(run("answer", "ok"));
    expectPrompt(r, "E-1");
    r = settle(run("answer", "ok"));
    expectPrompt(r, "S8");
    let everyday = "";
    change((w) => {
      everyday = fw.addToken(w, { name: "prototype-framework", groups: ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Secrets Store Read"] });
    });
    r = settle(run("answer", "ok"));
    expectPrompt(r, "S10");
    r = settle(run("answer", "ok"));
    expect(r.status, transcript.join("\n")).toBe(0);
    expect(r.out).toContain("SESSION 1 IS DONE");
    expect(r.out).toContain("node scripts/live-pass/live-pass.mjs resume");

    // ---- Session 2: a new session with only the everyday and admin tokens ----
    env = { ...baseEnv, CLOUDFLARE_API_TOKEN: everyday };
    r = settle(run("resume"));
    expectPrompt(r, "S13");
    change((w) => {
      const db = w.d1.find((d: { name: string }) => d.name === "prototype-auth").uuid;
      w.d1Rows[db].users = [{ sub: "u-owner", email: "owner@example.com", role: "admin", updated_at: 1 }, { sub: "u-tester", email: "tester@example.com", role: "user", updated_at: 2 }];
      w.buckets["livepass-prodcheck-files"].objects["uploads/u/1"] = { body: "png" };
      fw.addEvent(w, "prototype-auth", "GET /callback", 302);
    });
    r = settle(run("answer", "ok"));
    expectPrompt(r, "S14");
    change((w) => {
      w.members[1].roles = [{ id: "r2", name: "Administrator" }];
    });
    r = settle(run("answer", "ok"));
    expectPrompt(r, "S14");
    r = settle(run("answer", "user"));
    expectPrompt(r, "S14");
    const setRole = (role: string) => change((w) => {
      const db = w.d1.find((d: { name: string }) => d.name === "prototype-auth").uuid;
      w.d1Rows[db].users[1].role = role;
    });
    setRole("admin");
    r = settle(run("answer", "admin"));
    expectPrompt(r, "S14");
    change((w) => {
      w.members[1].roles = [{ id: "r3", name: "HTTP Applications Read" }];
    });
    setRole("user");
    r = settle(run("answer", "user"));
    expectPrompt(r, "S15");
    r = settle(run("answer", "ok"));
    expectPrompt(r, "S16");
    r = settle(run("answer", "ok"));
    expectPrompt(r, "U1");
    change((w) => {
      // Page 2 updated the stand-in in place to exactly the four groups.
      const t = w.tokens.filter((x: { name: string }) => x.name === "prototype-framework").find((x: { value: string }) => x.value !== everyday);
      t.policies[0].permission_groups = ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Secrets Store Read"].map((n) => ({ id: fw.idOf(n), name: n }));
    });
    r = settle(run("answer", "updated"));
    expectPrompt(r, "E-10");
    change((w) => {
      delete w.buckets["prototype-mailsink"];
    });
    r = settle(run("answer", "ok"));
    expect(r.status, transcript.join("\n")).toBe(0);
    expect(r.out).toContain("THE LIVE PASS IS FINISHED");
    expect(r.out).toContain("prefix runs/lp-");

    // ---- What the analyst gets ----
    const recordsDir = join(workdir, "records", readdirSync(join(workdir, "records"))[0]);
    const results = JSON.parse(readFileSync(join(recordsDir, "results.json"), "utf8"));
    const failed = results.steps.filter((s: { result: string }) => !["pass", "info", "n/a"].includes(s.result));
    if (failed.length > 0) {
      const details = failed.map((s: { id: string }) => {
        const f = readdirSync(join(recordsDir, "steps")).filter((n) => n.endsWith(`-${s.id}.json`)).at(-1);
        const rec = f ? JSON.parse(readFileSync(join(recordsDir, "steps", f), "utf8")) : {};
        return `${s.id}: ${JSON.stringify((rec.observations ?? []).filter((o: { pass: unknown }) => o.pass === false), null, 1)}`;
      });
      throw new Error(`steps not passed:\n${details.join("\n")}\n\n${transcript.join("\n")}`);
    }
    expect(results.steps.map((s: { id: string }) => s.id)).toContain("FIN");
    expect(results.checks.find((c: { id: string }) => c.id === "U1")?.result).toBe("pass");

    // Every record file, locally and in the records bucket, is free of every token value.
    const secrets = [admin, boot, long, rerun, everyday];
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const file of walk(recordsDir)) {
      const text = readFileSync(file, "utf8");
      for (const s of secrets) expect(text.includes(s), `${file} holds a token value`).toBe(false);
    }
    const final = JSON.parse(readFileSync(worldFile, "utf8"));
    const uploaded = final.buckets["live-pass-records"].objects as Record<string, { body: string }>;
    expect(Object.keys(uploaded)).toEqual(expect.arrayContaining(["latest.json", expect.stringMatching(/^runs\/lp-.*\/state\.json$/), expect.stringMatching(/results\.md$/), expect.stringMatching(/handover\.json$/)]));
    for (const [key, o] of Object.entries(uploaded)) for (const s of secrets) expect(o.body.includes(s), `${key} holds a token value`).toBe(false);
    const state = JSON.parse(Object.entries(uploaded).find(([k]) => k.endsWith("/state.json"))![1].body);
    expect(state.phase).toBe("finished");
    expect(state.sessions.map((s: { number: number }) => s.number)).toEqual([1, 2]);
    // The runner's probe and stand-in tokens are gone; the everyday token and the signing token stay.
    expect(final.tokens.map((t: { name: string }) => t.name).sort()).toEqual(["live-pass-admin", "prototype-framework", "prototype-r2-signing"]);

    // The analyst fetches every record with one command and the final token (here: a token with the admin token's groups).
    const analysis = (() => {
      const w = JSON.parse(readFileSync(worldFile, "utf8"));
      const v = fw.addToken(w, { name: "live-pass-analysis", groups: ["Account API Tokens Write", "Account Settings Read", "D1 Write", "OAuth Client Write", "Secrets Store Write", "Workers Observability Write", "Workers R2 Storage Write", "Workers Scripts Write"], expiresInS: 7 * 86_400 });
      writeFileSync(worldFile, JSON.stringify(w));
      return v;
    })();
    const to = join(workdir, "analysis");
    env = { PATH: baseEnv.PATH, HOME: baseEnv.HOME, FAKE_CF_WORLD: worldFile, NODE_OPTIONS: baseEnv.NODE_OPTIONS, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, LIVE_PASS_ADMIN_TOKEN: analysis };
    const dl = run("download", "--to", to);
    expect(dl.status, transcript.join("\n")).toBe(0);
    const runKeys = Object.keys(uploaded).filter((k) => k.startsWith(state.prefix));
    const downloaded = walk(to).map((f) => f.slice(to.length + 1)).sort();
    expect(downloaded).toEqual(runKeys.map((k) => k.slice(state.prefix.length)).sort());
    expect(downloaded).toEqual(expect.arrayContaining(["state.json", "results.md", "handover.json"]));
  }, 600_000);
});
