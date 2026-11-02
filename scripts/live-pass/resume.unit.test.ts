// An offline live pass, both sessions, in which the cloud container is lost twice: once in session 1
// after the owner already changed the environment variables as the S8 prompt says (before the reply
// reached the runner), and once in the middle of session 2. Session 2 starts with stale starter
// tokens still set. Everything is read back the way the analyst reads it: from the records bucket.
//
// Written by the independent test author (review of 2026-11-02, after PR #166) from the owner's
// requirements, not from the implementation:
// - the runner executes the commands itself;
// - the admin token is its own variable (LIVE_PASS_ADMIN_TOKEN), separate from the starter token;
// - a durable checkpoint in the records bucket lets session 2 (everyday token only, no starter
//   token) resume with `node scripts/live-pass/live-pass.mjs resume`, and the runbook (section 5)
//   says a lost container loses nothing: start a new session and run `resume`;
// - credential values are never printed, logged or stored;
// - records may hold both people's emails and Cloudflare user IDs;
// - telemetry: every command (args, exit code, timing, scrubbed output), API snapshots after each
//   step, expected against observed per step, Workers Logs, prototype-logs and the auth app's rows;
// - the final token can read every record and delete everything the run created.
//
// The fake Cloudflare world and the stand-in framework CLI are the ones run.unit.test.ts uses.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { STEPS } from "./lib/steps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "live-pass.mjs");
const WORLD_MODULE = join(HERE, "test-support", "fake-world.mjs");
const FAKE_FW = join(HERE, "test-support", "fake-framework.mjs");
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const ADMIN_GROUPS = ["Account API Tokens Write", "Account Settings Read", "D1 Write", "OAuth Client Write", "Secrets Store Write", "Workers Observability Write", "Workers R2 Storage Write", "Workers Scripts Write"];
const BOOT_GROUPS = ["Workers Scripts Write", "OAuth Client Write", "Secrets Store Write", "Account API Tokens Write"];
const EVERYDAY_GROUPS = ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Secrets Store Read"];

type World = Record<string, any>;
type Result = { status: number | null; out: string };

