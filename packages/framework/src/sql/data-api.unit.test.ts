/**
 * The Data API adapter (plan-aws G-02) against the in-process Data API fake (G-F1). The fake is
 * a PRE-CHECK, never AWS evidence (DEC-PENDING-g-f1-1): these tests show that the adapter's code
 * paths work against the fake's assumed shapes; phase L confirms them on AWS.
 */
import { ExecuteStatementCommand } from "@aws-sdk/client-rds-data";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import type { LogService } from "../log/public.js";
import { boolean, id, integer, number, ref, text, timestamp } from "./columns.js";
import {
  DataApiFake,
  FAKE_RESOURCE_ARN,
  FAKE_SECRET_ARN,
  databaseResumingError,
  responseTooLargeError,
  sqlStateError,
} from "./data-api-fake.test-support.js";
import {
  RESUME_BACKOFF,
  checkRecords,
  createDataApiClient,
  dataApiClient,
  dataApiDb,
  normalizeParameters,
  resumeDelayMs,
  type DataApiClock,
  type DataApiOptions,
} from "./data-api.js";
import { PAR_210_MS } from "./guard.js";
import { asc, atomic, avg, count, eq, max, min, sum } from "./public.js";
import { defineTable, tableFor } from "./table.js";
import type { AnyTable, PortableDb } from "./types.js";

const parents = defineTable("parents", { id: id(), name: text().unique() });
const things = defineTable("things", {
  id: id(),
  parentId: ref(() => parents.id).nullable(),
  name: text(),
  score: integer().nullable(),
  ratio: number().nullable(),
  at: timestamp().nullable(),
  flag: boolean().default(false),
});
const T = <X extends AnyTable>(t: X): X => tableFor(t, "postgres") as unknown as X;
const P = T(parents);
const TH = T(things);

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const TARGET = { resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN, database: "app" };

let fake: DataApiFake;
const exec = (sql: string) => fake.send(new ExecuteStatementCommand({ resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN, database: "app", sql }));
// The fake's SQL exceptions carry the SQLSTATE only in the message, with no pg `code` on them
// or on a cause, as the SDK's do; so the adapter must classify by the message (G-S1 finding (b)).
const handle = (options: DataApiOptions = {}): PortableDb => dataApiDb(fake.client, TARGET, options);

beforeAll(async () => {
  fake = await DataApiFake.create({ databases: ["app"], defaultDatabase: "app", resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN,
    // Read the clock at each call, so `resume({ untilMs })` follows vitest's fake timers.
    now: () => Date.now(),
  });
  const imports = { parents: P, things: TH };
  for (const statement of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(imports))) await exec(statement);
}, 120_000);
afterAll(async () => {
  await fake?.close();
});
beforeEach(async () => {
  fake.clearInjections();
  await exec("delete from things");
  await exec("delete from parents");
});
afterEach(() => {
  vi.useRealTimers();
});

/** A clock on vitest's fake timers: `Date.now`, `setTimeout`, and a fixed random source. */
function fakeClock(random = 0.5): DataApiClock & { slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    now: () => Date.now(),
    sleep: (ms) => {
      slept.push(ms);
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    random: () => random,
  };
}

function recordingLog(): LogService & { entries: string[] } {
  const entries: string[] = [];
  return { entries, write: (_component: string, _level: string, message: string) => void entries.push(message) } as unknown as LogService & { entries: string[] };
}

describe("resume backoff (proposed PAR-275: 250 ms base, factor 2, 5 s cap, full jitter)", () => {
  it("delay n is random(0, min(5 s, 250 ms × 2ⁿ))", () => {
    expect(RESUME_BACKOFF).toEqual({ baseMs: 250, factor: 2, capMs: 5_000 });
    const ceilings = [0, 1, 2, 3, 4, 5, 6, 10].map((n) => resumeDelayMs(n, () => 0.999999999));
    expect(ceilings.map(Math.round)).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000, 5000]);
    expect(resumeDelayMs(3, () => 0)).toBe(0);
    expect(resumeDelayMs(3, () => 0.25)).toBe(500);
  });
});

