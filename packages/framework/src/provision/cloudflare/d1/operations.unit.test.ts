/**
 * Cloudflare database operations (provisioning.md §2; migrations.md §2 "Cloudflare") against the
 * fake D1 HTTP API (local D1 behind the A-05/A-06 shapes). No Cloudflare call is made.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openFakeD1Api, type FakeD1Api } from "./fake-d1-api.js";
import { d1DatabaseOperations } from "./operations.js";

const ACCOUNT = "acct";
const stage = { app: "notes", stage: "test-abc" };

describe("D1 database operations: create, list, drop", () => {
  let fake: FakeD1Api;
  beforeEach(async () => {
    fake = await openFakeD1Api({ accountId: ACCOUNT, maxDatabases: 2 });
  }, 60_000);
  afterEach(async () => {
    await fake?.close();
  });

  it("createDatabase creates the named D1 database and returns its UUID as the id", async () => {
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    const db = await ops.createDatabase(stage, "notes-test-abc-db-1");
    expect(db).toEqual({ name: "notes-test-abc-db-1", number: 1, id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(await ops.listDatabases()).toEqual([{ name: "notes-test-abc-db-1", id: db.id }]);
  });

  it("the account's D1 database limit (PAR-219) is reported clearly, naming the limit and the way out", async () => {
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    await ops.createDatabase(stage, "notes-test-abc-db-1");
    await ops.createDatabase(stage, "notes-test-abc-db-2");
    const err = await ops.createDatabase(stage, "notes-test-abc-db-3").then(
      () => new Error("expected a failure"),
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/notes-test-abc-db-3/);
    expect(err.message).toMatch(/maximum number of D1 databases/);
    expect(err.message).toMatch(/PAR-219/);
    expect(err.message).toMatch(/code 7406/);
    expect(err.message).toMatch(/remove/);
  });

  it("an unclear answer to a create is resolved by listing the exact name (DEC-0094)", async () => {
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    fake.intercept = async (req, run) => {
      if (req.method !== "POST") return run();
      await run();
      return { status: 502, body: "upstream request failed" };
    };
    const db = await ops.createDatabase(stage, "notes-test-abc-db-1");
    fake.intercept = undefined;
    expect(await ops.listDatabases()).toEqual([{ name: "notes-test-abc-db-1", id: db.id }]);

    fake.intercept = async (req, run) => (req.method === "POST" ? { status: 500, body: "boom" } : run());
    await expect(ops.createDatabase(stage, "notes-test-abc-db-2")).rejects.toThrow(/notes-test-abc-db-2.*HTTP 500/);
  });

  it("dropDatabase deletes the database; one already gone counts as deleted", async () => {
    const ops = d1DatabaseOperations({ api: fake.api, accountId: ACCOUNT });
    const db = await ops.createDatabase(stage, "notes-test-abc-db-1");
    await ops.dropDatabase(stage, db);
    expect(await ops.listDatabases()).toEqual([]);
    await ops.dropDatabase(stage, db);
    fake.intercept = async () => ({ status: 403, body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } });
    await expect(ops.dropDatabase(stage, db)).rejects.toThrow(/notes-test-abc-db-1.*Authentication error/);
  });
});
