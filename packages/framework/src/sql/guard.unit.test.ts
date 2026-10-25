import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { wasLogged } from "../log/failures.js";
import type { LogService } from "../log/public.js";
import { PGlite } from "@electric-sql/pglite";
import { atomic } from "./atomic.js";
import { id, text } from "./columns.js";
import { createGuard, normalizeError, PAR_210_MS } from "./guard.js";
import { postgresDb } from "./postgres.js";
import { defineTable, tableFor } from "./table.js";
import type { AnyTable } from "./types.js";
import { newId } from "./values.js";

const wrapped = (cause: unknown): Error => Object.assign(new Error("Failed query: insert into x values (?)\nparams: secret"), { cause });

describe("driver error normalisation (SQL-REQ-006)", () => {
  it("a FrameworkError passes through unchanged", () => {
    const e = new FrameworkError("SQL.INVALID_VALUE", "bad");
    expect(normalizeError(e)).toBe(e);
  });

  it("SQLite and Postgres constraint violations anywhere in the cause chain are SQL.CONFLICT", () => {
    for (const cause of [
      new Error("D1_ERROR: UNIQUE constraint failed: t.name: SQLITE_CONSTRAINT"),
      new Error("FOREIGN KEY constraint failed: SQLITE_CONSTRAINT"),
      Object.assign(new Error("duplicate key value"), { code: "23505" }),
      Object.assign(new Error("violates foreign key constraint"), { code: "23503" }),
    ]) {
      const e = normalizeError(wrapped(cause));
      expect(e.code).toBe("SQL.CONFLICT");
      expect(e.message).not.toContain("secret");
    }
  });

  it("a forced outage fails every operation with SQL.UNAVAILABLE without running it", async () => {
    let ran = false;
    const guard = createGuard({ unavailable: true });
    await expect(guard(async () => { ran = true; })).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    expect(ran).toBe(false);
  });

  it("an operation that does not settle within the budget (PAR-210) is SQL.UNAVAILABLE", async () => {
    const guard = createGuard({ budgetMs: 20 });
    await expect(guard(() => new Promise(() => {}))).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    await expect(guard(() => new Promise((r) => setTimeout(() => r("late"), 200)))).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    await expect(guard(async () => "quick")).resolves.toBe("quick");
    expect(PAR_210_MS).toBe(45_000);
  });

  it("SQL.UNAVAILABLE is logged once through logFailure (LOG-REQ-005)", async () => {
    const writes: [string, string, string][] = [];
    const log: LogService = { write: (component, severity, message) => void writes.push([component, severity, message]) };
    const guard = createGuard({ unavailable: true, log });
    const error = await guard(async () => 1).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "SQL.UNAVAILABLE" });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.slice(0, 2)).toEqual(["SQL", "error"]);
    expect(wasLogged(error)).toBe(true);
  });

  it("errors of an unreachable database are SQL.UNAVAILABLE", () => {
    for (const message of ["Attempted to use poisoned stub.", "Network connection lost.", "connect ECONNREFUSED 127.0.0.1:1"]) {
      expect(normalizeError(wrapped(new Error(message))).code, message).toBe("SQL.UNAVAILABLE");
    }
  });

  it("a driver adds its own unreachable patterns (the Postgres harness's live in postgres.ts, not here)", async () => {
    const closed = wrapped(new Error("Harness is gone"));
    expect(normalizeError(closed).code).toBe("CORE.INTERNAL");
    expect(normalizeError(closed, undefined, [/Harness is gone/]).code).toBe("SQL.UNAVAILABLE");
    await expect(createGuard({ unreachable: [/Harness is gone/] })(() => Promise.reject(closed))).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
  });

  it("any other driver error is a CORE.INTERNAL FrameworkError, never the driver's own error", async () => {
    const driver = new Error("near \"selec\": syntax error");
    const e = normalizeError(wrapped(driver));
    expect(e).toBeInstanceOf(FrameworkError);
    expect(e.code).toBe("CORE.INTERNAL");
    expect(e.message).toContain("syntax error");
    await expect(createGuard()(() => Promise.reject(driver))).rejects.toMatchObject({ code: "CORE.INTERNAL" });
  });
});

describe("a write that commits after PAR-210 is not reported as failed (DEC-0542, SQL-REQ-006)", () => {
  /** A PGlite client whose every answer arrives `delayMs` after the database executed (and committed) the statement. */
  function slowClient(pg: PGlite, delayMs: number): PGlite {
    const late = <T>(value: T) => new Promise<T>((r) => setTimeout(() => r(value), delayMs));
    return new Proxy(pg, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (property === "query" || property === "exec" || property === "transaction") {
          return async (...args: unknown[]) => late(await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    });
  }

  it("an insert, an update and an atomic call whose answer arrives after the budget resolve with their rows; a read still times out", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`CREATE TABLE "notes" ("id" text PRIMARY KEY NOT NULL, "title" text NOT NULL)`);
      const notes = tableFor(defineTable("notes", { id: id(), title: text() }), "postgres") as unknown as AnyTable;
      const db = postgresDb(slowClient(pg, 120), { budgetMs: 20 });
      const [n1, n2] = [newId(), newId()].sort() as [string, string];
      const w = db as unknown as {
        insert(t: unknown): { values(v: unknown): { returning(): Promise<unknown[]> } };
        update(t: unknown): { set(v: unknown): { returning(): Promise<unknown[]> } };
        select(): { from(t: unknown): Promise<unknown[]> };
      };
      await expect(w.insert(notes).values({ id: n1, title: "one" }).returning()).resolves.toEqual([{ id: n1, title: "one" }]);
      await expect(w.update(notes).set({ title: "uno" }).returning()).resolves.toEqual([{ id: n1, title: "uno" }]);
      await expect(atomic(db, [(tx) => (tx as unknown as typeof w).insert(notes).values({ id: n2, title: "two" }) as never])).resolves.toHaveLength(1);
      expect((await pg.query(`SELECT "id", "title" FROM "notes" ORDER BY "id"`)).rows).toEqual([
        { id: n1, title: "uno" },
        { id: n2, title: "two" },
      ]);
      await expect(w.select().from(notes)).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    } finally {
      await pg.close();
    }
  });

  it("a write whose driver reports the database unreachable is still SQL.UNAVAILABLE", async () => {
    await expect(createGuard({ budgetMs: 20 })(() => Promise.reject(new Error("Network connection lost.")), { write: true })).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
  });
});

