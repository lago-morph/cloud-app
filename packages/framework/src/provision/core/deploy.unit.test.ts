import { describe, expect, it } from "vitest";
import { captureIo } from "../../cli/io.test-support.js";
import type { Histories } from "../../mig/apply.js";
import type { Migration } from "../../mig/history.js";
import { runDeploy, type DeployRequest } from "./deploy.js";
import { FakeTarget } from "./fake-target.js";

const stage = { app: "notes", stage: "test-abc" };
const db = (n: number) => `notes-test-abc-db-${n}`;

function mig(id: string): Migration {
  const [history, name] = id.split("/") as [string, string];
  const file = `/app/${history === "app" ? "" : "node_modules/fw/"}migrations/sqlite/${name}.sql`;
  return { id, name, file, text: "", checksum: "0", statements: [] };
}
const histories = (app: string[] = ["app/0000_schema"]): Histories => ({
  framework: [mig("framework/0000_framework_tables")],
  app: app.map(mig),
});
const ALL = ["framework/0000_framework_tables", "app/0000_schema"];

function request(overrides: Partial<DeployRequest> = {}): DeployRequest {
  return { stage, migrations: histories(), requiredSecrets: [], ...overrides };
}

/** A stage deployed once: database db-<n> with every migration of `histories()`, app answering. */
function deployedTarget(n = 1, extra: ConstructorParameters<typeof FakeTarget>[0] = {}): FakeTarget {
  const t = new FakeTarget({ databases: [{ name: db(n), records: ALL, rows: 5 }], ...extra });
  const s = t.stageState(stage);
  s.resources.push({ kind: "bucket", id: "b" }, { kind: "runtime", id: "r" });
  s.secrets = new Set(["apiKey"]);
  s.code = { database: db(n) };
  s.running = true;
  return t;
}

const changingCalls = (t: FakeTarget) =>
  t.calls.filter((c) => !/^(preflight|inspectAccount|readAccountSettings|readStageRecord|listSetSecrets|listStageResources|checkHealth)\b/.test(c));

describe("deploy step 2: database discovery (PROV-REQ-002)", () => {
  it("[COMPL-AC-007] takes the lowest-numbered stage database as current and deletes and reports every higher-numbered one", async () => {
    const t = new FakeTarget({
      databases: [
        { name: db(5), records: ALL },
        { name: db(2), records: ALL, rows: 7 },
        { name: db(3), records: ALL },
        { name: "notes-test-abcd-db-1", records: ALL },
        { name: "notes-prod-db-1", records: ALL },
      ],
    });
    const io = captureIo();
    const result = await runDeploy(t, request(), io);
    expect(result.status).toBe(0);
    expect(t.calls).toContain(`dropDatabase ${db(3)}`);
    expect(t.calls).toContain(`dropDatabase ${db(5)}`);
    expect(t.calls.filter((c) => c.startsWith("dropDatabase"))).toHaveLength(2);
    expect(t.calls).toContain(`deployCode notes/test-abc ${db(2)}`);
    expect(t.calls.some((c) => c.startsWith("createDatabase") || c.startsWith("copyDatabase"))).toBe(false);
    expect([...t.databases.keys()].sort()).toEqual(["notes-prod-db-1", db(2), "notes-test-abcd-db-1"]);
    expect(io.out).toContain(`removed leftover database ${db(3)}`);
    expect(io.out).toContain(`removed leftover database ${db(5)}`);
  });

  it("[CLI-AC-003] a failure deleting a leftover database stops the deploy at step 2 with failure status", async () => {
    const t = new FakeTarget({ databases: [{ name: db(1), records: ALL }, { name: db(2) }] }).fail("dropDatabase", new Error("D1 busy"));
    const io = captureIo();
    const result = await runDeploy(t, request(), io);
    expect(result.status).toBe(1);
    expect(result.failure?.step).toBe("databases");
    expect(io.err).toMatch(/step 2 \(find the databases\)/);
    expect(io.err).toMatch(/D1 busy/);
    expect(t.calls.some((c) => c.startsWith("deploy"))).toBe(false);
  });
});

