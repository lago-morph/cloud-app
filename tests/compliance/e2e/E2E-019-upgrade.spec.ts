/**
 * E2E-019 — Upgrade from 0.1.x to 0.2.0 (Where: Local; plan-v0.2.0 §7.1 "Add" item 3, §8).
 *
 * An app made the way 0.1.x users made one (the published 0.1.1 `npm create` starter, with the
 * published 0.1.1 framework) is used under `dev`, then upgraded with its own `npm run upgrade -- 0.2.0`.
 * 0.2.0 is not published yet: this repository's framework, packed and repacked at version 0.2.0, is
 * served for the `@lago-morph` scope by a local registry (support/registry.ts), so `npm view` and
 * `npm install` behave as they will after publishing (DEC-0767). Every other package comes from the
 * public registry, as for any install, so the run needs the npm registry (not a cloud).
 *
 * Expected error: an upgrade to a version the registry does not have stops before changing
 * anything. Edge cases listed before writing (resources/edge-cases.md): the app's own data across
 * the upgrade (a note); every table the framework drops (all five `__framework_auth_*` and
 * `__framework_test_mail`), each present before. Not applicable: text, order and access (the upgrade
 * takes no names or lists; one user's data). The pointer printed is 0.1.1's upgrade command's own
 * wording (`npm run cloudflare-setup`, "needs the bootstrap token once"): the old CLI runs the
 * upgrade, as for every 0.1.x user (DEC-0767).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tag } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { packFramework } from "./support/packs.js";
import { run, startDev, tail, type DevServer } from "./support/process.js";
import { startLocalRegistry, type LocalRegistry } from "./support/registry.js";

const OLD = "0.1.1";
const NEW = "0.2.0";
const DROPPED = ["__framework_auth_user", "__framework_auth_account", "__framework_auth_session", "__framework_auth_verification", "__framework_auth_rate_limit", "__framework_test_mail"];
const USER = "e2e019-user";

/** The environment without cloud credentials. */
function noCredentials(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !/^(CLOUDFLARE_|CF_|AWS_|COMPLIANCE_)/.test(e[0])));
}

/** Every table in the app's local SQLite files (the persisted local D1), outside node_modules. */
function localTables(appDir: string): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (n === "node_modules" || n === ".git") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".sqlite")) {
        const db = new DatabaseSync(p, { readOnly: true });
        for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) out.add(String((row as { name: unknown }).name));
        db.close();
      }
    }
  };
  walk(appDir);
  return out;
}

async function asUser(dev: DevServer, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> {
  const login = await fetch(`${dev.origin}/api/auth/mock-login`, { method: "POST", headers: { "content-type": "application/json", origin: dev.origin }, body: JSON.stringify({ level: "user", id: USER, displayName: "E2E Nineteen" }) });
  expect(login.status, "mock-login").toBe(204);
  const cookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
  const r = await fetch(`${dev.origin}${path}`, { method: init.method ?? "GET", headers: { cookie, origin: dev.origin, "content-type": "application/json" }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

let root = "";
let registry: LocalRegistry | undefined;

test.afterAll(async () => {
  await registry?.close();
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

test(tag("E2E-019", "an app made with 0.1.1 upgrades to 0.2.0 from a local tarball: its notes survive, the upgrade says to re-run Cloudflare setup, and the next dev drops the Better Auth and test-mail tables"), async () => {
  test.setTimeout(45 * 60_000);
  root = mkdtempSync(join(tmpdir(), "e2e019-"));
  const env = noCredentials();

  // 1. A 0.1.1 app, from the published 0.1.1 starter (which installs the published 0.1.1 framework).
  const packed = await run("npm", ["pack", `@lago-morph/create-prototype-app@${OLD}`, "--pack-destination", root], { cwd: root, env, timeoutMs: 300_000 });
  expect(packed.status, tail(packed.output)).toBe(0);
  const starter = join(root, "starter");
  mkdirSync(starter);
  // Synchronous: a command that reads no standard input can close it before `run` writes to it (EPIPE).
  execFileSync("tar", ["xzf", join(root, `lago-morph-create-prototype-app-${OLD}.tgz`), "-C", starter, "--strip-components=1"]);
  const appDir = join(root, "notesapp");
  const created = await run(process.execPath, [join(starter, "bin", "create-prototype-app.js"), appDir], { cwd: root, env, timeoutMs: 20 * 60_000 });
  expect(created.status, `0.1.1 npm create failed:\n${tail(created.output)}`).toBe(0);
  const installedVersion = () => (JSON.parse(readFileSync(join(appDir, "node_modules", "@lago-morph", "prototype-framework", "package.json"), "utf8")) as { version: string }).version;
  expect(installedVersion()).toBe(OLD);

  // 2. Used under 0.1.1's dev: a note, and the 0.1.x framework tables.
  const devCommand = ["npx", "--no-install", "prototype-framework", "dev"];
  const first = await startDev(appDir, { command: devCommand, env });
  let noteText = "";
  try {
    noteText = `kept across the upgrade ${String(Date.now())}`;
    const made = await asUser(first, "/api/notes", { method: "POST", body: { text: noteText } });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
  } finally {
    await first.stop();
  }
  const before = localTables(appDir);
  for (const t of [...DROPPED, "notes"]) expect(before.has(t), `before the upgrade: ${t}`).toBe(true);

  // 3. `npm run upgrade -- 0.2.0`, with 0.2.0 served by the local registry for the scope.
  registry = await startLocalRegistry([await packFramework(root, NEW)]);
  writeFileSync(join(appDir, ".npmrc"), `@lago-morph:registry=${registry.url}\n`);
  // Expected error: a version the registry does not have. The upgrade stops before changing anything.
  const pkgBefore = readFileSync(join(appDir, "package.json"), "utf8");
  const missing = await run("npm", ["run", "upgrade", "--", "0.2.99"], { cwd: appDir, env, timeoutMs: 5 * 60_000 });
  expect(missing.status, tail(missing.output)).not.toBe(0);
  expect(missing.output).toMatch(/0\.2\.99/);
  expect(readFileSync(join(appDir, "package.json"), "utf8"), "package.json unchanged").toBe(pkgBefore);
  expect(installedVersion()).toBe(OLD);
  const upgraded = await run("npm", ["run", "upgrade", "--", NEW], { cwd: appDir, env, timeoutMs: 20 * 60_000 });
  const pin = (JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies["@lago-morph/prototype-framework"];
  expect(pin, tail(upgraded.output)).toBe(NEW);
  // Every upgrade step passed, its `verify` of the 0.1.1 app on 0.2.0 included.
  expect(upgraded.status, tail(upgraded.output)).toBe(0);
  expect(installedVersion()).toBe(NEW);
  // The "re-run setup" pointer (plan §8): 0.2.0 raises the setup versions, so Cloudflare setup must run again.
  expect(upgraded.output, tail(upgraded.output)).toMatch(/Cloudflare setup needs re-running/);
  expect(upgraded.output).toMatch(/npm run cloudflare-setup/);

  // 4. The next dev applies 0.2.0's framework migrations: the tables go, the notes stay.
  const second = await startDev(appDir, { command: devCommand, env });
  try {
    const listed = await asUser(second, "/api/notes");
    expect(listed.status).toBe(200);
    expect((listed.json as { notes: { text: string }[] }).notes.map((n) => n.text)).toContain(noteText);
  } finally {
    await second.stop();
  }
  const after = localTables(appDir);
  expect(DROPPED.filter((t) => after.has(t)), "dropped by 0.2.0's framework migrations").toEqual([]);
  expect(after.has("notes")).toBe(true);
});
