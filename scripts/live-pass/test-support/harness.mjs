// Test support for the offline runs of the whole live-pass runner (run.unit.test.ts, resume.unit.test.ts):
// one fake Cloudflare world (fake-world.mjs), the runner's command line in a chosen container (a work
// directory and a secrets directory), and the owner's browser steps played on the fake world. No network.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "..", "live-pass.mjs");
const WORLD_MODULE = join(HERE, "fake-world.mjs");
const FAKE_FW = join(HERE, "fake-framework.mjs");

export const ACCOUNT = "0123456789abcdef0123456789abcdef";
/** The sandbox's own Cloudflare values: the primary Cloudflare account's, which the runner must never use. */
export const PRIMARY_ACCOUNT = "fedcba9876543210fedcba9876543210";
export const PRIMARY_TOKEN = "primary-account-token-value-0123456789abcd";
export const OWNER_GROUPS = ["Account API Tokens Write", "Account Settings Write", "D1 Write", "OAuth Client Write", "Secrets Store Write", "Workers Observability Write", "Workers R2 Storage Write", "Workers Scripts Write"];
export const BOOT_GROUPS = ["Workers Scripts Write", "OAuth Client Write", "Secrets Store Write", "Account API Tokens Write"];
export const EVERYDAY_GROUPS = ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write", "Secrets Store Read"];
export const TESTER = "tester@example.com";