describe("deploy sequence (PROV-REQ-002, MIG-REQ-006)", () => {
  it("first deploy: infrastructure, first database with migrations applied, code, explicit start, health; prints the origin", async () => {
    const t = new FakeTarget();
    const io = captureIo();
    const result = await runDeploy(t, request(), io);
    expect(result).toMatchObject({ status: 0, publicOrigin: "https://notes-test-abc.fake.example" });
    expect(changingCalls(t)).toEqual([
      "deployInfrastructure notes/test-abc",
      `createDatabase ${db(1)}`,
      `applyMigration ${db(1)} framework/0000_framework_tables`,
      `applyMigration ${db(1)} app/0000_schema`,
      `deployCode notes/test-abc ${db(1)}`,
      "startApp notes/test-abc",
    ]);
    expect(t.answering(stage)).toBe(db(1));
    expect(io.out).toContain("https://notes-test-abc.fake.example");
  });

  it("with nothing pending: no stop, copy or database change, and the app is still started explicitly", async () => {
    const t = deployedTarget(4);
    const result = await runDeploy(t, request(), captureIo());
    expect(result.status).toBe(0);
    expect(changingCalls(t)).toEqual(["deployInfrastructure notes/test-abc", `deployCode notes/test-abc ${db(4)}`, "startApp notes/test-abc"]);
    expect(t.databaseNames(stage)).toEqual([db(4)]);
  });

  it("with pending migrations: stop, copy, migrate, check, delete old, deploy, start; one database remains", async () => {
    const t = deployedTarget(2);
    const result = await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), captureIo());
    expect(result.status).toBe(0);
    expect(changingCalls(t)).toEqual([
      "deployInfrastructure notes/test-abc",
      "stopApp notes/test-abc",
      `copyDatabase ${db(2)} ${db(3)}`,
      `applyMigration ${db(3)} app/0001_more`,
      `checkMigratedDatabase ${db(3)}`,
      `dropDatabase ${db(2)}`,
      `deployCode notes/test-abc ${db(3)}`,
      "startApp notes/test-abc",
    ]);
    expect(t.databaseNames(stage)).toEqual([db(3)]);
    expect(t.databases.get(db(3))?.rows).toBe(5);
    expect(t.answering(stage)).toBe(db(3));
  });

  it("a failing migration: new database deleted, previous version restarted on the unchanged database, failure printed with file, error, state and next action", async () => {
    const t = deployedTarget(2);
    t.failingMigrations.set("app/0001_more", new Error("near \"TABEL\": syntax error"));
    const io = captureIo();
    const result = await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), io);
    expect(result.status).toBe(1);
    expect(result.failure).toMatchObject({ step: "migrate", migrationFile: "/app/migrations/sqlite/0001_more.sql" });
    expect(t.databaseNames(stage)).toEqual([db(2)]);
    expect([...(t.databases.get(db(2))?.records ?? [])]).toEqual(ALL);
    expect(t.answering(stage)).toBe(db(2));
    expect(t.calls.slice(-3)).toEqual([`dropDatabase ${db(3)}`, "startApp notes/test-abc", "checkHealth https://notes-test-abc.fake.example"]);
    expect(t.calls.some((c) => c.startsWith("deployCode"))).toBe(false);
    expect(io.err).toMatch(/step 4 \(migrate\)/);
    expect(io.err).toContain("migration file: /app/migrations/sqlite/0001_more.sql");
    expect(io.err).toContain('database error: near "TABEL": syntax error');
    expect(io.err).toContain(`stage state: previous version restarted; database ${db(2)} unchanged`);
    expect(io.err).toMatch(/next action: fix .* and run deploy again/);
  });

  it("[PROV-AC-002, MIG-AC-003] after a failing migration, the restarted previous version is reported restarted only once it answers healthy", async () => {
    const t = deployedTarget(2);
    t.answerDelayMs = 2000; // the restarted route answers 404 for its first 2 s
    t.failingMigrations.set("app/0001_more", new Error("syntax error"));
    const io = captureIo();
    const result = await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), io);
    expect(result.status).toBe(1);
    expect(t.calls.slice(-3)).toEqual([`dropDatabase ${db(3)}`, "startApp notes/test-abc", "checkHealth https://notes-test-abc.fake.example"]);
    const started = t.stageState(stage).startedAt ?? Number.NaN;
    expect(t.healthTries.filter((x) => x >= started)).toEqual([started, started + 1000, started + 2000]);
    expect(io.err).toContain(`stage state: previous version restarted; database ${db(2)} unchanged`);
    expect(io.err).not.toContain("not answering");
  });

  it("[PROV-AC-002, MIG-AC-003] a restarted previous version that does not answer within 30 s is reported as not answering, exit 1", async () => {
    const t = deployedTarget(2);
    t.answerDelayMs = 60_000;
    t.failingMigrations.set("app/0001_more", new Error("syntax error"));
    const io = captureIo();
    const result = await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), io);
    expect(result.status).toBe(1);
    expect(result.failure?.step).toBe("migrate");
    expect(t.healthTries.at(-1)! - t.healthTries[0]!).toBe(30_000);
    expect(io.err).toContain(`stage state: previous version restarted but not answering (status 404); database ${db(2)} unchanged`);
    expect(io.err).not.toContain(`stage state: previous version restarted; database ${db(2)} unchanged`);
  });

  it("[provisioning.md §2] a migration that fails after the copy still prints which copy ran, as does the after-copy abort", async () => {
    const t = deployedTarget(2);
    t.failingMigrations.set("app/0001_more", new Error("syntax error"));
    const io = captureIo();
    expect((await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), io)).status).toBe(1);
    expect(io.out).toContain(`copied database ${db(2)} into ${db(3)}: fake copy`);
    const aborted = deployedTarget(2);
    const abortIo = captureIo();
    expect((await runDeploy(aborted, request({ migrations: histories(["app/0000_schema", "app/0001_more"]), abortAt: "after-copy" }), abortIo)).status).toBe(1);
    expect(abortIo.out).toContain(`copied database ${db(2)} into ${db(3)}: fake copy`);
  });

  it("a failing check takes the same failure path", async () => {
    const t = deployedTarget(2);
    t.checkFailure = new Error("row count of notes changed: 5 → 4");
    const io = captureIo();
    const result = await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), io);
    expect(result.status).toBe(1);
    expect(result.failure?.step).toBe("migrate");
    expect(t.databaseNames(stage)).toEqual([db(2)]);
    expect(t.answering(stage)).toBe(db(2));
    expect(io.err).toMatch(/check of the migrated database failed: row count of notes changed/);
    expect(io.err).toContain(`stage state: previous version restarted; database ${db(2)} unchanged`);
    expect(io.err).not.toContain("not answering");
  });

  it("failing stop, copy or old-database deletion also restart the previous version on the unchanged database", async () => {
    for (const op of ["stopApp", "copyDatabase", "dropDatabase"] as const) {
      const t = deployedTarget(2).fail(op, new Error(`${op} broke`), 1);
      const io = captureIo();
      const result = await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), io);
      expect(result.status, op).toBe(1);
      expect(t.databaseNames(stage), op).toEqual([db(2)]);
      expect(t.answering(stage), op).toBe(db(2));
      expect(io.err, op).toContain(`${op} broke`);
      expect(io.err, op).toContain(`stage state: previous version restarted; database ${db(2)} unchanged`);
      expect(io.err, op).not.toContain("not answering");
    }
  });

  it("[CLI-AC-003] a failing cleanup keeps the original failure's status, step and message, and reports the cleanup failure", async () => {
    const t = deployedTarget(2);
    t.failingMigrations.set("app/0001_more", new Error("syntax error"));
    t.fail("dropDatabase", new Error("delete refused")).fail("startApp", new Error("route API down"));
    const io = captureIo();
    const result = await runDeploy(t, request({ migrations: histories(["app/0000_schema", "app/0001_more"]) }), io);
    expect(result.status).toBe(1);
    expect(result.failure).toMatchObject({ step: "migrate", databaseError: "syntax error" });
    expect(result.failure?.cleanupErrors).toEqual([`deleting new database ${db(3)}: delete refused`, "restarting the previous version: route API down"]);
    expect(io.err).toContain("database error: syntax error");
    expect(io.err).toContain("delete refused");
    expect(io.err).toContain("route API down");
    expect(io.err).toMatch(/previous version NOT restarted/);
    expect(io.err).toMatch(new RegExp(`${db(3)} left behind`));
  });

  it("a failing migration on a stage's first database deletes that database and reports no version deployed", async () => {
    const t = new FakeTarget();
    t.failingMigrations.set("app/0000_schema", new Error("bad"));
    const io = captureIo();
    const result = await runDeploy(t, request(), io);
    expect(result.status).toBe(1);
    expect(t.databaseNames(stage)).toEqual([]);
    expect(t.calls.some((c) => c.startsWith("deployCode") || c.startsWith("stopApp"))).toBe(false);
    expect(io.err).toMatch(/stage state: no version deployed/);
  });

  it("[CLI-AC-003] failures of steps 3, 5 and 6 stop the deploy with failure status naming the step", async () => {
    const cases = [
      ["deployInfrastructure", "infrastructure", /step 3 \(long-lived infrastructure\)/],
      ["deployCode", "code", /step 5 \(code\)/],
      ["startApp", "start", /step 6 \(start\)/],
    ] as const;
    for (const [op, step, text] of cases) {
      const t = deployedTarget(1).fail(op, new Error(`${op} exploded`));
      const io = captureIo();
      const result = await runDeploy(t, request(), io);
      expect(result.status, op).toBe(1);
      expect(result.failure?.step, op).toBe(step);
      expect(io.err, op).toMatch(text);
      expect(io.err, op).toContain(`${op} exploded`);
      expect(io.err, op).toMatch(/next action:/);
    }
  });

  it("health failure: failure status, the error code and requestId printed", async () => {
    const t = deployedTarget(1);
    t.health = { ok: false, message: "health returned 500", status: 500, code: "SEC.MISSING", requestId: "req-123" };
    const io = captureIo();
    const result = await runDeploy(t, request(), io);
    expect(result.status).toBe(1);
    expect(result.failure?.step).toBe("health");
    expect(io.err).toMatch(/step 7 \(health check\)/);
    expect(io.err).toContain("SEC.MISSING");
    expect(io.err).toContain("req-123");
  });
});