describe("before the handoff to the driver, a write is bounded by PAR-210 (SQL-REQ-006, DEC-0557)", () => {
  it("a write that cannot get the connection within the budget is SQL.UNAVAILABLE and never runs, even when the connection comes later", async () => {
    let ran = false;
    const never = createGuard({ budgetMs: 20, connection: () => new Promise(() => {}) });
    await expect(never(async () => void (ran = true), { write: true })).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });

    let released = false;
    const late = createGuard({ budgetMs: 20, connection: () => new Promise((r) => setTimeout(() => r(() => void (released = true)), 60)) });
    await expect(late(async () => void (ran = true), { write: true })).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    await new Promise((r) => setTimeout(r, 100));
    expect(ran).toBe(false);
    expect(released).toBe(true);
  });

  it("after the handoff the write is not timed, and the connection is released when it settles", async () => {
    let released = 0;
    const guard = createGuard({ budgetMs: 20, connection: async () => () => void released++ });
    await expect(guard(() => new Promise((r) => setTimeout(() => r("committed"), 80)), { write: true })).resolves.toBe("committed");
    expect(released).toBe(1);
  });

  it("on PGlite, a write queued behind a slow operation on the single connection times out and is never stored; a PGlite that never gets ready is bounded too", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`CREATE TABLE "notes" ("id" text PRIMARY KEY NOT NULL, "title" text NOT NULL)`);
      const notes = tableFor(defineTable("notes", { id: id(), title: text() }), "postgres") as unknown as AnyTable;
      const db = postgresDb(slowQueries(pg, 150), { budgetMs: 30 }) as unknown as { insert(t: unknown): { values(v: unknown): { execute(): Promise<unknown> } } };
      const [first, second] = [newId(), newId()];
      // Both started now, in this order (a builder runs when executed or awaited).
      const a = db.insert(notes).values({ id: first, title: "first" }).execute();
      const b = db.insert(notes).values({ id: second, title: "second" }).execute();
      await expect(b).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
      await expect(a).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 300));
      expect((await pg.query(`SELECT "id" FROM "notes"`)).rows).toEqual([{ id: first }]);

      const stuck = new Proxy(pg, { get: (t, p) => (p === "waitReady" ? new Promise(() => {}) : typeof Reflect.get(t, p, t) === "function" ? (Reflect.get(t, p, t) as (...a: unknown[]) => unknown).bind(t) : Reflect.get(t, p, t)) });
      const never = postgresDb(stuck, { budgetMs: 30 }) as unknown as typeof db;
      await expect(never.insert(notes).values({ id: newId(), title: "never" }).execute()).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    } finally {
      await pg.close();
    }
  });
});

describe("PGlite's connection turns are per client, not per handle (DEC-0557)", () => {
  it("a write on a second handle over the same client, queued behind the first handle's write, times out and is never stored", async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`CREATE TABLE "notes" ("id" text PRIMARY KEY NOT NULL, "title" text NOT NULL)`);
      const notes = tableFor(defineTable("notes", { id: id(), title: text() }), "postgres") as unknown as AnyTable;
      type W = { insert(t: unknown): { values(v: unknown): { execute(): Promise<unknown> } } };
      const client = slowQueries(pg, 150);
      const sqlHandle = postgresDb(client, { budgetMs: 30 }) as unknown as W;
      const kvHandle = postgresDb(client, { budgetMs: 30 }) as unknown as W;
      const [first, second] = [newId(), newId()];
      const a = sqlHandle.insert(notes).values({ id: first, title: "first" }).execute();
      const b = kvHandle.insert(notes).values({ id: second, title: "second" }).execute();
      await expect(b).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
      await expect(a).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 300));
      expect((await pg.query(`SELECT "id" FROM "notes"`)).rows).toEqual([{ id: first }]);
    } finally {
      await pg.close();
    }
  });
});

/** A PGlite client each of whose queries takes `delayMs` before it runs (holding the connection). */
function slowQueries(pg: PGlite, delayMs: number): PGlite {
  return new Proxy(pg, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property === "query" || property === "exec" || property === "transaction") {
        return async (...args: unknown[]) => {
          await new Promise((r) => setTimeout(r, delayMs));
          return (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}