describe("the resume retry loop", () => {
  it(tag("SQL-AC-006", "with a resuming error on every attempt, the retry loop gives up at PAR-210 with SQL.UNAVAILABLE (logged once)"), async () => {
    vi.useFakeTimers();
    const clock = fakeClock(0.5);
    const log = recordingLog();
    const db = handle({ clock, log });
    fake.resume({ calls: Number.POSITIVE_INFINITY });
    const from = fake.calls.length;
    const started = Date.now();
    const outcome = db.select({ id: P.id }).from(P).then(
      () => "resolved",
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(PAR_210_MS + 10_000);
    const error = (await outcome) as { name: string; code: string; message: string };
    expect(error).toMatchObject({ name: "FrameworkError", code: "SQL.UNAVAILABLE" });
    expect(error.message).toMatch(/resum/i);
    // random 0.5: 125, 250, 500, 1000, 2000, then 2500 each; the 17th 2500 ms wait would end past 45 s.
    expect(clock.slept).toEqual([125, 250, 500, 1000, 2000, ...Array.from({ length: 16 }, () => 2500)]);
    const waited = clock.slept.reduce((a, b) => a + b, 0);
    expect(waited).toBe(43_875);
    expect(waited + 2500).toBeGreaterThan(PAR_210_MS);
    expect(fake.calls.length - from).toBe(clock.slept.length + 1);
    expect(fake.calls.slice(from).every((c) => c.command === "ExecuteStatement")).toBe(true);
    // It gave up before the guard's own PAR-210 timer, at the last attempt.
    expect(Date.now() - started).toBeLessThanOrEqual(PAR_210_MS + 10_000);
    expect(log.entries.filter((m) => m.includes("SQL.UNAVAILABLE"))).toHaveLength(1);
  });

  it("succeeds once the database has resumed, after the injected waits", async () => {
    vi.useFakeTimers();
    const clock = fakeClock(1 - Number.EPSILON);
    const db = handle({ clock });
    await db.insert(P).values({ id: uuid(1), name: "one" });
    fake.resume({ untilMs: Date.now() + 15_000 });
    const rows = db.select({ id: P.id, name: P.name }).from(P);
    const settled = rows.then((r) => r);
    await vi.advanceTimersByTimeAsync(PAR_210_MS);
    expect(await settled).toEqual([{ id: uuid(1), name: "one" }]);
    const waited = clock.slept.reduce((a, b) => a + b, 0);
    expect(waited).toBeGreaterThanOrEqual(15_000);
    expect(waited).toBeLessThan(15_000 + RESUME_BACKOFF.capMs);
  });

  it("a resume during BeginTransaction is retried too; atomic then commits", async () => {
    vi.useFakeTimers();
    const clock = fakeClock(0.5);
    const db = handle({ clock });
    fake.resume({ calls: 2 });
    const from = fake.calls.length;
    const done = atomic(db, [(w) => w.insert(P).values({ id: uuid(2), name: "two" })]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await done).toEqual([undefined]);
    expect(clock.slept).toEqual([125, 250]);
    expect(fake.calls.slice(from).map((c) => c.command)).toEqual([
      "BeginTransaction",
      "BeginTransaction",
      "BeginTransaction",
      "ExecuteStatement",
      "CommitTransaction",
    ]);
  });

  it("other errors are not retried", async () => {
    const clock = fakeClock();
    const db = handle({ clock });
    fake.inject(sqlStateError("42P01", 'relation "x" does not exist'));
    await expect(db.select({ id: P.id }).from(P)).rejects.toMatchObject({ code: "CORE.INTERNAL" });
    expect(clock.slept).toEqual([]);
  });

  it("a forced outage is SQL.UNAVAILABLE without any call", async () => {
    const from = fake.calls.length;
    await expect(handle({ unavailable: true }).select({ id: P.id }).from(P)).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
    expect(fake.calls.length).toBe(from);
  });
});

describe("error mapping (SQL-REQ-006)", () => {
  it(tag("SQL-AC-006", "unique and reference violations (SQLSTATE in the message) are SQL.CONFLICT"), async () => {
    const db = handle();
    const conflict = { name: "FrameworkError", code: "SQL.CONFLICT" };
    await db.insert(P).values({ id: uuid(1), name: "first" });
    await expect(db.insert(P).values({ id: uuid(2), name: "first" })).rejects.toMatchObject(conflict);
    await expect(db.insert(P).values({ id: uuid(1), name: "other" })).rejects.toMatchObject(conflict);
    await expect(db.insert(TH).values({ id: uuid(3), parentId: uuid(999), name: "orphan" })).rejects.toMatchObject(conflict);
    await db.insert(TH).values({ id: uuid(4), parentId: uuid(1), name: "child" });
    await expect(db.delete(P).where(eq(P.id, uuid(1)))).rejects.toMatchObject(conflict);
  });

  it.each(["BadRequestException", "DatabaseErrorException"] as const)("SQLSTATE 23505 and 23503 under %s are SQL.CONFLICT; others CORE.INTERNAL", async (exception) => {
    const db = handle();
    for (const state of ["23505", "23503"]) {
      fake.inject(sqlStateError(state, "violation", { exception, detail: "Key (name)=(secret) already exists." }));
      const e = await db.select({ id: P.id }).from(P).then(() => undefined, (x: unknown) => x as Error);
      expect(e).toMatchObject({ name: "FrameworkError", code: "SQL.CONFLICT" });
      expect(e?.message).not.toContain("secret");
    }
    fake.inject(sqlStateError("22003", "integer out of range", { exception }));
    await expect(db.select({ id: P.id }).from(P)).rejects.toMatchObject({ code: "CORE.INTERNAL" });
  });

  it(tag("SQL-AC-006", "the Data API response-size error (PAR-214) is SQL.RESULT_TOO_LARGE"), async () => {
    const db = handle();
    fake.inject(responseTooLargeError());
    const e = await db.select({ id: P.id }).from(P).then(() => undefined, (x: unknown) => x as Error);
    expect(e).toMatchObject({ name: "FrameworkError", code: "SQL.RESULT_TOO_LARGE" });
    expect(e?.message).toMatch(/PAR-214/);
  });

  it(tag("SQL-AC-006", "a result larger than PAR-215 is SQL.RESULT_TOO_LARGE; exactly PAR-215 bytes succeeds"), async () => {
    const db = handle();
    const names = [...Array.from({ length: 63 }, (_, i) => `${i}`.padEnd(4096, "x")), "é".repeat(2048)];
    for (let i = 0; i < names.length; i += 16) {
      await db.insert(P).values(names.slice(i, i + 16).map((name, j) => ({ id: uuid(1000 + i + j), name })));
    }
    expect(await db.select({ name: P.name }).from(P)).toHaveLength(64);
    await db.insert(P).values({ id: uuid(2000), name: "x" });
    await expect(db.select({ name: P.name }).from(P)).rejects.toMatchObject({ name: "FrameworkError", code: "SQL.RESULT_TOO_LARGE" });
  });

  it("an unavailable service (ServiceUnavailableError) is SQL.UNAVAILABLE", async () => {
    const db = handle();
    fake.inject(Object.assign(new Error("Service unavailable"), { name: "ServiceUnavailableError" }));
    await expect(db.select({ id: P.id }).from(P)).rejects.toMatchObject({ code: "SQL.UNAVAILABLE" });
  });
});

describe("value round-trips (SQL-REQ-004)", () => {
  it(tag("SQL-AC-004", "integer, number, timestamp, boolean, text and NULL come back in their JS types"), async () => {
    const db = handle();
    await db.insert(P).values({ id: uuid(1), name: "Émile 𝄞" });
    const rows = [
      { id: uuid(11), parentId: uuid(1), name: "a", score: 2147483647, ratio: 1.5, at: Number.MAX_SAFE_INTEGER, flag: true },
      { id: uuid(12), parentId: null, name: "b", score: -2147483648, ratio: 3, at: 0, flag: false },
      { id: uuid(13), parentId: null, name: "c", score: null, ratio: 1e300, at: null, flag: false },
      { id: uuid(14), parentId: null, name: "d", score: 0, ratio: -0, at: 1, flag: true },
      { id: uuid(15), parentId: null, name: "e", score: 1, ratio: 5e-324, at: 2, flag: false },
      { id: uuid(16), parentId: null, name: "f", score: 2, ratio: -9007199254740994, at: 3, flag: false },
    ];
    await db.insert(TH).values(rows);
    const back = await db.select().from(TH).orderBy(asc(TH.id));
    expect(back).toEqual(rows.map((r) => ({ ...r, ratio: r.ratio === 0 ? 0 : r.ratio })));
    expect(Object.is(back[3]?.ratio, 0)).toBe(true);
    expect(await db.select({ name: P.name }).from(P)).toEqual([{ name: "Émile 𝄞" }]);
    // Comparisons bind the same way: an integral double beyond int64 and a 32-bit bound.
    expect(await db.select({ id: TH.id }).from(TH).where(eq(TH.ratio, 1e300))).toEqual([{ id: uuid(13) }]);
    expect(await db.select({ id: TH.id }).from(TH).where(eq(TH.score, -2147483648))).toEqual([{ id: uuid(12) }]);
    const updated = await db.update(TH).set({ ratio: 2 ** 60, at: 5 }).where(eq(TH.id, uuid(12))).returning({ ratio: TH.ratio, at: TH.at });
    expect(updated).toEqual([{ ratio: 2 ** 60, at: 5 }]);
  });

  it(tag("SQL-AC-003", "count, sum and avg are JS numbers; min/max keep the column type; empty input"), async () => {
    const db = handle();
    expect(await db.select({ n: count(), s: sum(TH.score), a: avg(TH.ratio), lo: min(TH.at) }).from(TH)).toEqual([{ n: 0, s: null, a: null, lo: null }]);
    await db.insert(TH).values([
      { id: uuid(21), name: "a", score: 10, ratio: 1.5, at: 100 },
      { id: uuid(22), name: "b", score: 5, ratio: 2.5, at: 50 },
    ]);
    expect(await db.select({ n: count(), s: sum(TH.score), a: avg(TH.ratio), lo: min(TH.at), hi: max(TH.name) }).from(TH)).toEqual([
      { n: 2, s: 15, a: 2, lo: 50, hi: "b" },
    ]);
  });

  it("writes without returning resolve to undefined", async () => {
    const db = handle();
    expect(await db.insert(P).values({ id: uuid(1), name: "x" })).toBeUndefined();
    expect(await db.update(P).set({ name: "y" }).where(eq(P.id, uuid(1)))).toBeUndefined();
    expect(await db.delete(P).where(eq(P.id, uuid(1)))).toBeUndefined();
  });

  it("normalizeParameters sends an integral number beyond the safe range as a double", () => {
    expect(
      normalizeParameters([
        { name: "1", value: { longValue: 1e300 } },
        { name: "2", value: { longValue: 7 } },
        { name: "3", value: { isNull: true } },
      ]),
    ).toEqual([
      { name: "1", value: { doubleValue: 1e300 } },
      { name: "2", value: { longValue: 7 } },
      { name: "3", value: { isNull: true } },
    ]);
  });

  it("checkRecords refuses a long that is not a safe JS integer (SQL.INVALID_VALUE)", () => {
    expect(() => checkRecords([[{ longValue: 2 ** 53 + 2 }]])).toThrow(expect.objectContaining({ code: "SQL.INVALID_VALUE" }));
    expect(() => checkRecords([[{ longValue: 2 ** 53 - 1 }, { isNull: true }, { booleanValue: false }, { doubleValue: 0.5 }]])).not.toThrow();
    expect(() => checkRecords(undefined)).not.toThrow();
  });
});

describe("atomic over Data API transactions (SQL-REQ-005)", () => {
  const snapshot = async (db: PortableDb) => ({
    parents: await db.select().from(P).orderBy(asc(P.id)),
    things: await db.select().from(TH).orderBy(asc(TH.id)),
  });

  it(tag("SQL-AC-005", "applies every step in one transaction and resolves per step"), async () => {
    const db = handle();
    const from = fake.calls.length;
    const results = await atomic(db, [
      (w) => w.insert(P).values({ id: uuid(60), name: "third" }),
      (w) => w.insert(TH).values({ id: uuid(61), parentId: uuid(60), name: "child" }).returning({ id: TH.id }),
      (w) => w.update(TH).set({ score: 3 }).where(eq(TH.parentId, uuid(60))).returning({ id: TH.id, score: TH.score }),
    ] as const);
    expect(results).toEqual([undefined, [{ id: uuid(61) }], [{ id: uuid(61), score: 3 }]]);
    const sent = fake.calls.slice(from);
    expect(sent.map((c) => c.command)).toEqual(["BeginTransaction", "ExecuteStatement", "ExecuteStatement", "ExecuteStatement", "CommitTransaction"]);
    expect(sent.filter((c) => c.command === "ExecuteStatement").every((c) => typeof c.input["transactionId"] === "string")).toBe(true);
  });

  it(tag("SQL-AC-005", "a last step that violates a constraint leaves no rows from earlier steps (rollback)"), async () => {
    const db = handle();
    await db.insert(P).values({ id: uuid(1), name: "first" });
    const before = await snapshot(db);
    const from = fake.calls.length;
    await expect(
      atomic(db, [
        (w) => w.insert(P).values({ id: uuid(62), name: "fourth" }),
        (w) => w.insert(P).values({ id: uuid(63), name: "first" }),
      ] as const),
    ).rejects.toMatchObject({ name: "FrameworkError", code: "SQL.CONFLICT" });
    expect(fake.calls.slice(from).map((c) => c.command).at(-1)).toBe("RollbackTransaction");
    expect(await snapshot(db)).toEqual(before);
  });

  it(tag("SQL-AC-005", "a step built on the outer handle is rejected with CORE.INTERNAL before anything executes"), async () => {
    const db = handle();
    const from = fake.calls.length;
    await expect(
      atomic(db, [(w) => w.insert(P).values({ id: uuid(65), name: "a" }), () => db.insert(P).values({ id: uuid(66), name: "b" })]),
    ).rejects.toMatchObject({ name: "FrameworkError", code: "CORE.INTERNAL" });
    expect(fake.calls.slice(from).some((c) => c.command === "ExecuteStatement")).toBe(false);
    expect(await db.select({ id: P.id }).from(P)).toEqual([]);
  });

  it("a resume budget exhausted inside atomic is SQL.UNAVAILABLE", async () => {
    vi.useFakeTimers();
    const db = handle({ clock: fakeClock(0.5) });
    fake.resume({ calls: Number.POSITIVE_INFINITY });
    const outcome = atomic(db, [(w) => w.insert(P).values({ id: uuid(70), name: "z" })]).then(() => "resolved", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(PAR_210_MS + 10_000);
    expect(await outcome).toMatchObject({ code: "SQL.UNAVAILABLE" });
  });
});

describe("the SDK client", () => {
  it("is made once per cold start, with SDK retries off and the proxy-aware Node handler", async () => {
    const env = process.env["AWS_REGION"];
    process.env["AWS_REGION"] ??= "us-east-1";
    try {
      expect(dataApiClient()).toBe(dataApiClient());
      const client = createDataApiClient({ region: "eu-west-1" });
      expect(await client.config.maxAttempts()).toBe(1);
      expect(await client.config.region()).toBe("eu-west-1");
      expect(client.config.requestHandler).toBeInstanceOf(NodeHttpHandler);
      client.destroy();
    } finally {
      if (env === undefined) delete process.env["AWS_REGION"];
    }
  });

  it("a resuming error from the client itself is recognised by name", async () => {
    vi.useFakeTimers();
    const clock = fakeClock(0);
    const db = handle({ clock });
    fake.inject(databaseResumingError(), { times: 3 });
    const rows = db.select({ id: P.id }).from(P).then((r) => r);
    await vi.advanceTimersByTimeAsync(10);
    expect(await rows).toEqual([]);
    expect(clock.slept).toEqual([0, 0, 0]);
  });
});
