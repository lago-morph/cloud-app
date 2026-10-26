/**
 * Better Auth's tables in a test app's database (password.md §2 "Tables"; plan-auth.md item
 * I-A), once per dialect process: local D1 (Miniflare, through Wrangler's getPlatformProxy) or
 * PGlite. `createTestApp` applies the framework history before the app's, so every app's
 * database has the five `__framework_auth_*` tables, recorded as `framework/0001_auth_tables`,
 * and they can be written and read through the request's SQL handle.
 * Imports the framework: load only after the dialect is selected.
 */
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineApp } from "../../../src/index.js";
import { createTestApp, type TestApp } from "../../../src/testing/index.js";
import { AUTH_MODEL_NAMES, authTables } from "../../../src/auth/password/tables.js";
import { frameworkTables } from "../../../src/mig/framework.js";
import { DIALECT_LABEL, type Dialect } from "../sql/support/dialect.js";
import { probeRoutes, run } from "../sql/support/probe.js";

const app = defineApp({ name: "authtables", config: {}, secrets: [], tables: {}, routes: (api) => probeRoutes(api) });
const HOOK = 120_000;

/** The request's SQL handle as a plain Drizzle database (framework-internal test use only). */
type AnyDb = {
  select(fields?: unknown): { from(table: unknown): Promise<Record<string, unknown>[]> & { where(c: unknown): Promise<Record<string, unknown>[]>; orderBy(o: unknown): Promise<Record<string, unknown>[]> } };
  insert(table: unknown): { values(v: unknown): Promise<unknown> };
  delete(table: unknown): { where(c: unknown): Promise<unknown> };
};

export function defineAuthTablesSuite(dialect: Dialect): void {
  describe(`Better Auth's tables (${DIALECT_LABEL[dialect]})`, () => {
    let testApp: TestApp;
    beforeAll(async () => {
      testApp = await createTestApp(app);
    }, HOOK);
    afterAll(async () => {
      await testApp?.dispose();
    }, HOOK);

    it("the framework history, auth tables included, is applied and recorded before any app migration", async () => {
      const record = await run(testApp, async (v) => {
        const db = v.sql as unknown as AnyDb;
        const m = frameworkTables(dialect).migrations;
        return db.select({ id: m.id, dialect: m.dialect }).from(m).orderBy(asc(m.id));
      });
      expect(record).toEqual([
        { id: "framework/0000_framework_tables", dialect },
        { id: "framework/0001_auth_tables", dialect },
        { id: "framework/0002_framework_test_mail", dialect },
        { id: "framework/0003_auth_role", dialect },
      ]);
      const counts = await run(testApp, async (v) => {
        const db = v.sql as unknown as AnyDb;
        const t = authTables(dialect);
        const out: Record<string, number> = {};
        for (const [model, table] of Object.entries(t)) out[model] = (await db.select().from(table)).length;
        return out;
      });
      expect(counts).toEqual({ user: 0, account: 0, session: 0, verification: 0, rateLimit: 0 });
    });

    it("each table takes and returns BA's fields, with dates as Date and the user's rows cascading", async () => {
      const at = new Date(Date.UTC(2026, 9, 25, 9, 30, 0, 456));
      const rows = await run(testApp, async (v) => {
        const db = v.sql as unknown as AnyDb;
        const t = authTables(dialect);
        await db.insert(t.user).values({ id: "u1", name: "Eve", email: "eve@example.test", createdAt: at, updatedAt: at });
        await db.insert(t.account).values({ id: "a1", accountId: "u1", providerId: "credential", userId: "u1", password: "h", createdAt: at, updatedAt: at });
        await db.insert(t.session).values({ id: "s1", token: "tok", userId: "u1", expiresAt: at, createdAt: at, updatedAt: at });
        await db.insert(t.verification).values({ id: "v1", identifier: "i", value: "x", expiresAt: at, createdAt: at, updatedAt: at });
        await db.insert(t.rateLimit).values({ id: "r1", key: "127.0.0.1|/sign-in/email", count: 1, lastRequest: at.getTime() });
        const read = {
          user: await db.select().from(t.user).where(eq(t.user.id, "u1")),
          session: await db.select().from(t.session).where(eq(t.session.id, "s1")),
          verification: await db.select().from(t.verification).where(eq(t.verification.id, "v1")),
          rateLimit: await db.select().from(t.rateLimit).where(eq(t.rateLimit.id, "r1")),
        };
        await db.delete(t.user).where(eq(t.user.id, "u1"));
        return { read, afterDelete: { account: (await db.select().from(t.account)).length, session: (await db.select().from(t.session)).length } };
      });
      expect(rows.read.user).toEqual([{ id: "u1", name: "Eve", email: "eve@example.test", emailVerified: false, image: null, createdAt: at, updatedAt: at, role: null }]);
      expect(rows.read.session[0]).toMatchObject({ token: "tok", userId: "u1", expiresAt: at });
      expect(rows.read.verification[0]).toMatchObject({ identifier: "i", expiresAt: at });
      expect(rows.read.rateLimit[0]).toMatchObject({ key: "127.0.0.1|/sign-in/email", count: 1, lastRequest: at.getTime() });
      expect(rows.afterDelete).toEqual({ account: 0, session: 0 });
    });

    it("the auth table names keep the reserved prefix, so no app table can take them", () => {
      for (const name of Object.values(AUTH_MODEL_NAMES)) expect(name.startsWith("__framework_auth_")).toBe(true);
    });
  });
}