/** One offline world and the runner's command line in a chosen container (work directory). */
async function harness() {
  const dir = mkdtempSync(join(tmpdir(), "live-pass-resume-"));
  const worldFile = join(dir, "world.json");
  process.env.FAKE_CF_WORLD = worldFile;
  const fw = await import(pathToFileURL(WORLD_MODULE).href);
  const transcript: string[] = [];
  /** Only what the runner printed (the transcript also shows the arguments the test passed). */
  const printed: string[] = [];
  let containers = 0;

  /** A new container: an empty work directory with the app the release candidate creates (stand-in CLI). */
  const container = () => {
    const workdir = join(dir, `container-${++containers}`);
    const project = join(workdir, "project", "livepass");
    mkdirSync(join(project, "node_modules", "@lago-morph", "prototype-framework"), { recursive: true });
    mkdirSync(join(project, "node_modules", ".bin"), { recursive: true });
    mkdirSync(join(project, "config", "cloudflare"), { recursive: true });
    writeFileSync(join(project, "node_modules", "@lago-morph", "prototype-framework", "package.json"), JSON.stringify({ version: "0.2.0-rc01" }));
    writeFileSync(join(project, "config", "cloudflare", "test.json"), '{ "values": {}, "framework": {} }\n');
    const bin = join(project, "node_modules", ".bin", "prototype-framework");
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_FW}" "$@"\n`);
    chmodSync(bin, 0o755);
    return workdir;
  };

  const base = (workdir: string) => ({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp", FAKE_CF_WORLD: worldFile, LIVE_PASS_WORKDIR: workdir, NODE_OPTIONS: `--import ${pathToFileURL(WORLD_MODULE).href}`, CLOUDFLARE_ACCOUNT_ID: ACCOUNT });

  const run = (env: Record<string, string>, ...args: string[]): Result => {
    const r = spawnSync(process.execPath, [RUNNER, ...args], { env, encoding: "utf8", timeout: 240_000 });
    transcript.push(`$ live-pass ${args.join(" ")} → ${String(r.status)}\n${r.stdout}${r.stderr}`);
    printed.push(`${r.stdout}${r.stderr}`);
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const world = (): World => JSON.parse(readFileSync(worldFile, "utf8"));
  const change = (fn: (w: World) => void) => {
    const w = world();
    fn(w);
    writeFileSync(worldFile, JSON.stringify(w));
  };
  const records = (): Record<string, string> => Object.fromEntries(Object.entries(world().buckets["live-pass-records"]?.objects ?? {}).map(([k, o]) => [k, (o as { body: string }).body]));
  return { fw, worldFile, container, base, run, world, change, records, transcript, printed };
}

type H = Awaited<ReturnType<typeof harness>>;

describe("an offline live pass that loses its container in both sessions", () => {
  let h: H;
  let tokens: Record<string, string>;
  let invocations = 0;
  let refusedNoEveryday: Result;
  let refusedNoAdmin: Result;
  let stateBeforeRefusals = "";
  let stateAfterRefusals = "";
  let resumeAfterLoss: Result;
  let session2Start: Result;
  let prefix = "";
  let rec: Record<string, string> = {};
  const json = (key: string) => JSON.parse(rec[`${prefix}${key}`] ?? "null");
  const keys = (sub: string) => Object.keys(rec).filter((k) => k.startsWith(`${prefix}${sub}`));
  const jsonl = (key: string) => (rec[`${prefix}${key}`] ?? "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  beforeAll(async () => {
    h = await harness();
    const w0: World = h.fw.newWorld(ACCOUNT);
    w0.members = [
      { id: "m1", status: "accepted", user: { id: "u-owner", email: "owner@example.com" }, roles: [{ id: "r1", name: "Super Administrator - All Privileges" }] },
      { id: "m2", status: "accepted", user: { id: "u-tester", email: "tester@example.com" }, roles: [{ id: "r3", name: "HTTP Applications Read" }] },
    ];
    tokens = {
      admin: h.fw.addToken(w0, { name: "live-pass-admin", groups: ADMIN_GROUPS, expiresInS: 3 * 86_400 }),
      boot: h.fw.addToken(w0, { name: "prototype-framework-bootstrap", groups: BOOT_GROUPS, expiresInS: 23 * 3600 }),
      long: h.fw.addToken(w0, { name: "prototype-framework-bootstrap", groups: BOOT_GROUPS }),
      rerun: h.fw.addToken(w0, { name: "prototype-framework-bootstrap", groups: BOOT_GROUPS, expiresInS: 23 * 3600 }),
    };
    writeFileSync(h.worldFile, JSON.stringify(w0));

    let workdir = h.container();
    let env: Record<string, string> = { ...h.base(workdir), LIVE_PASS_ADMIN_TOKEN: tokens.admin, CLOUDFLARE_BOOTSTRAP_TOKEN: tokens.boot, LIVE_PASS_BOOTSTRAP_LONG: tokens.long, LIVE_PASS_BOOTSTRAP_RERUN: tokens.rerun };
    const run = (...args: string[]) => {
      invocations += 1;
      let r = h.run(env, ...args);
      for (let i = 0; i < 20 && r.status === 11; i++) {
        invocations += 1;
        r = h.run(env, "next");
      }
      return r;
    };
    const prompt = (r: Result, step: string) => {
      if (r.status !== 10 || !r.out.includes(`OWNER STEP ${step} `)) throw new Error(`expected the owner prompt of ${step}, got exit ${String(r.status)}:\n${h.transcript.join("\n")}`);
    };

    // ---- Session 1, container 1 ----
    let r = run("start");
    prompt(r, "P3");
    prompt((r = run("answer", "ok")), "S6");
    h.change((w) => {
      h.fw.addEvent(w, "prototype-admin", "admin signed in");
      h.fw.addEvent(w, "prototype-admin", "GET /callback", 403);
    });
    prompt((r = run("answer", "ok")), "S7");
    h.change((w) => {
      const db = "db-auth-0001";
      w.d1.push({ uuid: db, name: "prototype-auth" });
      w.d1Rows[db] = { users: [], registry: [], codes: [], sign_ins: [] };
      w.workers["prototype-auth"] = { created_on: "x", modified_on: "x", compatibility_flags: ["nodejs_compat"], observability: null, secrets: [], bindings: [{ type: "d1", name: "DB", id: db }, { type: "secrets_store_secret", name: "AUTH_APP_CLIENT_ID" }, { type: "secrets_store_secret", name: "AUTH_APP_CLIENT_SECRET" }, { type: "plain_text", name: "AUTH_APP_ACCOUNT_ID" }, { type: "plain_text", name: "AUTH_APP_ORIGIN" }] };
      for (const b of ["prototype-logs", "sst-state", "prototype-backups"]) w.buckets[b] = { objects: {}, lifecycle: b === "prototype-backups" ? { rules: [{ id: "expire" }] } : null };
      w.buckets["sst-state"].objects["framework/account.json"] = { body: JSON.stringify({ setupVersion: 2, frameworkVersion: "0.2.0-rc01" }) };
      w.buckets["prototype-logs"].objects["livepass/prodcheck/2026/11/03/000000.000-error-r1.json"] = { body: JSON.stringify({ severity: "error", requestId: "r1" }) };
      h.fw.addToken(w, { name: "prototype-r2-signing", groups: ["Workers R2 Storage Write"] });
      const signingId = w.tokens.at(-1).id;
      w.stores[0].secrets.push({ id: "s5", name: "PROTOTYPE_R2_ACCESS_KEY_ID", comment: signingId }, { id: "s6", name: "PROTOTYPE_R2_SECRET_ACCESS_KEY", comment: signingId });
    });
    prompt((r = run("answer", "ok")), "E-1");
    prompt((r = run("answer", "ok")), "S8");

    // The owner does what the S8 prompt says: page 2 makes the everyday token, and the owner changes
    // the environment settings to session 2's column right away. Then the container is lost before
    // the reply reaches the runner (runbook section 5: start a new session and run `resume`).
    h.change((w) => {
      tokens.everyday = h.fw.addToken(w, { name: "prototype-framework", groups: EVERYDAY_GROUPS });
    });
    workdir = h.container();
    env = { ...h.base(workdir), LIVE_PASS_ADMIN_TOKEN: tokens.admin, CLOUDFLARE_API_TOKEN: tokens.everyday };
    resumeAfterLoss = r = run("resume");
    prompt(r, "S8");
    prompt((r = run("answer", "ok")), "S10");
    r = run("answer", "ok");
    if (r.status !== 0 || !r.out.includes("SESSION 1 IS DONE")) throw new Error(`session 1 did not end at the checkpoint:\n${h.transcript.join("\n")}`);

    // ---- Session 2 refuses an environment without the everyday token or the admin token ----
    const stateKey = () => Object.keys(h.records()).find((k) => k.endsWith("/state.json")) ?? "";
    stateBeforeRefusals = h.records()[stateKey()];
    workdir = h.container();
    env = { ...h.base(workdir), LIVE_PASS_ADMIN_TOKEN: tokens.admin };
    refusedNoEveryday = run("resume");
    // Without the admin token the runner cannot reach the records bucket, so it records nothing: not counted.
    refusedNoAdmin = h.run({ ...h.base(workdir), CLOUDFLARE_API_TOKEN: tokens.everyday }, "resume");
    stateAfterRefusals = h.records()[stateKey()];

    // ---- Session 2, container 3: the stale starter tokens are still set (already deleted at Cloudflare) ----
    env = { ...h.base(workdir), LIVE_PASS_ADMIN_TOKEN: tokens.admin, CLOUDFLARE_API_TOKEN: tokens.everyday, CLOUDFLARE_BOOTSTRAP_TOKEN: tokens.boot, LIVE_PASS_BOOTSTRAP_RERUN: tokens.rerun };
    session2Start = r = run("resume");
    prompt(r, "S13");
    h.change((w) => {
      const db = w.d1.find((d: { name: string }) => d.name === "prototype-auth").uuid;
      w.d1Rows[db].users = [{ sub: "u-owner", email: "owner@example.com", role: "admin", updated_at: 1 }, { sub: "u-tester", email: "tester@example.com", role: "user", updated_at: 2 }];
      w.buckets["livepass-prodcheck-files"].objects["uploads/u/1"] = { body: "png" };
      h.fw.addEvent(w, "prototype-auth", "GET /callback", 302);
    });
    prompt((r = run("answer", "ok")), "S14");

    // ---- The container is lost again, in the middle of S14 ----
    workdir = h.container();
    env = { ...env, LIVE_PASS_WORKDIR: workdir };
    prompt((r = run("resume")), "S14");
    h.change((w) => {
      w.members[1].roles = [{ id: "r2", name: "Administrator" }];
    });
    prompt((r = run("answer", "ok")), "S14");
    prompt((r = run("answer", "user")), "S14");
    const setRole = (role: string) =>
      h.change((w) => {
        const db = w.d1.find((d: { name: string }) => d.name === "prototype-auth").uuid;
        w.d1Rows[db].users[1].role = role;
      });
    setRole("admin");
    prompt((r = run("answer", "admin")), "S14");
    h.change((w) => {
      w.members[1].roles = [{ id: "r3", name: "HTTP Applications Read" }];
    });
    setRole("user");
    prompt((r = run("answer", "user")), "S15");
    prompt((r = run("answer", "ok")), "S16");
    prompt((r = run("answer", "ok")), "U1");
    h.change((w) => {
      const t = w.tokens.filter((x: { name: string }) => x.name === "prototype-framework").find((x: { value: string }) => x.value !== tokens.everyday);
      t.policies[0].permission_groups = EVERYDAY_GROUPS.map((n) => ({ id: h.fw.idOf(n), name: n }));
    });
    prompt((r = run("answer", "updated")), "E-10");
    h.change((w) => {
      delete w.buckets["prototype-mailsink"];
    });
    r = run("answer", "ok");
    if (r.status !== 0 || !r.out.includes("THE LIVE PASS IS FINISHED")) throw new Error(`the run did not finish:\n${h.transcript.join("\n")}`);

    rec = h.records();
    prefix = JSON.parse(rec["latest.json"]).key.replace(/state\.json$/, "");
  }, 600_000);

  it("resumes session 1 in a new container after the owner already changed the variables as the S8 prompt says, and asks S8 again", () => {
    expect(resumeAfterLoss.status, resumeAfterLoss.out).toBe(10);
    expect(resumeAfterLoss.out).toContain("OWNER STEP S8 ");
  });

  it("refuses (exit 3) to resume session 2 without the everyday token or without the admin token, naming the variable, and changes nothing", () => {
    expect(refusedNoEveryday.status).toBe(3);
    expect(refusedNoEveryday.out).toContain("CLOUDFLARE_API_TOKEN");
    expect(refusedNoAdmin.status).toBe(3);
    expect(refusedNoAdmin.out).toContain("LIVE_PASS_ADMIN_TOKEN");
    expect(stateAfterRefusals).toBe(stateBeforeRefusals);
  });

  it("finishes with every step passed or recorded, both sessions in the state", () => {
    const results = json("results.json");
    const bad = results.steps.filter((s: { result: string }) => !["pass", "info", "n/a"].includes(s.result));
    expect(bad, h.transcript.join("\n")).toEqual([]);
    const state = json("state.json");
    expect(state.phase).toBe("finished");
    expect(state.sessions.map((s: { number: number }) => s.number)).toEqual([1, 1, 2, 2]);
  });

  it("warns about stale starter tokens in session 2, records them in R1, and passes none of them to a session-2 command", () => {
    expect(session2Start.out).toMatch(/warning: CLOUDFLARE_BOOTSTRAP_TOKEN is still set in session 2/);
    expect(session2Start.out).toMatch(/warning: LIVE_PASS_BOOTSTRAP_RERUN is still set in session 2/);
    const r1 = json(keys("steps/").find((k) => k.endsWith("-R1.json"))!.slice(prefix.length));
    expect(r1.observations.find((o: { id: string }) => o.id === "CLOUDFLARE_BOOTSTRAP_TOKEN")).toMatchObject({ pass: null });
    expect(jsonl("events.jsonl").some((e: { event: string }) => e.event === "environment-warnings")).toBe(true);
    const session2Steps = new Set(STEPS.filter((s: { session: number }) => s.session === 2).map((s: { id: string }) => s.id));
    const commands = keys("commands/").map((k) => JSON.parse(rec[k]));
    const s2 = commands.filter((c) => session2Steps.has(c.step));
    expect(s2.length).toBeGreaterThan(0);
    for (const c of s2) {
      expect(c.env.CLOUDFLARE_BOOTSTRAP_TOKEN, `${c.step} ${c.label}`).toBeUndefined();
      expect(c.env.CLOUDFLARE_API_TOKEN, `${c.step} ${c.label}`).toBe("set");
    }
    for (const c of commands.filter((x) => !session2Steps.has(x.step))) expect(c.env.CLOUDFLARE_API_TOKEN, `${c.step} ${c.label}`).toBeUndefined();
  });

  it("keeps every container's lines of the append-only logs in the records bucket", () => {
    const starts = jsonl("events.jsonl").filter((e: { event: string }) => e.event === "invocation");
    expect(starts.length).toBe(invocations);
    expect(starts.map((e: { command: string }) => e.command)).toEqual(expect.arrayContaining(["start", "resume", "answer"]));
    const calls = jsonl("api-calls.jsonl");
    const cp = Date.parse(json("state.json").checkpointAt);
    expect(calls.some((c: { at: string }) => Date.parse(c.at) < cp)).toBe(true);
    expect(calls.some((c: { at: string }) => Date.parse(c.at) > cp)).toBe(true);
    const obs = jsonl("observability.jsonl").map((o: { afterStep: string }) => o.afterStep);
    expect(obs).toEqual(expect.arrayContaining(["S4", "S17"]));
    const http = jsonl("http.jsonl").map((x: { step: string }) => x.step);
    expect(http).toEqual(expect.arrayContaining(["P1", "R1"]));
  });

  it("diffs the first snapshot of a new container against the last one of the previous container", () => {
    const r1 = json(keys("steps/").find((k) => k.endsWith("-R1.json"))!.slice(prefix.length));
    expect(r1.snapshotDiff.added).not.toContain("worker:prototype-admin");
  });

  it("holds the telemetry the owner asked for: every command, a snapshot after every step, expected against observed, the server side", () => {
    const commands = keys("commands/").map((k) => JSON.parse(rec[k]));
    expect(commands.length).toBeGreaterThan(5);
    for (const c of commands) {
      expect(Array.isArray(c.argv) && c.argv.length > 0).toBe(true);
      expect(c.exitCode === null || Number.isInteger(c.exitCode)).toBe(true);
      expect(Number.isNaN(Date.parse(c.startedAt))).toBe(false);
      expect(Date.parse(c.endedAt)).toBeGreaterThanOrEqual(Date.parse(c.startedAt));
      expect(c.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof c.stdout).toBe("string");
      expect(typeof c.stderr).toBe("string");
      expect(c.rawSecretHits).toEqual({});
    }
    const state = json("state.json");
    const stepFiles = keys("steps/").map((k) => JSON.parse(rec[k]));
    for (const id of Object.keys(state.done)) {
      const r = stepFiles.filter((s) => s.id === id).at(-1);
      expect(r, id).toBeDefined();
      expect(Array.isArray(r.expected), id).toBe(true);
      for (const o of r.observations) expect(o, `${id} ${String(o.id)}`).toHaveProperty("observed");
      expect(rec[`${prefix}${r.snapshot}`], `${id} snapshot ${String(r.snapshot)}`).toBeDefined();
      expect(r.snapshotDiff, id).toHaveProperty("added");
    }
    const wl = json("server/workers-logs-final.json");
    expect(JSON.stringify(wl.events)).toContain("admin signed in");
    expect(json("server/workers-logs-checkpoint.json").count).toBeGreaterThan(0);
    expect(keys("server/log-bucket/livepass/prodcheck/").length).toBe(1);
    const db = json("server/auth-db-final.json");
    expect(db.users.rows).toEqual(expect.arrayContaining([expect.objectContaining({ sub: "u-owner", email: "owner@example.com" }), expect.objectContaining({ sub: "u-tester", email: "tester@example.com" })]));
    for (const c of jsonl("api-calls.jsonl")) {
      expect(c).toHaveProperty("method");
      expect(c).toHaveProperty("path");
      expect(c).toHaveProperty("status");
    }
  });

  it("keeps both people's emails and Cloudflare user IDs readable", () => {
    const run = json("run.json");
    expect(run.facts.owner).toMatchObject({ email: "owner@example.com", userId: "u-owner" });
    expect(run.facts.tester).toMatchObject({ email: "tester@example.com", userId: "u-tester" });
  });

  it("never prints, logs or stores a token value: not in the runner's output, not in any record, not in the state", () => {
    const values = Object.entries(tokens);
    const printed = h.printed.join("\n");
    for (const [name, v] of values) expect(printed.includes(v), `the runner printed ${name}`).toBe(false);
    for (const [key, body] of Object.entries(rec)) for (const [name, v] of values) expect(body.includes(v), `${key} holds ${name}`).toBe(false);
  });

  it("leaves only what the runbook keeps for the analyst, and the final token covers deleting all of it", () => {
    const w = h.world();
    expect(Object.keys(w.workers).sort()).toEqual(["prototype-admin", "prototype-auth"]);
    expect(Object.keys(w.buckets).sort()).toEqual(["live-pass-records", "prototype-backups", "prototype-logs", "sst-state"]);
    expect(w.d1.map((d: { name: string }) => d.name)).toEqual(["prototype-auth"]);
    expect(w.tokens.map((t: { name: string }) => t.name).sort()).toEqual(["live-pass-admin", "prototype-framework", "prototype-r2-signing"]);
    // What deletes each kind of resource the final snapshot can hold (live-pass-analysis.md section 4).
    const deleter: Record<string, string> = { workers: "Workers Scripts Write", d1: "D1 Write", r2: "Workers R2 Storage Write", secretsStore: "Secrets Store Write", tokens: "Account API Tokens Write", oauthClients: "OAuth Client Write" };
    const handover = json("handover.json");
    const finalSnap = json(keys("snapshots/").sort().at(-1)!.slice(prefix.length));
    const kinds = Object.keys(finalSnap).filter((k) => Array.isArray(finalSnap[k]?.items) && finalSnap[k].items.length > 0 && k !== "members");
    for (const k of kinds) {
      expect(deleter[k], `no known group deletes ${k}`).toBeDefined();
      expect(handover.finalTokenGroups, k).toContain(deleter[k]);
    }
    // Reading the records needs R2 access.
    expect(handover.finalTokenGroups).toContain("Workers R2 Storage Write");
  });
});

describe("the durable state in the records bucket", () => {
  it("holds no credential value, even when an owner's skip reason contains one", async () => {
    const h = await harness();
    const w0: World = h.fw.newWorld(ACCOUNT);
    w0.members = [
      { id: "m1", status: "accepted", user: { id: "u-owner", email: "owner@example.com" }, roles: [{ id: "r1", name: "Super Administrator - All Privileges" }] },
      { id: "m2", status: "accepted", user: { id: "u-tester", email: "tester@example.com" }, roles: [{ id: "r3", name: "HTTP Applications Read" }] },
    ];
    const admin = h.fw.addToken(w0, { name: "live-pass-admin", groups: ADMIN_GROUPS, expiresInS: 3 * 86_400 });
    const boot = h.fw.addToken(w0, { name: "prototype-framework-bootstrap", groups: BOOT_GROUPS, expiresInS: 23 * 3600 });
    writeFileSync(h.worldFile, JSON.stringify(w0));
    const env = { ...h.base(h.container()), LIVE_PASS_ADMIN_TOKEN: admin, CLOUDFLARE_BOOTSTRAP_TOKEN: boot };
    let r = h.run(env, "start");
    for (let i = 0; i < 10 && r.status === 11; i++) r = h.run(env, "next");
    expect(r.status, h.transcript.join("\n")).toBe(10);
    r = h.run(env, "skip", "S2", `the owner pasted ${admin} by mistake`);
    expect(r.status, h.transcript.join("\n")).toBe(10);
    const rec = h.records();
    const state = Object.entries(rec).find(([k]) => k.endsWith("/state.json"))![1];
    expect(JSON.parse(state).done.S2).toMatchObject({ result: "skipped" });
    for (const [key, body] of Object.entries(rec)) expect(body.includes(admin), `${key} holds the admin token`).toBe(false);
    expect(h.printed.join("\n").includes(admin), "the runner printed the admin token").toBe(false);
  }, 120_000);
});