export async function harness({ roleWaitSeconds = 1 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "live-pass-offline-"));
  const worldFile = join(dir, "world.json");
  process.env.FAKE_CF_WORLD = worldFile;
  const fw = await import(pathToFileURL(WORLD_MODULE).href);
  const transcript = [];
  /** Only what the runner printed (the transcript also shows the arguments the test passed). */
  const printed = [];
  let containers = 0;

  /** The test Cloudflare account: only the owner (the test Cloudflare account's login) and the owner's token. */
  const w0 = fw.newWorld(ACCOUNT);
  w0.members = [{ id: "m1", status: "accepted", user: { id: "u-owner", email: "owner@example.com" }, roles: [{ id: "r1", name: "Super Administrator - All Privileges" }] }];
  const tokens = { owner: fw.addToken(w0, { name: "live-pass-owner", groups: OWNER_GROUPS, expiresInS: 7 * 86_400 }) };
  writeFileSync(worldFile, JSON.stringify(w0));

  /** A new container: an empty work directory with the app the release candidate creates (stand-in CLI), and an empty secrets directory. */
  const container = () => {
    const n = ++containers;
    const workdir = join(dir, `container-${n}`);
    const project = join(workdir, "project", "livepass");
    mkdirSync(join(project, "node_modules", "@lago-morph", "prototype-framework"), { recursive: true });
    mkdirSync(join(project, "node_modules", ".bin"), { recursive: true });
    mkdirSync(join(project, "config", "cloudflare"), { recursive: true });
    writeFileSync(join(project, "node_modules", "@lago-morph", "prototype-framework", "package.json"), JSON.stringify({ version: "0.2.0-rc01" }));
    writeFileSync(join(project, "config", "cloudflare", "test.json"), '{ "values": {}, "framework": {} }\n');
    const bin = join(project, "node_modules", ".bin", "prototype-framework");
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_FW}" "$@"\n`);
    chmodSync(bin, 0o755);
    const secrets = join(dir, `secrets-${n}`);
    return { workdir, secrets };
  };

  /** What the agent does with a value the owner pastes: one mode-600 file in the mode-700 secrets directory. */
  const paste = (c, name, value) => {
    mkdirSync(c.secrets, { recursive: true, mode: 0o700 });
    chmodSync(c.secrets, 0o700);
    writeFileSync(join(c.secrets, name), `${value}\n`, { mode: 0o600 });
    chmodSync(join(c.secrets, name), 0o600);
  };
  /** The owner's first message: the test Cloudflare account's ID and the owner's token. */
  const firstMessage = (c) => {
    paste(c, "CLOUDFLARE_ACCOUNT_ID", ACCOUNT);
    paste(c, "LIVE_PASS_OWNER_TOKEN", tokens.owner);
  };

  // The sandbox's own environment holds the primary Cloudflare account's token and ID.
  const env = (c) => ({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp", FAKE_CF_WORLD: worldFile, FAKE_PRIMARY_TOKEN: PRIMARY_TOKEN, LIVE_PASS_WORKDIR: c.workdir, LIVE_PASS_SECRETS_DIR: c.secrets, LIVE_PASS_ROLE_WAIT_SECONDS: String(roleWaitSeconds), NODE_OPTIONS: `--import ${pathToFileURL(WORLD_MODULE).href}`, CLOUDFLARE_ACCOUNT_ID: PRIMARY_ACCOUNT, CLOUDFLARE_API_TOKEN: PRIMARY_TOKEN });

  const runOnce = (c, ...args) => {
    const r = spawnSync(process.execPath, [RUNNER, ...args], { env: env(c), encoding: "utf8", timeout: 240_000 });
    transcript.push(`$ live-pass ${args.join(" ")} → ${String(r.status)}\n${r.stdout}${r.stderr}`);
    printed.push(`${r.stdout}${r.stderr}`);
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  let invocations = 0;
  /** Runs a command, then `next` while the runner says its time budget is used up. */
  const run = (c, ...args) => {
    invocations += 1;
    let r = runOnce(c, ...args);
    for (let i = 0; i < 20 && r.status === 11; i++) {
      invocations += 1;
      r = runOnce(c, "next");
    }
    return r;
  };
  const world = () => JSON.parse(readFileSync(worldFile, "utf8"));
  const change = (fn) => {
    const w = world();
    fn(w);
    writeFileSync(worldFile, JSON.stringify(w));
  };
  const records = () => Object.fromEntries(Object.entries(world().buckets["live-pass-records"]?.objects ?? {}).map(([k, o]) => [k, o.body]));
  const prompt = (r, step) => {
    if (r.status !== 10 || !r.out.includes(`OWNER STEP ${step} `)) throw new Error(`expected the owner prompt of ${step}, got exit ${String(r.status)}:\n${transcript.join("\n")}`);
    return r;
  };
  /** A dashboard-made token (the owner's starter tokens: the API cannot make them). */
  const dashboardToken = (name, groups, expiresInS) => {
    let v = "";
    change((w) => {
      v = fw.addToken(w, { name, groups, expiresInS });
    });
    return v;
  };

  // ---- The owner's browser steps, played on the fake world ----
  const owner = {
    acceptInvitation() {
      change((w) => {
        const m = w.members.find((x) => x.user?.email === TESTER);
        m.status = "accepted";
        m.user = { id: "u-tester", email: TESTER };
      });
    },
    adminSignIns() {
      change((w) => {
        fw.addEvent(w, "prototype-admin", "admin signed in");
        fw.addEvent(w, "prototype-admin", "GET /callback", 403);
      });
    },
    accountSetup() {
      change((w) => {
        const db = "db-auth-0001";
        w.d1.push({ uuid: db, name: "prototype-auth" });
        w.d1Rows[db] = { users: [], registry: [], codes: [], sign_ins: [] };
        w.workers["prototype-auth"] = { created_on: "x", modified_on: "x", compatibility_flags: ["nodejs_compat"], observability: null, secrets: [], bindings: [{ type: "d1", name: "DB", id: db }, { type: "secrets_store_secret", name: "AUTH_APP_CLIENT_ID" }, { type: "secrets_store_secret", name: "AUTH_APP_CLIENT_SECRET" }, { type: "plain_text", name: "AUTH_APP_ACCOUNT_ID" }, { type: "plain_text", name: "AUTH_APP_ORIGIN" }] };
        for (const b of ["prototype-logs", "sst-state", "prototype-backups"]) w.buckets[b] = { objects: {}, lifecycle: b === "prototype-backups" ? { rules: [{ id: "expire" }] } : null };
        w.buckets["sst-state"].objects["framework/account.json"] = { body: JSON.stringify({ setupVersion: 2, frameworkVersion: "0.2.0-rc01" }) };
        w.buckets["prototype-logs"].objects["livepass/prodcheck/2026/11/03/000000.000-error-r1.json"] = { body: JSON.stringify({ severity: "error", requestId: "r1" }) };
        fw.addToken(w, { name: "prototype-r2-signing", groups: ["Workers R2 Storage Write"] });
        const signingId = w.tokens.at(-1).id;
        w.stores[0].secrets.push({ id: "s5", name: "PROTOTYPE_R2_ACCESS_KEY_ID", comment: signingId }, { id: "s6", name: "PROTOTYPE_R2_SECRET_ACCESS_KEY", comment: signingId });
      });
    },
    /** Page 2 makes the everyday token and shows its value once; returns that value (which the owner never copies). */
    everydayToken() {
      let v = "";
      change((w) => {
        v = fw.addToken(w, { name: "prototype-framework", groups: EVERYDAY_GROUPS });
      });
      return v;
    },
    ownerSignInAndUpload() {
      change((w) => {
        const db = w.d1.find((d) => d.name === "prototype-auth").uuid;
        w.d1Rows[db].users = [{ sub: "u-owner", email: "owner@example.com", role: "admin", updated_at: 1 }];
        w.buckets["livepass-prodcheck-files"].objects["uploads/u/1"] = { body: "png" };
        fw.addEvent(w, "prototype-auth", "GET /callback", 302);
      });
    },
    testerSignIn(role) {
      change((w) => {
        const db = w.d1.find((d) => d.name === "prototype-auth").uuid;
        const users = w.d1Rows[db].users.filter((u) => u.email !== TESTER);
        w.d1Rows[db].users = [...users, { sub: "u-tester", email: TESTER, role, updated_at: 2 }];
      });
    },
  };

  return { fw, dir, worldFile, tokens, container, paste, firstMessage, env, run, runOnce, world, change, records, prompt, dashboardToken, owner, transcript, printed, invocations: () => invocations };
}
