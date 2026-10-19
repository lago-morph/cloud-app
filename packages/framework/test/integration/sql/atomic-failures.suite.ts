/**
 * SQL-AC-005 and SQL-AC-006 (local parts: local D1 and PGlite).
 * - `atomic` commits all steps or none, and rejects a step built on the outer handle
 *   before executing anything (SQL-REQ-005).
 * - Uniqueness violations are `SQL.CONFLICT`; results over PAR-215 (256 KiB, measured as
 *   sql.md §2.3 "Result size") are `SQL.RESULT_TOO_LARGE` (SQL-REQ-006). The Data API
 *   retry clause of SQL-AC-006 is AWS adapter code and not part of this phase (B-T2 row).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { asc, atomic, count, eq, inArray } from "../../../src/index.js";
import type { TestApp } from "../../../src/testing/index.js";
import { DIALECT_LABEL, type Dialect } from "./support/dialect.js";
import { expectCatalogueError, expectCode } from "./support/errors.js";
import { probe, run } from "./support/probe.js";
import { A1, A2, AUTHORS, P1, POSTS, seed } from "./support/seed.js";
import { newTestApp, tables, uuid } from "./support/suite-app.js";

const { authors, posts, favourites, blobs } = tables;

/** PAR-215: portable maximum query result size, in bytes. */
const PAR_215 = 256 * 1024;

