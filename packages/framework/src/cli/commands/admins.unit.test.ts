/**
 * `admins grant|revoke|list` (CLI-REQ-005, cli.md §2; DEC-0523). Locally over a real persisted
 * local D1 under `<app>/.wrangler/state` (the one `dev` uses), and on Cloudflare over the fake
 * D1 HTTP API (fake-d1-api.ts, local D1 behind the recorded request shapes; never the network).
 * Also: the production-stage refusal before any request, the stage-database refusals, and that
 * no output carries a password, password hash, token or API credential.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { tag } from "../../../../../tests/support/tags.js";
import { deriveUserId } from "../../auth/user-id.js";
import { applyMigrations, d1MigrationDatabase, migrateLocal, type D1Like } from "../../mig/apply.js";
import { readHistory } from "../../mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../mig/migrations-dir.js";
import { openFakeD1Api, type FakeD1Api } from "../../provision/cloudflare/d1/fake-d1-api.js";
import { devPaths } from "../dev/plan.js";
import { captureIo } from "../io.test-support.js";
import { adminsBinding, adminsCommand, openCloudflareDatabase, openLocalDatabase, parseAdminsArgs, type AdminsDeps } from "./admins.js";

// Generated dummy values for tests only.
const PASSWORD_HASH = "0f1e2d3c4b5a69788796a5b4c3d2e1f0:" + "ab".repeat(64);
const SESSION_TOKEN = "sess-token-Zq81mN0pLk2";
const VERIFY_TOKEN = "verify-token-Qw7Er5Ty3";
const API_TOKEN = "cf-api-token-for-tests-9f8e7d";
const SECRETS = [PASSWORD_HASH, SESSION_TOKEN, VERIFY_TOKEN, API_TOKEN, "correct horse battery staple"];

const USER = "__framework_auth_user";

/** Accounts: a verified one with its credential row, session and verification token; an unverified one; an admin with another role. */
async function seed(run: (sql: string, params: readonly unknown[]) => Promise<unknown>): Promise<void> {
  const now = Date.now();
  const user = `INSERT INTO "${USER}" (id, name, email, email_verified, image, created_at, updated_at, role) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`;
  await run(user, ["sub-alice", "Alice", "alice@example.test", 1, now, now, null]);
  await run(user, ["sub-bob", "Bob", "bob@example.test", 0, now, now, null]);
  await run(user, ["sub-carol", "Carol", "carol@example.test", 1, now, now, "editor,admin"]);
  await run(`INSERT INTO "__framework_auth_account" (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, ?, ?, ?)`, [
    "acc-alice",
    "sub-alice",
    "sub-alice",
    PASSWORD_HASH,
    now,
    now,
  ]);
  await run(`INSERT INTO "__framework_auth_session" (id, expires_at, token, created_at, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?)`, ["s1", now + 1e6, SESSION_TOKEN, now, now, "sub-alice"]);
  await run(`INSERT INTO "__framework_auth_verification" (id, identifier, value, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, [
    "v1",
    VERIFY_TOKEN,
    "sub-alice",
    now + 1e6,
    now,
    now,
  ]);
}

function expectNoSecrets(text: string): void {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe("admins: arguments and the production confirmation", () => {
  it("parses grant, revoke and list; the address is trimmed and lowercased", () => {
    expect(parseAdminsArgs(["grant", " Alice@Example.TEST ", "--target", "local"])).toEqual({ action: "grant", email: "alice@example.test", target: "local", stage: "local" });
    expect(parseAdminsArgs(["list", "--target", "cloudflare", "--stage", "test-x"])).toEqual({ action: "list", email: undefined, target: "cloudflare", stage: "test-x" });
    expect(parseAdminsArgs(["revoke", "a@b.c", "--target", "cloudflare", "--stage", "prod", "--confirm-production", "prod"]).stage).toBe("prod");
  });

  it.each([
    [[], /usage: admins/],
    [["promote", "a@b.c", "--target", "local"], /usage: admins/],
    [["grant", "--target", "local"], /needs an email address/],
    [["grant", "not-an-address", "--target", "local"], /must be an email address/],
    [["grant", "a@b.c"], /--target is missing/],
    [["grant", "a@b.c", "--target", "local", "--stage", "dev"], /can only be local/],
    [["grant", "a@b.c", "--target", "local", "--confirm-production", "local"], /only for production stages/],
    [["grant", "a@b.c", "--target", "cloudflare"], /--stage is missing/],
    [["grant", "a@b.c", "--target", "cloudflare", "--stage", "test-x", "--confirm-production", "test-x"], /test stage/],
    [["grant", "a@b.c", "--target", "cloudflare", "--stage", "prodcheck"], /production stage: .*--confirm-production prodcheck/],
    [["grant", "a@b.c", "--target", "cloudflare", "--stage", "prodcheck", "--confirm-production", "prod"], /production stage/],
    [["list", "--target", "cloudflare", "--stage", "prodcheck"], /production stage/],
  ])("refuses %j as a usage error", (args, message) => {
    expect(() => parseAdminsArgs(args)).toThrow(message);
  });

  it(tag("CLI-AC-007", "a production stage without --confirm-production (or with another name) exits 2 and sends no request to the D1 API"), async () => {
    const requests: string[] = [];
    const recorded: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    };
    const env = { CLOUDFLARE_API_TOKEN: API_TOKEN, CLOUDFLARE_ACCOUNT_ID: "acct" };
    const command = await adminsBinding(env, recorded);
    const { runCommand } = await import("../main.js");
    for (const args of [
      ["grant", "alice@example.test", "--target", "cloudflare", "--stage", "prodcheck"],
      ["grant", "alice@example.test", "--target", "cloudflare", "--stage", "prodcheck", "--confirm-production", "prod"],
      ["revoke", "alice@example.test", "--target", "cloudflare", "--stage", "prodcheck"],
      ["list", "--target", "cloudflare", "--stage", "prodcheck"],
    ]) {
      const io = captureIo(mkdtempSync(join(tmpdir(), "admins-prod-")));
      expect(await runCommand(["admins", ...args], io, { admins: { summary: "", run: command } }), args.join(" ")).toBe(2);
      expectNoSecrets(io.out + io.err);
    }
    expect(requests).toEqual([]);
  });
});

describe("admins on Cloudflare, through the D1 HTTP API (fake)", () => {
  const ACCOUNT = "acct-unit";
  let fake: FakeD1Api;
  let uuid: string;

  const deps = (overrides: Partial<AdminsDeps> = {}): AdminsDeps => ({
    env: {},
    appName: async () => "notes",
    openLocal: () => Promise.reject(new Error("not local")),
    openCloudflare: ({ app, stage }) => openCloudflareDatabase({ api: fake.api, accountId: ACCOUNT, app, stage }),
    ...overrides,
  });
  const run = async (args: string[], d: AdminsDeps = deps()) => {
    const io = captureIo("/app");
    const status = await adminsCommand(d)(args, io);
    expectNoSecrets(io.out + io.err);
    return { status, out: io.out, err: io.err };
  };
  const role = async (subject: string) => {
    const rows = await fake.database(uuid).prepare(`SELECT role FROM "${USER}" WHERE id = ?`).bind(subject).all<{ role: string | null }>();
    return rows.results?.[0]?.role;
  };
  const cloud = (action: string[], stage = "test-x") => [...action, "--target", "cloudflare", "--stage", stage];

  beforeAll(async () => {
    fake = await openFakeD1Api({ accountId: ACCOUNT });
    const created = await fake.api("POST", `/accounts/${ACCOUNT}/d1/database`, { name: "notes-test-x-db-1" });
    uuid = (created.body as { result: { uuid: string } }).result.uuid;
    const binding = fake.database(uuid) as D1Like & { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } };
    await applyMigrations(d1MigrationDatabase(binding), { framework: readHistory(FRAMEWORK_MIGRATIONS_DIR, "sqlite", "framework"), app: [] });
    await seed((sql, params) => binding.prepare(sql).bind(...params).run());
  }, 60_000);
  afterAll(async () => {
    await fake?.close();
  });

  it(tag("CLI-AC-007", "grant and revoke write the role column through /query; list prints address, user ID and roles; output holds no secret"), async () => {
    const alice = await deriveUserId("password", "sub-alice");
    fake.requests.length = 0;
    const granted = await run(cloud(["grant", "Alice@Example.test"]));
    expect(granted).toEqual({ status: 0, out: `granted admin on test-x: user ${alice}, roles admin\n`, err: "" });
    expect(await role("sub-alice")).toBe("admin");
    // Every request is a D1 list or /query of this database, through the HTTP API.
    expect(fake.requests.map((r) => `${r.method} ${r.path.split("?")[0]}`)).toEqual([
      `GET /accounts/${ACCOUNT}/d1/database`,
      `POST /accounts/${ACCOUNT}/d1/database/${uuid}/query`,
      `POST /accounts/${ACCOUNT}/d1/database/${uuid}/query`,
    ]);
    // Only `role` is written; nothing else of the account table is read.
    const sent = JSON.stringify(fake.requests.map((r) => r.body));
    expect(sent).not.toMatch(/password|token|__framework_auth_(account|session|verification)/);
    expect(sent).toMatch(/UPDATE \\"__framework_auth_user\\" SET role = \? WHERE id = \?/);

    const again = await run(cloud(["grant", "alice@example.test"]));
    expect(again.status).toBe(0);
    expect(again.out).toBe(granted.out);
    const listed = await run(cloud(["list"]));
    expect(listed.status).toBe(0);
    expect(listed.out).toBe(`alice@example.test  ${alice}  admin\ncarol@example.test  ${await deriveUserId("password", "sub-carol")}  editor,admin\n`);

    const revoked = await run(cloud(["revoke", "alice@example.test"]));
    expect(revoked).toEqual({ status: 0, out: `revoked admin on test-x: user ${alice}, roles none\n`, err: "" });
    expect(await role("sub-alice")).toBeNull();
    expect((await run(cloud(["revoke", "alice@example.test"]))).status).toBe(0);
    expect(await role("sub-alice")).toBeNull();

    // Revoking from an account with another role keeps that role.
    expect((await run(cloud(["revoke", "carol@example.test"]))).out).toMatch(/roles editor\n$/);
    expect(await role("sub-carol")).toBe("editor");
    expect((await run(cloud(["list"]))).out).toBe("no admins on test-x\n");
  });

  it(tag("CLI-AC-007", "an unknown address and an unverified account exit 1 and change nothing"), async () => {
    for (const email of ["nobody@example.test", "bob@example.test"]) {
      fake.requests.length = 0;
      const result = await run(cloud(["grant", email]));
      expect(result).toEqual({ status: 1, out: "", err: "admins: no verified account with this address on test-x\n" });
      expect(JSON.stringify(fake.requests.map((r) => r.body))).not.toContain("UPDATE");
    }
    expect(await role("sub-bob")).toBeNull();
  });

  it("a stage with no database, or with more than one, is refused with exit 1 before any query", async () => {
    fake.requests.length = 0;
    const none = await run(cloud(["grant", "alice@example.test"], "test-none"));
    expect(none.status).toBe(1);
    expect(none.err).toMatch(/has no D1 database/);
    await fake.api("POST", `/accounts/${ACCOUNT}/d1/database`, { name: "notes-test-two-db-1" });
    await fake.api("POST", `/accounts/${ACCOUNT}/d1/database`, { name: "notes-test-two-db-2" });
    fake.requests.length = 0;
    const two = await run(cloud(["list"], "test-two"));
    expect(two.status).toBe(1);
    expect(two.err).toMatch(/has 2 D1 databases .*schema-changing deploy/);
    expect(fake.requests.filter((r) => r.path.endsWith("/query"))).toEqual([]);
  });

  it("a confirmed production stage is read and changed like any other", async () => {
    const created = await fake.api("POST", `/accounts/${ACCOUNT}/d1/database`, { name: "notes-prodcheck-db-3" });
    const prod = (created.body as { result: { uuid: string } }).result.uuid;
    const binding = fake.database(prod) as D1Like & { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } };
    await applyMigrations(d1MigrationDatabase(binding), { framework: readHistory(FRAMEWORK_MIGRATIONS_DIR, "sqlite", "framework"), app: [] });
    await seed((sql, params) => binding.prepare(sql).bind(...params).run());
    const result = await run([...cloud(["grant", "alice@example.test"], "prodcheck"), "--confirm-production", "prodcheck"]);
    expect(result.status).toBe(0);
    expect(result.out).toMatch(/^granted admin on prodcheck: user u_[A-Z2-7]{26}, roles admin\n$/);
  });

  it("missing credentials and an unreachable process are refused before any request", async () => {
    const io = captureIo(mkdtempSync(join(tmpdir(), "admins-cred-")));
    const command = await adminsBinding({ CLOUDFLARE_ACCOUNT_ID: "acct" }, async () => {
      throw new Error("no request expected");
    });
    expect(await command(cloud(["list"]), io)).toBe(1);
    expect(io.err).toBe("admins failed: missing Cloudflare credentials: CLOUDFLARE_API_TOKEN (set them in the environment; values are never printed)\n");
    const proxied = await run(cloud(["list"]), deps({ env: { HTTPS_PROXY: "http://proxy.invalid:1" } }));
    expect(proxied.status).toBe(1);
    expect(proxied.err).toMatch(/NODE_USE_ENV_PROXY=1/);
  });
});

describe("admins locally, over the persisted local D1", () => {
  let appDir: string;

  beforeAll(async () => {
    appDir = mkdtempSync(join(tmpdir(), "admins-local-"));
    const paths = devPaths(appDir);
    mkdirSync(join(appDir, ".framework", "local"), { recursive: true });
    mkdirSync(join(appDir, "migrations"), { recursive: true });
    mkdirSync(paths.persistTo, { recursive: true });
    writeFileSync(
      paths.wranglerConfig,
      JSON.stringify({
        name: `admins-unit-${process.pid}`,
        compatibility_date: "2026-10-01",
        d1_databases: [{ binding: "DB", database_name: "admins-unit", database_id: "00000000-0000-0000-0000-00000000ad01" }],
      }),
    );
    const proxy = await getPlatformProxy<{ DB: D1Like & { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } } }>({
      configPath: paths.wranglerConfig,
      persist: { path: paths.platformProxyPersist },
    });
    try {
      await migrateLocal(d1MigrationDatabase(proxy.env.DB), join(appDir, "migrations"));
      await seed((sql, params) => proxy.env.DB.prepare(sql).bind(...params).run());
    } finally {
      await proxy.dispose();
    }
  }, 60_000);
  afterAll(() => {
    if (appDir !== undefined) rmSync(appDir, { recursive: true, force: true });
  });

  const local = (args: string[]) => [...args, "--target", "local"];
  const run = async (args: string[]) => {
    const io = captureIo(appDir);
    const status = await adminsCommand({
      env: {},
      appName: () => Promise.reject(new Error("the local path needs no app name")),
      openLocal: openLocalDatabase,
      openCloudflare: () => Promise.reject(new Error("not cloud")),
    })(args, io);
    expectNoSecrets(io.out + io.err);
    return { status, out: io.out, err: io.err };
  };
  const role = async () => {
    const opened = await openLocalDatabase(appDir);
    try {
      return (await opened.db.query(`SELECT role FROM "${USER}" WHERE id = ?`, ["sub-alice"]))[0]?.["role"];
    } finally {
      await opened.close();
    }
  };

  it(tag("CLI-AC-006", "grant prints the user ID and writes admin; list shows it; revoke leaves NULL; repeats exit 0; refusals exit 1"), async () => {
    const alice = await deriveUserId("password", "sub-alice");
    expect(await run(local(["grant", "alice@example.test"]))).toEqual({ status: 0, out: `granted admin on local: user ${alice}, roles admin\n`, err: "" });
    expect(await role()).toBe("admin");
    expect((await run(local(["grant", "alice@example.test"]))).status).toBe(0);
    expect((await run(local(["list"]))).out).toContain(`alice@example.test  ${alice}  admin\n`);
    expect(await run(local(["revoke", "alice@example.test"]))).toEqual({ status: 0, out: `revoked admin on local: user ${alice}, roles none\n`, err: "" });
    expect(await role()).toBeNull();
    expect((await run(local(["revoke", "alice@example.test"]))).status).toBe(0);
    expect(await role()).toBeNull();
    for (const email of ["nobody@example.test", "bob@example.test"]) {
      expect(await run(local(["grant", email]))).toEqual({ status: 1, out: "", err: "admins: no verified account with this address on local\n" });
    }
  });

  it("without a local database yet, it says to run dev first and exits 1", async () => {
    const empty = mkdtempSync(join(tmpdir(), "admins-empty-"));
    try {
      const io = captureIo(empty);
      const status = await adminsCommand({ env: {}, appName: async () => "x", openLocal: openLocalDatabase, openCloudflare: () => Promise.reject(new Error("x")) })(local(["list"]), io);
      expect(status).toBe(1);
      expect(io.err).toMatch(/run npm run dev once/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
