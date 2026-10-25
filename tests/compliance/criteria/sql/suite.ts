/**
 * SQL-AC-003…-006: one shared suite, the reference app's `sql` case set
 * (`apps/reference/src/server/cases/sql.ts`), with literal expectations from sql.md and
 * sql.d.ts. The same expectations run in-process on local D1 and PGlite and through the
 * reference app on every target, so passing everywhere is "identical results on every target"
 * (SQL-REQ-003); floats compare with PAR-280.
 *
 * Seed (one per suite run, under a random namespace): author A with posts `apple`, `Banana`,
 * `Äpfel`, `zebra`, `école` and three tags, author B with none (10 rows). Each other case
 * writes and removes its own handful of rows.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { expectApprox, expectCaseError, expectUndefined, newNamespace, valueOf, type CaseRunner, type Place } from "./support/runner.js";

const HOOK_MS = 180_000;
const TEST_MS = 120_000;

/** PAR-215 is 256 KiB: one row of 270,000 ASCII characters exceeds it, one of 200,000 does not. */
const OVERSIZED_CHARS = 270_000;
const FITTING_CHARS = 200_000;

/** Every catalogue code (errors.d.ts), for "rejects with a catalogue error". */
const CATALOGUE_CODES: readonly string[] = Array.from(
  readFileSync(new URL("../../../../docs/contracts/ts/errors.d.ts", import.meta.url), "utf8").matchAll(/^\s*readonly "([A-Z]+\.[A-Z_]+)":/gm),
  (m) => m[1] ?? "",
);

const num = (value: number | null) => ({ value, type: value === null ? "null" : "number" });
const str = (value: string | null) => ({ value, type: value === null ? "null" : "string" });
const bool = (value: boolean | null) => ({ value, type: value === null ? "null" : "boolean" });

