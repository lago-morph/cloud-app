/**
 * The test stages' mail capture on `__framework_test_mail` and its route
 * `GET /api/__framework/test-mail?to=` (mail.md §2 "Senders"), on the real local databases:
 * local D1 through Wrangler's getPlatformProxy and the PGlite harness, each with the framework
 * migrations applied. Unit evidence only.
 */
import type { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { RuntimeEnv } from "../core/assemble.js";
import { createErrorHandler } from "../http/errors.js";
import { d1MigrationDatabase, migrateLocal, pgliteMigrationDatabase, type D1Like } from "../mig/apply.js";
import { sqliteDb } from "../sql/d1.js";
import { openPostgres, postgresDb } from "../sql/postgres.js";
import type { PortableDb } from "../sql/types.js";
import { MAIL_BINDINGS } from "./cloudflare.js";
import { createTestMailCapture, latestCapturedTo, sqlCaptureSender, TEST_MAIL_PATH } from "./test-stage.js";

const NO_APP_MIGRATIONS = "/nonexistent-mail-unit-test-migrations";
const A = "a@example.test";
const B = "b@example.test";
const msg = (to: string, subject: string) => ({ to, subject, text: `text ${subject}`, html: `<p>${subject}</p>` });

interface Db {
  readonly name: string;
  readonly db: PortableDb;
  close(): Promise<void>;
}

const dbs: Db[] = [];

beforeAll(async () => {
  const proxy = await getPlatformProxy<{ DB: D1Like }>({ configPath: new URL("../kv/fixtures/wrangler.jsonc", import.meta.url).pathname, persist: false });
  await migrateLocal(d1MigrationDatabase(proxy.env.DB), NO_APP_MIGRATIONS);
  dbs.push({ name: "sqlite (local D1)", db: sqliteDb(proxy.env.DB as never), close: () => proxy.dispose() });
  const pg: PGlite = await openPostgres();
  await migrateLocal(pgliteMigrationDatabase(pg), NO_APP_MIGRATIONS);
  dbs.push({ name: "postgres (PGlite)", db: postgresDb(pg), close: () => pg.close() });
}, 120_000);

afterAll(async () => {
  for (const d of dbs) await d.close();
});

function stageApp(db: PortableDb, env: Record<string, unknown> = {}): { app: Hono<RuntimeEnv>; send: (to: string, subject: string) => Promise<Response> } {
  const capture = createTestMailCapture();
  const app = new Hono<RuntimeEnv>();
  app.onError(createErrorHandler());
  app.use(async (c, next) => {
    c.set("requestId", "r-1");
    c.set("sql", db as never);
    await next();
  });
  // A stand-in for the password provider: one framework route that sends through the capture.
  app.post("/send", async (c) => {
    const { to, subject } = await c.req.json<{ to: string; subject: string }>();
    await capture.sender(c, "Demo").send(msg(to, subject));
    return c.body(null, 204);
  });
  const api = new Hono<RuntimeEnv>();
  capture.routes(api);
  app.route("/api", api);
  return {
    app,
    send: (to, subject) => Promise.resolve(app.request("/send", { method: "POST", body: JSON.stringify({ to, subject }) }, env)),
  };
}

describe.each([0, 1])("test-stage capture, database %#", (index) => {
  const get = (): Db => {
    const d = dbs[index];
    if (d === undefined) throw new Error("database not opened");
    return d;
  };

  it("stores messages; latestCapturedTo reads the newest to an address", async () => {
    const { db } = get();
    let s = 0;
    const sender = sqlCaptureSender(db, "Demo <no-reply@localhost>", () => new Date(Date.UTC(2026, 9, 25, 9, 0, s++)));
    await sender.send(msg(A, "first"));
    await sender.send(msg(B, "other"));
    await sender.send(msg(A, "second"));
    expect(await latestCapturedTo(db, A)).toEqual({ ...msg(A, "second"), from: "Demo <no-reply@localhost>", sentAt: "2026-10-25T09:00:02.000Z" });
    expect((await latestCapturedTo(db, B))?.subject).toBe("other");
    expect(await latestCapturedTo(db, "none@example.test")).toBeUndefined();
  });

  it("the route answers the latest message as JSON, no-store; 404 for none; 400 without `to`", async () => {
    const { db } = get();
    const to = `route-${String(index)}@example.test`;
    const { app, send } = stageApp(db, { [MAIL_BINDINGS.from]: "no-reply@mail.example.test" });
    expect((await send(to, "verify")).status).toBe(204);
    const res = await app.request(`/api${TEST_MAIL_PATH}?to=${encodeURIComponent(to)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ...msg(to, "verify"), from: "Demo <no-reply@mail.example.test>" });
    expect(Object.keys(body).sort()).toEqual(["from", "html", "sentAt", "subject", "text", "to"]);

    const none = await app.request(`/api${TEST_MAIL_PATH}?to=${encodeURIComponent("nobody@example.test")}`);
    expect(none.status).toBe(404);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe("HTTP.NOT_FOUND");
    const missing = await app.request(`/api${TEST_MAIL_PATH}`);
    expect(missing.status).toBe(400);
  });

  it("without FRAMEWORK_MAIL_FROM the capture's from is no-reply@localhost", async () => {
    const { db } = get();
    const to = `nofrom-${String(index)}@example.test`;
    const { send } = stageApp(db);
    await send(to, "x");
    expect((await latestCapturedTo(db, to))?.from).toBe("Demo <no-reply@localhost>");
  });
});