describe("deploy step 1: preflight (PROV-REQ-002, PROV-REQ-004)", () => {
  it("names every missing prerequisite and creates nothing", async () => {
    const t = deployedTarget(1);
    t.missingPrerequisites = ["CLOUDFLARE_API_TOKEN", "permission to create R2 API tokens"];
    const io = captureIo();
    const result = await runDeploy(
      t,
      request({ requiredSecrets: ["apiKey", "otherKey"], validateConfiguration: async () => ["config/cloudflare/test.json: unknown key \"x\""] }),
      io,
    );
    expect(result.status).toBe(1);
    expect(result.failure?.step).toBe("preflight");
    for (const name of ["CLOUDFLARE_API_TOKEN", "permission to create R2 API tokens", "otherKey", 'unknown key "x"']) expect(io.err).toContain(name);
    expect(io.err).not.toMatch(/\bapiKey\b/);
    expect(changingCalls(t)).toEqual([]);
  });

  it("[PROV-AC-004] (core part) a production stage needs the account's email domain (its EMAIL binding); its email setup is not checked (v0.2.0); a test stage needs neither", async () => {
    const prod = { app: "notes", stage: "prod" };
    const t = new FakeTarget({ accountSettings: {} });
    t.stageState(prod).secrets = new Set();
    const io = captureIo();
    expect((await runDeploy(t, request({ stage: prod }), io)).status).toBe(1);
    expect(io.err).toContain("the account settings record names no email domain, which a production stage's EMAIL binding still needs");
    expect(io.err).not.toContain("--email-domain");
    expect(changingCalls(t)).toEqual([]);

    // A test stage deploys without one, and its steps get no email domain.
    const test = new FakeTarget({ accountSettings: {} });
    expect((await runDeploy(test, request(), captureIo())).status).toBe(0);
    expect(test.deployedEmailDomains).toEqual([undefined, undefined]);

    // With a domain (a 0.1.x record), the domain reaches steps 3 and 5, and the result names the sign-in page and the sender.
    const u = new FakeTarget();
    u.stageState(prod).secrets = new Set();
    const io3 = captureIo();
    expect((await runDeploy(u, request({ stage: prod }), io3)).status).toBe(0);
    expect(u.deployedEmailDomains).toEqual(["example.test", "example.test"]);
    expect(io3.out).toContain("sign-in page: https://notes-prod.fake.example/api/auth/sign-in");
    expect(io3.out).toContain("sender address: no-reply@example.test");
  });

  it("a test stage's result names no sign-in page or sender; its steps still get the recorded email domain", async () => {
    const t = new FakeTarget();
    const io = captureIo();
    expect((await runDeploy(t, request(), io)).status).toBe(0);
    expect(io.out).not.toMatch(/sign-in page|sender address/);
    expect(t.deployedEmailDomains).toEqual(["example.test", "example.test"]);
  });

  it("a production stage needs no retired Google setting or secret (DEC-0513)", async () => {
    const prod = { app: "notes", stage: "prod" };
    const t = new FakeTarget();
    t.stageState(prod).secrets = new Set();
    const io = captureIo();
    expect((await runDeploy(t, request({ stage: prod }), io)).status).toBe(0);
    expect(`${io.err}${io.out}`).not.toMatch(/google/i);
  });

  it("missing shared resources: deploy fails with a clear message to run setup-account, creating nothing", async () => {
    const t = new FakeTarget({ sharedResources: { "R2 bucket prototype-logs": "absent" } });
    const io = captureIo();
    expect((await runDeploy(t, request(), io)).status).toBe(1);
    expect(io.err).toContain("R2 bucket prototype-logs");
    expect(io.err).toMatch(/setup-account/);
    expect(changingCalls(t)).toEqual([]);
  });

  it("[PROV-AC-007] (core part) a shared resource owned by another account stops deploy with a message naming it and changes nothing", async () => {
    const t = new FakeTarget({ sharedResources: { "R2 bucket prototype-logs": "foreign" } });
    const io = captureIo();
    expect((await runDeploy(t, request(), io)).status).toBe(1);
    expect(io.err).toContain("R2 bucket prototype-logs");
    expect(io.err).toMatch(/another account/);
    expect(changingCalls(t)).toEqual([]);
  });

  it("a throwing check is reported as a missing prerequisite, not a crash", async () => {
    const t = new FakeTarget().fail("preflight", new Error("credentials rejected"));
    const io = captureIo();
    expect((await runDeploy(t, request(), io)).status).toBe(1);
    expect(io.err).toContain("credentials rejected");
    expect(changingCalls(t)).toEqual([]);
  });
});