export function defineAtomicAndFailureSuite(dialect: Dialect): void {
  const on = `(${DIALECT_LABEL[dialect]})`;

  describe(`SQL atomic and normalized failures ${on}`, () => {
    let app: TestApp;

    beforeEach(async () => {
      app = await newTestApp();
      await seed(app);
    }, 120_000);
    afterEach(async () => {
      await app?.dispose();
    }, 120_000);

    /** Every row of every seeded table, for "nothing changed" comparisons. */
    const snapshot = () =>
      run(app, async ({ sql }) => ({
        authors: await sql.select().from(authors).orderBy(asc(authors.id)),
        posts: await sql.select().from(posts).orderBy(asc(posts.id)),
        favourites: await sql.select().from(favourites).orderBy(asc(favourites.id)),
      }));

    // ---- SQL-AC-005 ------------------------------------------------------------------

    it(tag("SQL-AC-005", `atomic whose last step violates a unique constraint leaves no rows from earlier steps ${on}`), async () => {
      const before = await snapshot();
      const outcome = await probe(app, async ({ sql }) =>
        atomic(sql, [
          (w) => w.insert(authors).values({ id: uuid(50), name: "Dana", country: null }),
          (w) => w.insert(posts).values({ id: uuid(51), authorId: uuid(50), title: "first", draft: false }),
          (w) => w.update(posts).set({ views: 42 }).where(eq(posts.id, P1)),
          (w) => w.insert(authors).values({ id: uuid(52), name: "Ada", country: null }),
        ] as const));
      expectCode(outcome, "SQL.CONFLICT");
      expect(await snapshot()).toEqual(before);
    });

    it(tag("SQL-AC-005", `atomic whose last step violates a reference leaves no rows from earlier steps ${on}`), async () => {
      const before = await snapshot();
      const outcome = await probe(app, async ({ sql }) =>
        atomic(sql, [
          (w) => w.insert(authors).values({ id: uuid(53), name: "Eve", country: "SE" }),
          (w) => w.delete(posts).where(eq(posts.authorId, A2)),
          (w) => w.insert(favourites).values({ id: uuid(54), authorId: uuid(53), postId: uuid(999) }),
        ] as const));
      expectCode(outcome, "SQL.CONFLICT");
      expect(await snapshot()).toEqual(before);
    });

    it(tag("SQL-AC-005", `atomic whose last step has an invalid value leaves no rows from earlier steps ${on}`), async () => {
      const before = await snapshot();
      const outcome = await probe(app, async ({ sql }) =>
        atomic(sql, [
          (w) => w.insert(authors).values({ id: uuid(55), name: "Fay", country: null }),
          (w) => w.update(posts).set({ score: 2147483648 }).where(eq(posts.id, P1)),
        ] as const));
      expectCode(outcome, "SQL.INVALID_VALUE");
      expect(await snapshot()).toEqual(before);
    });

    it(tag("SQL-AC-005", `atomic with a step whose write was built on the outer handle is rejected before any step executes ${on}`), async () => {
      const before = await snapshot();
      // Outer-handle step last: the earlier, valid step must not have executed either.
      const last = await probe(app, async ({ sql }) =>
        atomic(sql, [
          (w) => w.insert(authors).values({ id: uuid(56), name: "Gus", country: null }),
          () => sql.insert(authors).values({ id: uuid(57), name: "Hal", country: null }),
        ]));
      expectCatalogueError(last);
      // Outer-handle step first.
      const first = await probe(app, async ({ sql }) =>
        atomic(sql, [
          () => sql.update(posts).set({ views: 7 }).where(eq(posts.id, P1)),
          (w) => w.insert(authors).values({ id: uuid(58), name: "Ida", country: null }),
        ]));
      expectCatalogueError(first);
      // A builder captured from the outer handle before the call.
      const captured = await probe(app, async ({ sql }) => {
        const outer = sql.delete(posts).where(eq(posts.authorId, A1));
        return atomic(sql, [(w) => w.insert(authors).values({ id: uuid(59), name: "Jo", country: null }), () => outer]);
      });
      expectCatalogueError(captured);
      expect(await snapshot()).toEqual(before);
    });

    // ---- SQL-AC-006 ------------------------------------------------------------------

    it(tag("SQL-AC-006", `a duplicate unique value yields SQL.CONFLICT (insert, update, multi-column unique) ${on}`), async () => {
      await run(app, async ({ sql }) => sql.insert(favourites).values({ id: uuid(60), authorId: A1, postId: P1 }));
      const before = await snapshot();
      expectCode(await probe(app, async ({ sql }) => sql.insert(authors).values({ id: uuid(61), name: "Ada", country: null })), "SQL.CONFLICT");
      expectCode(await probe(app, async ({ sql }) => sql.update(authors).set({ name: "bob" }).where(eq(authors.id, A1))), "SQL.CONFLICT");
      expectCode(await probe(app, async ({ sql }) => sql.insert(favourites).values({ id: uuid(62), authorId: A1, postId: P1 })), "SQL.CONFLICT");
      // Duplicate primary key.
      const dupId = AUTHORS[0].id;
      expectCode(await probe(app, async ({ sql }) => sql.insert(authors).values({ id: dupId, name: "Other", country: null })), "SQL.CONFLICT");
      expect(await snapshot()).toEqual(before);
      // The same pair with a different author is not a duplicate.
      await run(app, async ({ sql }) => sql.insert(favourites).values({ id: uuid(63), authorId: A2, postId: P1 }));
    });

    it(tag("SQL-AC-006", `a result larger than PAR-215 yields SQL.RESULT_TOO_LARGE; exactly PAR-215 bytes succeeds ${on}`), async () => {
      // 63 bodies of 4096 ASCII bytes + one of 2048 × "é" (4096 UTF-8 bytes) = 262144 bytes = PAR-215.
      const bodies = [...Array.from({ length: 63 }, (_, i) => String(i % 10).repeat(4096)), "é".repeat(2048)];
      expect(bodies.reduce((s, b) => s + new TextEncoder().encode(b).length, 0)).toBe(PAR_215);
      const ids = bodies.map((_, i) => uuid(1000 + i));
      for (let i = 0; i < bodies.length; i += 16) {
        await run(app, async ({ sql }) =>
          sql.insert(blobs).values(bodies.slice(i, i + 16).map((body, j) => ({ id: ids[i + j] ?? "", body }))));
      }
      const atLimit = await run(app, async ({ sql }) => sql.select({ body: blobs.body }).from(blobs));
      expect(atLimit).toHaveLength(64);
      expect([...atLimit.map((r) => r.body)].sort()).toEqual([...bodies].sort());

      await run(app, async ({ sql }) => sql.insert(blobs).values({ id: uuid(2000), body: "x" }));
      const over = await probe(app, async ({ sql }) => sql.select({ body: blobs.body }).from(blobs));
      expectCode(over, "SQL.RESULT_TOO_LARGE");
      const overOrdered = await probe(app, async ({ sql }) => sql.select({ id: blobs.id, body: blobs.body }).from(blobs).orderBy(asc(blobs.id)).limit(100));
      expectCode(overOrdered, "SQL.RESULT_TOO_LARGE");

      // The limit is on the result, not the table: smaller results over the same rows work.
      const idsOnly = await run(app, async ({ sql }) => sql.select({ id: blobs.id }).from(blobs));
      expect(idsOnly).toHaveLength(65);
      const counted = await run(app, async ({ sql }) => sql.select({ n: count() }).from(blobs));
      expect(counted).toEqual([{ n: 65 }]);
      const page = await run(app, async ({ sql }) =>
        sql.select({ body: blobs.body }).from(blobs).where(inArray(blobs.id, ids.slice(0, 10))));
      expect(page).toHaveLength(10);
      // Nothing about the posts table changed along the way.
      expect((await snapshot()).posts).toHaveLength(POSTS.length);
    });
  });
}