export function defineSqlSuite(place: Place, makeRunner: () => Promise<CaseRunner>): void {
  const t = (id: string, title: string): string => tag(id, `${title} (${place})`);

  describe(`SQL shared case set (${place})`, () => {
    let runner: CaseRunner;
    const ns = newNamespace();
    const run = (name: string, input: unknown = { ns }) => runner.run("sql", name, input);

    beforeAll(async () => {
      runner = await makeRunner();
      // Clear anything an interrupted earlier run of the same namespace left (none expected), then seed.
      expectUndefined(await run("cleanup"));
      expectUndefined(await run("seed"));
    }, HOOK_MS);

    afterAll(async () => {
      if (runner === undefined) return;
      try {
        expectUndefined(await run("cleanup"));
      } finally {
        await runner.dispose();
      }
    }, HOOK_MS);

    // ---- SQL-AC-003: every supported feature, identical results --------------------------

    it(t("SQL-AC-003", "ordering: asc puts NULLs first and desc last, text by code point (accented and mixed case), booleans, limit and offset"), async () => {
      expect(valueOf(await run("ordering"))).toEqual({
        titleAsc: ["Banana", "apple", "zebra", "Äpfel", "école"],
        titleDesc: ["école", "Äpfel", "zebra", "apple", "Banana"],
        ratingAsc: ["Banana", "zebra", "Äpfel", "école", "apple"],
        ratingDesc: ["apple", "Äpfel", "école", "Banana", "zebra"],
        seenAtDesc: ["école", "Äpfel", "apple", "Banana", "zebra"],
        weightAsc: ["Banana", "école", "Äpfel", "zebra", "apple"],
        flagAsc: ["Banana", "école", "Äpfel", "apple", "zebra"],
        flagDesc: ["apple", "zebra", "Äpfel", "Banana", "école"],
        limitOffset: ["apple", "zebra"],
        limitOnly: ["école", "zebra", "Äpfel"],
      });
    }, TEST_MS);

    it(t("SQL-AC-003", "comparison, boolean, null, inArray, notInArray and between expressions on every column type"), async () => {
      expect(valueOf(await run("filters"))).toEqual({
        eq: ["Banana", "école"],
        ne: ["apple", "zebra", "Äpfel"],
        gt: ["apple", "zebra"],
        gte: ["Banana", "apple", "zebra", "école"],
        lt: ["Äpfel"],
        lte: ["Banana", "Äpfel", "école"],
        and: ["Banana", "zebra", "Äpfel"],
        between: ["Banana", "zebra", "Äpfel"],
        or: ["Banana", "apple", "zebra"],
        not: ["Banana", "Äpfel", "école"],
        isNull: ["zebra"],
        isNotNull: ["apple", "zebra", "Äpfel"],
        inArray: ["apple", "zebra"],
        notInArray: ["Banana", "Äpfel", "école"],
        boolFalse: ["Äpfel"],
        textCaseSensitive: [],
        textGreater: ["apple", "zebra", "Äpfel", "école"],
        numberLess: ["Banana"],
        timestampEq: ["Äpfel"],
      });
    }, TEST_MS);

    it(t("SQL-AC-003", "containsText: empty needle matches every non-NULL value, %, _ and \\ are literal, only ASCII A-Z folds, NULL never matches"), async () => {
      expect(valueOf(await run("text"))).toEqual({
        empty: ["Banana", "apple", "Äpfel", "école"],
        percent: ["apple"],
        percentWildcard: [],
        underscore: ["Banana"],
        underscoreWildcard: [],
        backslash: ["Banana"],
        asciiFold: ["apple"],
        asciiFoldUpperNeedle: ["Äpfel"],
        nonAsciiNotFolded: [],
        nonAsciiExact: ["Äpfel"],
        titleA: ["Banana", "apple", "zebra"],
        titleAccented: [],
      });
    }, TEST_MS);

    it(t("SQL-AC-003", "aggregates: count, countDistinct, min/max keep the column type, sum/avg are numbers, empty input gives 0 or null, groupBy"), async () => {
      expectApprox(valueOf(await run("aggregates")), {
        rows: {
          count: num(5),
          countBody: num(4),
          countDistinctVotes: num(4),
          countDistinctRating: num(2),
          minTitle: str("Banana"),
          maxTitle: str("école"),
          minVotes: num(0),
          maxVotes: num(7),
          minScore: num(-2.25),
          maxScore: num(10),
          minCreatedAt: num(1000),
          maxCreatedAt: num(5000),
          minSeenAt: num(5000),
          maxRating: num(5),
          sumVotes: num(12),
          avgVotes: num(2.4),
          sumScore: num(10),
          avgScore: num(2),
          sumWeight: num(4.25),
          avgWeight: num(4.25 / 3),
          sumRating: num(9),
          avgRating: num(3),
        },
        empty: {
          count: num(0),
          countBody: num(0),
          countDistinctVotes: num(0),
          countDistinctRating: num(0),
          minTitle: str(null),
          maxTitle: str(null),
          minVotes: num(null),
          maxVotes: num(null),
          minScore: num(null),
          maxScore: num(null),
          minCreatedAt: num(null),
          maxCreatedAt: num(null),
          minSeenAt: num(null),
          maxRating: num(null),
          sumVotes: num(null),
          avgVotes: num(null),
          sumScore: num(null),
          avgScore: num(null),
          sumWeight: num(null),
          avgWeight: num(null),
          sumRating: num(null),
          avgRating: num(null),
        },
        grouped: [
          { done: false, doneType: "boolean", n: 3, votes: 2, maxTitle: "école" },
          { done: true, doneType: "boolean", n: 2, votes: 10, maxTitle: "zebra" },
        ],
      });
    }, TEST_MS);

    it(t("SQL-AC-003", "values read back in their JS types; inner and left joins, subqueries, select-only CTEs, selectDistinct"), async () => {
      expect(valueOf(await run("shapes"))).toEqual({
        apple: {
          title: str("apple"),
          body: str("Hello 100% sure"),
          votes: num(3),
          score: num(1.5),
          done: bool(true),
          createdAt: num(1000),
          rating: num(5),
          weight: num(2.5),
          flag: bool(true),
          seenAt: num(5000),
        },
        banana: {
          title: str("Banana"),
          body: str("under_score and back\\slash"),
          votes: num(1),
          score: num(-2.25),
          done: bool(false),
          createdAt: num(2000),
          rating: num(null),
          weight: num(null),
          flag: bool(null),
          seenAt: num(null),
        },
        inner: [
          { title: "apple", label: "blue" },
          { title: "apple", label: "red" },
          { title: "Äpfel", label: "red" },
        ],
        left: [
          { author: "A", title: "Banana" },
          { author: "A", title: "apple" },
          { author: "A", title: "zebra" },
          { author: "A", title: "Äpfel" },
          { author: "A", title: "école" },
          { author: "B", title: null },
        ],
        leftTags: [
          { title: "Banana", label: null },
          { title: "apple", label: "blue" },
          { title: "apple", label: "red" },
          { title: "zebra", label: null },
          { title: "Äpfel", label: "red" },
          { title: "école", label: null },
        ],
        subquery: ["apple", "Äpfel"],
        // Unordered results, sorted by the case: compared as multisets.
        cte: [
          { title: "apple", votes: 3 },
          { title: "zebra", votes: 7 },
        ],
        distinct: [0, 1, 3, 7],
        distinctDone: [false, true],
      });
    }, TEST_MS);

    it(t("SQL-AC-003", "writes without returning resolve to undefined; returning lists exactly the affected rows; upserts against declared unique constraints"), async () => {
      expect(valueOf(await run("writes"))).toEqual({
        insertPlain: "undefined",
        insertReturning: ["p1", "p2"],
        insertReturningAll: [{ id: "p3", title: "w3", votes: 0, score: 0, done: false, body: null }],
        updatePlain: "undefined",
        updateReturning: ["p1", "p2"],
        updateNone: [],
        afterUpdate: [
          { title: "w1", body: "changed", done: true },
          { title: "w2", body: null, done: true },
          { title: "w3", body: null, done: false },
        ],
        upsertNothing: [],
        upsertUpdate: [{ id: "author", renamed: true }],
        deleteReturning: ["tag"],
        deleteNone: [],
        deletePlain: "undefined",
        deleteReturningPosts: ["p1", "p2"],
        remaining: 0,
      });
    }, TEST_MS);

    // ---- SQL-AC-004: boundary values per column type --------------------------------------

    it(t("SQL-AC-004", "boundary values per column type are accepted or rejected with SQL.INVALID_VALUE before the database, and read back exactly"), async () => {
      const value = valueOf(await run("boundaries", { ns, upperId: "3F2504E0-4F89-41D3-9A0C-0305E82C3301", notUuid: "not-a-uuid" }));
      const invalid = "SQL.INVALID_VALUE";
      expect(value).toEqual({
        rejected: {
          integerMaxPlusOne: invalid,
          integerMinMinusOne: invalid,
          integerFraction: invalid,
          integerNaN: invalid,
          numberInfinity: invalid,
          numberMinusInfinity: invalid,
          numberNaN: invalid,
          timestampNegative: invalid,
          timestampUnsafe: invalid,
          timestampFraction: invalid,
          textLoneHigh: invalid,
          textLoneLow: invalid,
          textReversedPair: invalid,
          textNul: invalid,
          idUppercase: invalid,
          idNotUuid: invalid,
          refUppercase: invalid,
          updateIntegerMaxPlusOne: invalid,
          updateTextLone: invalid,
          compareIntegerMaxPlusOne: invalid,
          multiRowOneBad: invalid,
        },
        rowsAfterRejections: 0,
        accepted: [
          // Negative zero is stored as zero (sql.md §2.1).
          { title: "min \u{10FFFF}", body: "￿", votes: -2147483648, score: 0, done: false, createdAt: 0, rating: -2147483648, weight: -Number.MAX_VALUE, flag: false, seenAt: 0 },
          { title: "max 😀", body: "", votes: 2147483647, score: Number.MAX_VALUE, done: true, createdAt: Number.MAX_SAFE_INTEGER, rating: 2147483647, weight: Number.MIN_VALUE, flag: true, seenAt: Number.MAX_SAFE_INTEGER },
        ],
        compareMax: 1,
      });
    }, TEST_MS);

    // ---- SQL-AC-005: atomic ---------------------------------------------------------------

    it(t("SQL-AC-005", "an atomic call whose last step violates a constraint leaves no rows from earlier steps"), async () => {
      expect(valueOf(await run("atomicRollback"))).toEqual({ result: { code: "SQL.CONFLICT" }, left: { authors: 0, posts: 0, tags: 0 } });
    }, TEST_MS);

    it(t("SQL-AC-005", "a step whose write was built on the outer handle is rejected with a catalogue error before any step executes"), async () => {
      const value = valueOf(await run("atomicOuterHandle")) as { result: { code?: string }; left: number };
      expect(value.left, "rows written by the rejected atomic call").toBe(0);
      expect(Object.keys(value.result)).toEqual(["code"]);
      expect(CATALOGUE_CODES, `rejection code ${String(value.result.code)} is a catalogue code`).toContain(value.result.code);
    }, TEST_MS);

    it(t("SQL-AC-005", "control: an atomic call without a violation commits every step and returns each step's RETURNING rows"), async () => {
      expect(valueOf(await run("atomicCommit"))).toEqual({ first: "undefined", second: [true], stored: ["committed"], empty: [] });
    }, TEST_MS);

    // ---- SQL-AC-006: normalized failures ---------------------------------------------------

    it(t("SQL-AC-006", "a duplicate unique value yields SQL.CONFLICT (insert answered as 409 SQL.CONFLICT; composite unique; update)"), async () => {
      expectCaseError(await run("duplicateThrows"), 409, "SQL.CONFLICT");
      expect(valueOf(await run("duplicateUnique"))).toEqual({ composite: "SQL.CONFLICT", updateToDuplicate: "SQL.CONFLICT", stillOne: 1 });
    }, TEST_MS);

    it(t("SQL-AC-006", "a select whose result exceeds PAR-215 yields SQL.RESULT_TOO_LARGE; one within it succeeds"), async () => {
      expectCaseError(await run("resultSize", { ns, chars: OVERSIZED_CHARS }), 500, "SQL.RESULT_TOO_LARGE");
      expect(valueOf(await run("resultSize", { ns, chars: FITTING_CHARS }))).toEqual({ rows: 1, length: FITTING_CHARS });
    }, TEST_MS);

    it(t("SQL-AC-006", "a committed insert whose RETURNING rows exceed PAR-215 resolves with all of them, and its row is stored once (DEC-0542)"), async () => {
      expect(valueOf(await run("writeResultSize", { ns, chars: OVERSIZED_CHARS }))).toEqual({ returned: 1, length: OVERSIZED_CHARS, stored: 1 });
    }, TEST_MS);
  });
}