describe("first deploy secret check (provisioning.md §2 'First Cloudflare deploy')", () => {
  it("checks the required secrets right after step 5; if any is unset, stops the app, names them and fails", async () => {
    const t = new FakeTarget();
    const io = captureIo();
    const result = await runDeploy(t, request({ requiredSecrets: ["apiKey", "mailKey"] }), io);
    expect(result.status).toBe(1);
    expect(result.failure?.step).toBe("code");
    expect(changingCalls(t).slice(-2)).toEqual([`deployCode notes/test-abc ${db(1)}`, "stopApp notes/test-abc"]);
    expect(t.calls).not.toContain("startApp notes/test-abc");
    expect(io.err).toContain("apiKey");
    expect(io.err).toContain("mailKey");
    expect(io.err).toMatch(/secrets set/);

    t.stageState(stage).secrets = new Set(["apiKey", "mailKey"]);
    expect((await runDeploy(t, request({ requiredSecrets: ["apiKey", "mailKey"] }), captureIo())).status).toBe(0);
    expect(t.answering(stage)).toBe(db(1));
  });
});

describe("runner-only abort points (compliance.md §2 'Deploy recovery')", () => {
  it("stopped after the database copy, a re-run leaves one database and the app answering", async () => {
    const t = deployedTarget(2);
    const req = request({ migrations: histories(["app/0000_schema", "app/0001_more"]) });
    const aborted = await runDeploy(t, { ...req, abortAt: "after-copy" }, captureIo());
    expect(aborted.status).toBe(1);
    expect(t.databaseNames(stage)).toEqual([db(2), db(3)]);
    expect(t.answering(stage)).toBeNull();
    expect((await runDeploy(t, req, captureIo())).status).toBe(0);
    expect(t.databaseNames(stage)).toHaveLength(1);
    expect(t.answering(stage)).toBe(t.databaseNames(stage)[0]);
  });

  it("stopped after the code deploy, a re-run leaves one database and the app answering", async () => {
    const t = deployedTarget(2);
    const req = request({ migrations: histories(["app/0000_schema", "app/0001_more"]) });
    const io = captureIo();
    expect((await runDeploy(t, { ...req, abortAt: "after-code" }, io)).status).toBe(1);
    expect(io.err).toMatch(/abort point after the code deploy/);
    expect(t.answering(stage)).toBeNull();
    expect((await runDeploy(t, req, captureIo())).status).toBe(0);
    expect(t.databaseNames(stage)).toEqual([db(3)]);
    expect(t.answering(stage)).toBe(db(3));
  });
});
