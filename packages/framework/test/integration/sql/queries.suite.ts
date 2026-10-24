/**
 * SQL-AC-003 (local part: local D1 and PGlite) — one query suite covering every supported
 * feature of sql.md §2.3. Every expectation below is a literal derived from SQL-REQ-003 /
 * SQL-REQ-004 (NULLs first for `asc`, last for `desc`; code point text order; ASCII-only
 * case folding in `containsText`; JS-number aggregates, null on empty input), and the same
 * suite runs in one process per dialect, so passing on both means identical results.
 * The Cloudflare D1 and Data API parts of SQL-AC-003 are out of scope here (B-T2 row).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import {
  and, asc, atomic, avg, between, containsText, count, countDistinct, desc, eq, gt, gte, inArray, isNotNull, isNull,
  lt, lte, max, min, ne, not, notInArray, or, sum, type PortableDb,
} from "../../../src/index.js";
import type { TestApp } from "../../../src/testing/index.js";
import { DIALECT_LABEL, type Dialect } from "./support/dialect.js";
import { expectClose } from "./support/errors.js";
import { probe, run } from "./support/probe.js";
import { A1, A2, A3, A4, P1, P2, P3, P4, P5, seed } from "./support/seed.js";
import { newTestApp, tables, uuid } from "./support/suite-app.js";

const { authors, posts } = tables;
type Where = Parameters<ReturnType<ReturnType<PortableDb["select"]>["from"]>["where"]>[0];

export function defineQuerySuite(dialect: Dialect): void {
  const on = `(${DIALECT_LABEL[dialect]})`;
  const t = (title: string): string => tag("SQL-AC-003", `${title} ${on}`);

  describe(`SQL query suite ${on}`, () => {
    let app: TestApp;

    beforeAll(async () => {
      app = await newTestApp();
      await seed(app);
    }, 120_000);
    afterAll(async () => {
      await app?.dispose();
    }, 120_000);

    const postIds = (where: Where): Promise<string[]> =>
      run(app, async ({ sql }) =>
        (await sql.select({ id: posts.id }).from(posts).where(where).orderBy(asc(posts.id))).map((r) => r.id),
      );

    describe("ordering", () => {
      it(t("asc/desc on text sort by code point (upper case, lower case, accented)"), async () => {
        const up = await run(app, async ({ sql }) => sql.select({ title: posts.title }).from(posts).orderBy(asc(posts.title)));
        expect(up.map((r) => r.title)).toEqual(["Alpha", "Zed", "apple", "beta", "Émile's note"]);
        const down = await run(app, async ({ sql }) => sql.select({ title: posts.title }).from(posts).orderBy(desc(posts.title)));
        expect(down.map((r) => r.title)).toEqual(["Émile's note", "beta", "apple", "Zed", "Alpha"]);
        const names = await run(app, async ({ sql }) => sql.select({ name: authors.name }).from(authors).orderBy(asc(authors.name)));
        expect(names.map((r) => r.name)).toEqual(["Ada", "Zoë", "bob", "Émile"]);
      });

      it(t("asc sorts NULLs first and desc sorts NULLs last; ties broken by id"), async () => {
        const scoreAsc = await run(app, async ({ sql }) =>
          sql.select({ id: posts.id }).from(posts).orderBy(asc(posts.score), asc(posts.id)));
        expect(scoreAsc.map((r) => r.id)).toEqual([P2, P3, P4, P1, P5]);
        const scoreDesc = await run(app, async ({ sql }) =>
          sql.select({ id: posts.id }).from(posts).orderBy(desc(posts.score), desc(posts.id)));
        expect(scoreDesc.map((r) => r.id)).toEqual([P5, P1, P4, P3, P2]);
        const ratingAsc = await run(app, async ({ sql }) =>
          sql.select({ id: posts.id }).from(posts).orderBy(asc(posts.rating), asc(posts.id)));
        expect(ratingAsc.map((r) => r.id)).toEqual([P2, P4, P5, P1, P3]);
        const publishedDesc = await run(app, async ({ sql }) =>
          sql.select({ id: posts.id }).from(posts).orderBy(desc(posts.publishedAt), asc(posts.id)));
        expect(publishedDesc.map((r) => r.id)).toEqual([P3, P4, P1, P5, P2]);
        const countryAsc = await run(app, async ({ sql }) =>
          sql.select({ id: authors.id }).from(authors).orderBy(asc(authors.country), asc(authors.id)));
        expect(countryAsc.map((r) => r.id)).toEqual([A2, A4, A1, A3]);
        const countryDesc = await run(app, async ({ sql }) =>
          sql.select({ id: authors.id }).from(authors).orderBy(desc(authors.country), asc(authors.id)));
        expect(countryDesc.map((r) => r.id)).toEqual([A3, A1, A4, A2]);
      });

      it(t("asc on boolean: false before true"), async () => {
        const rows = await run(app, async ({ sql }) => sql.select({ id: posts.id }).from(posts).orderBy(asc(posts.draft), asc(posts.id)));
        expect(rows.map((r) => r.id)).toEqual([P1, P3, P4, P2, P5]);
      });

      it(t("limit and offset"), async () => {
        const page = await run(app, async ({ sql }) =>
          sql.select({ title: posts.title }).from(posts).orderBy(asc(posts.title)).limit(2).offset(1));
        expect(page.map((r) => r.title)).toEqual(["Zed", "apple"]);
        const past = await run(app, async ({ sql }) =>
          sql.select({ title: posts.title }).from(posts).orderBy(asc(posts.title)).limit(2).offset(5));
        expect(past).toEqual([]);
      });
    });

    describe("expressions", () => {
      it(t("eq, ne, gt, gte, lt, lte (NULL never compares true; text compares case-sensitively by code point)"), async () => {
        expect(await postIds(eq(posts.draft, true))).toEqual([P2, P5]);
        expect(await postIds(ne(posts.authorId, A1))).toEqual([P3, P4, P5]);
        expect(await postIds(ne(posts.score, 10))).toEqual([P3, P4]);
        expect(await postIds(gt(posts.score, 7))).toEqual([P1, P5]);
        expect(await postIds(gte(posts.score, 7))).toEqual([P1, P4, P5]);
        expect(await postIds(lt(posts.score, 7))).toEqual([P3]);
        expect(await postIds(lte(posts.score, 7))).toEqual([P3, P4]);
        expect(await postIds(eq(posts.title, "apple"))).toEqual([P5]);
        expect(await postIds(eq(posts.title, "APPLE"))).toEqual([]);
        expect(await postIds(gt(posts.title, "Zed"))).toEqual([P2, P3, P5]);
        expect(await postIds(lt(posts.title, "a"))).toEqual([P1, P4]);
        expect(await postIds(gt(posts.rating, 1.5))).toEqual([P3]);
        expect(await postIds(lte(posts.publishedAt, 1000))).toEqual([P1, P5]);
      });

      it(t("and, or, not, isNull, isNotNull"), async () => {
        expect(await postIds(and(eq(posts.draft, false), gt(posts.score, 0)))).toEqual([P1, P4]);
        expect(await postIds(or(eq(posts.title, "Zed"), isNull(posts.body)))).toEqual([P2, P4]);
        expect(await postIds(not(eq(posts.draft, true)))).toEqual([P1, P3, P4]);
        expect(await postIds(isNull(posts.score))).toEqual([P2]);
        expect(await postIds(isNotNull(posts.rating))).toEqual([P1, P3, P5]);
      });

      it(t("inArray, notInArray, between (inclusive)"), async () => {
        expect(await postIds(inArray(posts.title, ["Alpha", "Zed", "missing"]))).toEqual([P1, P4]);
        expect(await postIds(notInArray(posts.title, ["Alpha", "Zed"]))).toEqual([P2, P3, P5]);
        expect(await postIds(between(posts.publishedAt, 500, 2000))).toEqual([P1, P4, P5]);
        expect(await postIds(between(posts.score, -5, 7))).toEqual([P3, P4]);
      });

      it(t("containsText: empty needle matches every non-NULL value; NULL never matches"), async () => {
        expect(await postIds(containsText(posts.body, ""))).toEqual([P1, P3, P4, P5]);
      });

      it(t("containsText: `%`, `_` and `\\` are literal"), async () => {
        expect(await postIds(containsText(posts.body, "%"))).toEqual([P3]);
        expect(await postIds(containsText(posts.body, "_"))).toEqual([P3]);
        expect(await postIds(containsText(posts.body, "\\"))).toEqual([P4]);
        expect(await postIds(containsText(posts.body, "\\s"))).toEqual([P4]);
        expect(await postIds(containsText(posts.body, "0% s"))).toEqual([P3]);
        expect(await postIds(containsText(posts.body, "e_t"))).toEqual([P3]);
        // Each of these would match under LIKE semantics; literally none matches.
        expect(await postIds(containsText(posts.body, "o_"))).toEqual([]);
        expect(await postIds(containsText(posts.body, "%o"))).toEqual([]);
        expect(await postIds(containsText(posts.body, "a_d"))).toEqual([]);
        expect(await postIds(containsText(posts.body, "%%"))).toEqual([]);
      });

      it(t("containsText folds case for ASCII A–Z only (mixed case and accented text)"), async () => {
        expect(await postIds(containsText(posts.body, "hello world"))).toEqual([P1]);
        expect(await postIds(containsText(posts.body, "HELLO"))).toEqual([P1]);
        expect(await postIds(containsText(posts.title, "ALPHA"))).toEqual([P1]);
        expect(await postIds(containsText(posts.body, "apple"))).toEqual([P5]);
        expect(await postIds(containsText(posts.body, "ÀPPLE"))).toEqual([P5]);
        expect(await postIds(containsText(posts.body, "Àpple"))).toEqual([P5]);
        // À and à are different letters to containsText: no non-ASCII folding.
        expect(await postIds(containsText(posts.body, "àpple"))).toEqual([]);
        expect(await postIds(containsText(posts.title, "É"))).toEqual([P3]);
        expect(await postIds(containsText(posts.title, "ÉMILE"))).toEqual([P3]);
        expect(await postIds(containsText(posts.title, "é"))).toEqual([]);
        expect(await postIds(containsText(posts.title, "émile"))).toEqual([]);
      });
    });

    describe("aggregates", () => {
      it(t("count, countDistinct, min, max, sum, avg return the documented JS types and values"), async () => {
        const r = await run(app, async ({ sql }) => {
          const [row] = await sql
            .select({
              all: count(),
              scored: count(posts.score),
              distinctScores: countDistinct(posts.score),
              distinctAuthors: countDistinct(posts.authorId),
              minScore: min(posts.score),
              maxScore: max(posts.score),
              sumScore: sum(posts.score),
              avgScore: avg(posts.score),
              minRating: min(posts.rating),
              maxRating: max(posts.rating),
              sumRating: sum(posts.rating),
              avgRating: avg(posts.rating),
              minPublished: min(posts.publishedAt),
              maxPublished: max(posts.publishedAt),
              minTitle: min(posts.title),
              maxTitle: max(posts.title),
              sumViews: sum(posts.views),
            })
            .from(posts);
          return row;
        });
        expect(r).toBeDefined();
        if (r === undefined) return;
        expect(r.all).toBe(5);
        expect(r.scored).toBe(4);
        expect(r.distinctScores).toBe(3);
        expect(r.distinctAuthors).toBe(3);
        expect(r.minScore).toBe(-5);
        expect(r.maxScore).toBe(10);
        expect(r.sumScore).toBe(22);
        expectClose(r.avgScore, 5.5);
        expect(r.minRating).toBe(0.25);
        expect(r.maxRating).toBe(2.25);
        expectClose(r.sumRating, 4);
        expectClose(r.avgRating, 4 / 3);
        expect(r.minPublished).toBe(500);
        expect(r.maxPublished).toBe(3000);
        expect(r.minTitle).toBe("Alpha");
        expect(r.maxTitle).toBe("Émile's note");
        expect(r.sumViews).toBe(0);
        for (const key of ["all", "scored", "distinctScores", "distinctAuthors", "minScore", "maxScore", "sumScore", "avgScore",
          "minRating", "maxRating", "sumRating", "avgRating", "minPublished", "maxPublished", "sumViews"] as const) {
          expect(typeof r[key], key).toBe("number");
        }
        expect(typeof r.minTitle).toBe("string");
        expect(typeof r.maxTitle).toBe("string");
      });

      it(t("empty-input aggregates: count and countDistinct are 0, every other aggregate is null"), async () => {
        const r = await run(app, async ({ sql }) => {
          const [row] = await sql
            .select({
              all: count(),
              scored: count(posts.score),
              distinctScores: countDistinct(posts.score),
              minScore: min(posts.score),
              maxScore: max(posts.score),
              minTitle: min(posts.title),
              maxPublished: max(posts.publishedAt),
              sumScore: sum(posts.score),
              avgScore: avg(posts.score),
              sumRating: sum(posts.rating),
              avgRating: avg(posts.rating),
            })
            .from(posts)
            .where(eq(posts.title, "missing"));
          return row;
        });
        expect(r).toEqual({
          all: 0, scored: 0, distinctScores: 0,
          minScore: null, maxScore: null, minTitle: null, maxPublished: null,
          sumScore: null, avgScore: null, sumRating: null, avgRating: null,
        });
      });

      it(t("aggregates over NULL-only input: count of the column is 0, sum/avg/min/max are null"), async () => {
        const r = await run(app, async ({ sql }) => {
          const [row] = await sql
            .select({ n: count(posts.score), s: sum(posts.score), a: avg(posts.score), lo: min(posts.score), hi: max(posts.rating) })
            .from(posts)
            .where(eq(posts.id, P2));
          return row;
        });
        expect(r).toEqual({ n: 0, s: null, a: null, lo: null, hi: null });
      });
    });

    describe("select forms", () => {
      it(t("selectDistinct"), async () => {
        const authorIds = await run(app, async ({ sql }) =>
          sql.selectDistinct({ authorId: posts.authorId }).from(posts).orderBy(asc(posts.authorId)));
        expect(authorIds).toEqual([{ authorId: A1 }, { authorId: A2 }, { authorId: A3 }]);
        const drafts = await run(app, async ({ sql }) => sql.selectDistinct({ draft: posts.draft }).from(posts).orderBy(asc(posts.draft)));
        expect(drafts).toEqual([{ draft: false }, { draft: true }]);
      });

      it(t("inner join"), async () => {
        const rows = await run(app, async ({ sql }) =>
          sql
            .select({ title: posts.title, name: authors.name })
            .from(posts)
            .innerJoin(authors, eq(posts.authorId, authors.id))
            .where(eq(authors.name, "bob"))
            .orderBy(asc(posts.title)));
        expect(rows).toEqual([{ title: "Zed", name: "bob" }, { title: "apple", name: "bob" }]);
      });

      it(t("left join: unmatched rows give NULL fields"), async () => {
        const rows = await run(app, async ({ sql }) =>
          sql
            .select({ name: authors.name, postId: posts.id })
            .from(authors)
            .leftJoin(posts, eq(posts.authorId, authors.id))
            .orderBy(asc(authors.name), asc(posts.id)));
        expect(rows).toEqual([
          { name: "Ada", postId: P1 },
          { name: "Ada", postId: P2 },
          { name: "Zoë", postId: null },
          { name: "bob", postId: P4 },
          { name: "bob", postId: P5 },
          { name: "Émile", postId: P3 },
        ]);
      });

      it(t("subqueries (in a where clause and as a from source)"), async () => {
        const names = await run(app, async ({ sql }) =>
          sql
            .select({ name: authors.name })
            .from(authors)
            .where(inArray(authors.id, sql.select({ id: posts.authorId }).from(posts).where(eq(posts.draft, true))))
            .orderBy(asc(authors.name)));
        expect(names).toEqual([{ name: "Ada" }, { name: "bob" }]);
        const published = await run(app, async ({ sql }) => {
          const sq = sql.select({ id: posts.id }).from(posts).where(eq(posts.draft, false)).as("published");
          return sql.select({ n: count() }).from(sq);
        });
        expect(published).toEqual([{ n: 3 }]);
      });

      it(t("select-only common table expression ($with / with)"), async () => {
        const rows = await run(app, async ({ sql }) => {
          const scored = sql.$with("scored").as(sql.select({ id: posts.id, score: posts.score }).from(posts).where(isNotNull(posts.score)));
          return sql.with(scored).select({ n: count() }).from(scored);
        });
        expect(rows).toEqual([{ n: 4 }]);
      });

      it(t("values read back in their documented JS types"), async () => {
        const rows = await run(app, async ({ sql }) => sql.select().from(posts).where(inArray(posts.id, [P1, P2])).orderBy(asc(posts.id)));
        expect(rows).toEqual([
          { id: P1, authorId: A1, title: "Alpha", body: "Hello World", score: 10, rating: 1.5, publishedAt: 1000, draft: false, views: 0 },
          { id: P2, authorId: A1, title: "beta", body: null, score: null, rating: null, publishedAt: null, draft: true, views: 0 },
        ]);
        expect(typeof rows[0]?.draft).toBe("boolean");
        expect(typeof rows[0]?.publishedAt).toBe("number");
      });
    });
  });

  describe(`SQL writes ${on}`, () => {
    let app: TestApp;

    beforeEach(async () => {
      app = await newTestApp();
      await seed(app);
    }, 120_000);
    afterEach(async () => {
      await app?.dispose();
    }, 120_000);

    const allPosts = () => run(app, async ({ sql }) => sql.select({ id: posts.id, views: posts.views }).from(posts).orderBy(asc(posts.id)));

    it(t("insert without returning resolves to undefined; the row is written"), async () => {
      const outcome = await probe(app, async ({ sql }) =>
        sql.insert(posts).values({ id: uuid(20), authorId: A4, title: "new", draft: false }));
      expect(outcome).toEqual({ ok: true, value: undefined });
      expect(outcome.ok && outcome.value === undefined).toBe(true);
      const rows = await run(app, async ({ sql }) => sql.select().from(posts).where(eq(posts.id, uuid(20))));
      expect(rows).toEqual([{ id: uuid(20), authorId: A4, title: "new", body: null, score: null, rating: null, publishedAt: null, draft: false, views: 0 }]);
    });

    it(t("update and delete without returning resolve to undefined"), async () => {
      const updated = await probe(app, async ({ sql }) => sql.update(posts).set({ views: 3 }).where(eq(posts.id, P1)));
      expect(updated.ok && updated.value === undefined).toBe(true);
      const deleted = await probe(app, async ({ sql }) => sql.delete(posts).where(eq(posts.id, P2)));
      expect(deleted.ok && deleted.value === undefined).toBe(true);
      expect(await allPosts()).toEqual([
        { id: P1, views: 3 }, { id: P3, views: 0 }, { id: P4, views: 0 }, { id: P5, views: 0 },
      ]);
    });

    it(t(".returning({ id }) lists exactly the affected rows (update, delete, insert, no match)"), async () => {
      const updated = await run(app, async ({ sql }) =>
        sql.update(posts).set({ views: 5 }).where(gte(posts.score, 10)).returning({ id: posts.id }));
      expect(updated.map((r) => r.id).sort()).toEqual([P1, P5]);
      expect(updated).toHaveLength(2);
      expect(await allPosts()).toEqual([
        { id: P1, views: 5 }, { id: P2, views: 0 }, { id: P3, views: 0 }, { id: P4, views: 0 }, { id: P5, views: 5 },
      ]);
      const none = await run(app, async ({ sql }) =>
        sql.update(posts).set({ views: 9 }).where(eq(posts.id, uuid(99))).returning({ id: posts.id }));
      expect(none).toEqual([]);
      const deleted = await run(app, async ({ sql }) => sql.delete(posts).where(eq(posts.draft, true)).returning({ id: posts.id }));
      expect(deleted.map((r) => r.id).sort()).toEqual([P2, P5]);
      expect(deleted).toHaveLength(2);
      const noneDeleted = await run(app, async ({ sql }) => sql.delete(posts).where(eq(posts.draft, true)).returning({ id: posts.id }));
      expect(noneDeleted).toEqual([]);
      const inserted = await run(app, async ({ sql }) =>
        sql.insert(posts).values([
          { id: uuid(21), authorId: A2, title: "x", draft: true },
          { id: uuid(22), authorId: A2, title: "y", draft: false, views: 2 },
        ]).returning({ id: posts.id, views: posts.views }));
      expect([...inserted].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual([{ id: uuid(21), views: 0 }, { id: uuid(22), views: 2 }]);
    });

    it(t("update to NULL and back"), async () => {
      await run(app, async ({ sql }) => sql.update(posts).set({ body: null, score: null }).where(eq(posts.id, P1)));
      expect(await postIdsOf(app, isNull(posts.body))).toEqual([P1, P2]);
      await run(app, async ({ sql }) => sql.update(posts).set({ body: "again" }).where(eq(posts.id, P1)));
      expect(await postIdsOf(app, isNull(posts.body))).toEqual([P2]);
    });

    it(t("upsert against a declared unique constraint (do update, do nothing) with returning"), async () => {
      const updated = await run(app, async ({ sql }) =>
        sql.insert(authors).values({ id: uuid(30), name: "Ada", country: "IE" })
          .onConflictDoUpdate({ target: authors.name, set: { country: "GB" } })
          .returning({ id: authors.id }));
      expect(updated).toEqual([{ id: A1 }]);
      const skipped = await run(app, async ({ sql }) =>
        sql.insert(authors).values({ id: uuid(31), name: "bob", country: "IE" })
          .onConflictDoNothing({ target: authors.name })
          .returning({ id: authors.id }));
      expect(skipped).toEqual([]);
      const added = await run(app, async ({ sql }) =>
        sql.insert(authors).values({ id: uuid(32), name: "Chen", country: null })
          .onConflictDoNothing({ target: authors.name })
          .returning({ id: authors.id }));
      expect(added).toEqual([{ id: uuid(32) }]);
      const rows = await run(app, async ({ sql }) => sql.select().from(authors).orderBy(asc(authors.id)));
      expect(rows).toEqual([
        { id: A1, name: "Ada", country: "GB" },
        { id: A2, name: "Émile", country: null },
        { id: A3, name: "bob", country: "US" },
        { id: A4, name: "Zoë", country: "FR" },
        { id: uuid(32), name: "Chen", country: null },
      ]);
    });

    it(t("atomic multi-row write resolves per step to undefined or its RETURNING rows, and applies every step"), async () => {
      const results = await run(app, async ({ sql }) =>
        atomic(sql, [
          (w) => w.insert(authors).values({ id: uuid(40), name: "Dana", country: null }),
          (w) => w.insert(posts).values({ id: uuid(41), authorId: uuid(40), title: "t", draft: false }).returning({ id: posts.id }),
          (w) => w.update(posts).set({ views: 1 }).where(eq(posts.authorId, uuid(40))).returning({ id: posts.id, views: posts.views }),
        ] as const));
      expect(results).toEqual([undefined, [{ id: uuid(41) }], [{ id: uuid(41), views: 1 }]]);
      expect(results[0]).toBeUndefined();
      const empty = await run(app, async ({ sql }) => atomic(sql, [] as const));
      expect(empty).toEqual([]);
    });
  });
}

function postIdsOf(app: TestApp, where: Where): Promise<string[]> {
  return run(app, async ({ sql }) =>
    (await sql.select({ id: posts.id }).from(posts).where(where).orderBy(asc(posts.id))).map((r) => r.id),
  );
}
