import {
  and,
  asc,
  atomic,
  avg,
  between,
  containsText,
  count,
  countDistinct,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  min,
  ne,
  newId,
  not,
  notInArray,
  or,
  sum,
  z,
  type PortableDb,
} from "@lago-morph/prototype-framework";
import type { CaseServices, CaseSet } from "../case-types";
import { authors, blobs, posts, tags } from "../schema";
import { codeOf, namespace, outcome } from "./support";

/**
 * SQL case set (C-T2): SQL-AC-003…-006 as cases that run unchanged in-process (local D1,
 * PGlite) and through `POST /api/cases/run` on every target. Expectations live in
 * `tests/compliance/criteria/sql/`; cases only report what the database did.
 *
 * Seed data (`seed`, removed by `cleanup`): author A (`<ns>`) with five posts and three tags,
 * author B (`<ns>:b`) with none. Rows per seed: 2 authors + 5 posts + 3 tags.
 */

/** JS type of a value as read back, `null` for NULL. */
function typeName(value: unknown): string {
  return value === null ? "null" : typeof value;
}

async function authorId(db: PortableDb, name: string): Promise<string> {
  const rows = await db.select({ id: authors.id }).from(authors).where(eq(authors.name, name));
  const row = rows[0];
  if (row === undefined) throw new Error("seed author missing: run the seed case first");
  return row.id;
}

/** Removes an author's tags, posts and the author itself (children first). */
async function removeAuthor(db: PortableDb, name: string): Promise<void> {
  const rows = await db.select({ id: authors.id }).from(authors).where(eq(authors.name, name));
  for (const row of rows) {
    await db.delete(tags).where(inArray(tags.postId, db.select({ id: posts.id }).from(posts).where(eq(posts.authorId, row.id))));
    await db.delete(posts).where(eq(posts.authorId, row.id));
    await db.delete(authors).where(eq(authors.id, row.id));
  }
}

const titles = (rows: readonly { title: string }[]): string[] => rows.map((r) => r.title);

const seed = async ({ sql }: CaseServices, input: unknown): Promise<void> => {
  const ns = namespace(input);
  const a = newId();
  const b = newId();
  await sql.insert(authors).values([
    { id: a, name: ns },
    { id: b, name: `${ns}:b` },
  ]);
  const apple = newId();
  const banana = newId();
  const apfel = newId();
  const zebra = newId();
  const ecole = newId();
  await sql.insert(posts).values([
    { id: apple, authorId: a, title: "apple", body: "Hello 100% sure", votes: 3, score: 1.5, done: true, createdAt: 1000, rating: 5, weight: 2.5, flag: true, seenAt: 5000 },
    { id: banana, authorId: a, title: "Banana", body: "under_score and back\\slash", votes: 1, score: -2.25, done: false, createdAt: 2000, rating: null, weight: null, flag: null, seenAt: null },
    // votes, score and done take their defaults (0, 0, false); nullable columns omitted are NULL.
    { id: apfel, authorId: a, title: "Äpfel", body: "ÀPPLE and apple", createdAt: 3000, rating: 2, weight: 0.5, flag: false, seenAt: 6000 },
    { id: zebra, authorId: a, title: "zebra", votes: 7, score: 10, done: true, createdAt: 4000, weight: 1.25, flag: true },
    { id: ecole, authorId: a, title: "école", body: "plain", votes: 1, score: 0.75, done: false, createdAt: 5000, rating: 2, seenAt: 7000 },
  ]);
  await sql.insert(tags).values([
    { id: newId(), postId: apple, label: "red" },
    { id: newId(), postId: apple, label: "blue" },
    { id: newId(), postId: apfel, label: "red" },
  ]);
};

const cleanup = async ({ sql }: CaseServices, input: unknown): Promise<void> => {
  const ns = namespace(input);
  for (const name of [ns, `${ns}:b`, `${ns}:w`, `${ns}:w-renamed`, `${ns}:v`, `${ns}:x`, `${ns}:c`]) await removeAuthor(sql, name);
};

/** Ordering: NULL placement, code-point text order, booleans, limit/offset. */
const ordering = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const a = await authorId(sql, namespace(input));
  const base = () => sql.select({ title: posts.title }).from(posts).where(eq(posts.authorId, a));
  return {
    titleAsc: titles(await base().orderBy(asc(posts.title))),
    titleDesc: titles(await base().orderBy(desc(posts.title))),
    ratingAsc: titles(await base().orderBy(asc(posts.rating), asc(posts.title))),
    ratingDesc: titles(await base().orderBy(desc(posts.rating), asc(posts.title))),
    seenAtDesc: titles(await base().orderBy(desc(posts.seenAt), asc(posts.title))),
    weightAsc: titles(await base().orderBy(asc(posts.weight), asc(posts.title))),
    flagAsc: titles(await base().orderBy(asc(posts.flag), asc(posts.title))),
    flagDesc: titles(await base().orderBy(desc(posts.flag), asc(posts.title))),
    limitOffset: titles(await base().orderBy(asc(posts.title)).limit(2).offset(1)),
    limitOnly: titles(await base().orderBy(desc(posts.createdAt)).limit(3)),
  };
};

/** Comparison, boolean, null, `inArray` and `between` expressions. */
const filters = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const a = await authorId(sql, namespace(input));
  const where = async (condition: Parameters<typeof and>[number]) =>
    titles(await sql.select({ title: posts.title }).from(posts).where(and(eq(posts.authorId, a), condition)).orderBy(asc(posts.title)));
  return {
    eq: await where(eq(posts.votes, 1)),
    ne: await where(ne(posts.votes, 1)),
    gt: await where(gt(posts.votes, 1)),
    gte: await where(gte(posts.votes, 1)),
    lt: await where(lt(posts.votes, 1)),
    lte: await where(lte(posts.votes, 1)),
    and: await where(and(gte(posts.createdAt, 2000), lte(posts.createdAt, 4000))),
    between: await where(between(posts.createdAt, 2000, 4000)),
    or: await where(or(eq(posts.done, true), isNull(posts.rating))),
    not: await where(not(eq(posts.done, true))),
    isNull: await where(isNull(posts.body)),
    isNotNull: await where(isNotNull(posts.weight)),
    inArray: await where(inArray(posts.title, ["apple", "zebra", "missing"])),
    notInArray: await where(notInArray(posts.title, ["apple", "zebra"])),
    boolFalse: await where(eq(posts.flag, false)),
    textCaseSensitive: await where(eq(posts.title, "APPLE")),
    textGreater: await where(gt(posts.title, "Z")),
    numberLess: await where(lt(posts.score, 0)),
    timestampEq: await where(eq(posts.seenAt, 6000)),
  };
};

/** `containsText`: empty needle, `%`, `_`, `\`, ASCII-only case folding, NULL. */
const text = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const a = await authorId(sql, namespace(input));
  const body = async (needle: string) =>
    titles(await sql.select({ title: posts.title }).from(posts).where(and(eq(posts.authorId, a), containsText(posts.body, needle))).orderBy(asc(posts.title)));
  const title = async (needle: string) =>
    titles(await sql.select({ title: posts.title }).from(posts).where(and(eq(posts.authorId, a), containsText(posts.title, needle))).orderBy(asc(posts.title)));
  return {
    empty: await body(""),
    percent: await body("%"),
    percentWildcard: await body("1%s"),
    underscore: await body("_"),
    underscoreWildcard: await body("o_e"),
    backslash: await body("\\"),
    asciiFold: await body("HELLO"),
    asciiFoldUpperNeedle: await body("APPLE"),
    nonAsciiNotFolded: await body("àpple"),
    nonAsciiExact: await body("ÀPPLE"),
    titleA: await title("A"),
    titleAccented: await title("äpfel"),
  };
};

/** Aggregates over rows and over empty input, with the JS types they return. */
const aggregates = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const a = await authorId(sql, ns);
  const b = await authorId(sql, `${ns}:b`);
  const totals = (author: string) =>
    sql
      .select({
        count: count(),
        countBody: count(posts.body),
        countDistinctVotes: countDistinct(posts.votes),
        countDistinctRating: countDistinct(posts.rating),
        minTitle: min(posts.title),
        maxTitle: max(posts.title),
        minVotes: min(posts.votes),
        maxVotes: max(posts.votes),
        minScore: min(posts.score),
        maxScore: max(posts.score),
        minCreatedAt: min(posts.createdAt),
        maxCreatedAt: max(posts.createdAt),
        minSeenAt: min(posts.seenAt),
        maxRating: max(posts.rating),
        sumVotes: sum(posts.votes),
        avgVotes: avg(posts.votes),
        sumScore: sum(posts.score),
        avgScore: avg(posts.score),
        sumWeight: sum(posts.weight),
        avgWeight: avg(posts.weight),
        sumRating: sum(posts.rating),
        avgRating: avg(posts.rating),
      })
      .from(posts)
      .where(eq(posts.authorId, author));
  const typed = (row: Record<string, unknown> | undefined) =>
    Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, { value: v, type: typeName(v) }]));
  const grouped = await sql
    .select({ done: posts.done, n: count(), votes: sum(posts.votes), maxTitle: max(posts.title) })
    .from(posts)
    .where(eq(posts.authorId, a))
    .groupBy(posts.done)
    .orderBy(asc(posts.done));
  return {
    rows: typed((await totals(a))[0]),
    empty: typed((await totals(b))[0]),
    grouped: grouped.map((g) => ({ done: g.done, doneType: typeName(g.done), n: g.n, votes: g.votes, maxTitle: g.maxTitle })),
  };
};

/** Column JS types as read back, joins, subqueries, select-only CTEs, `selectDistinct`. */
const shapes = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const a = await authorId(sql, ns);
  const b = await authorId(sql, `${ns}:b`);
  const [apple] = await sql.select().from(posts).where(and(eq(posts.authorId, a), eq(posts.title, "apple")));
  const [banana] = await sql.select().from(posts).where(and(eq(posts.authorId, a), eq(posts.title, "Banana")));
  const row = (r: Record<string, unknown> | undefined) =>
    Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => k !== "id" && k !== "authorId").map(([k, v]) => [k, { value: v, type: typeName(v) }]));
  const inner = await sql
    .select({ title: posts.title, label: tags.label })
    .from(posts)
    .innerJoin(tags, eq(tags.postId, posts.id))
    .where(eq(posts.authorId, a))
    .orderBy(asc(posts.title), asc(tags.label));
  const left = await sql
    .select({ author: authors.name, title: posts.title })
    .from(authors)
    .leftJoin(posts, eq(posts.authorId, authors.id))
    .where(inArray(authors.id, [a, b]))
    .orderBy(asc(authors.name), asc(posts.title));
  const leftTags = await sql
    .select({ title: posts.title, label: tags.label })
    .from(posts)
    .leftJoin(tags, eq(tags.postId, posts.id))
    .where(eq(posts.authorId, a))
    .orderBy(asc(posts.title), asc(tags.label));
  const subquery = await sql
    .select({ title: posts.title })
    .from(posts)
    .where(and(eq(posts.authorId, a), inArray(posts.id, sql.select({ id: tags.postId }).from(tags).where(eq(tags.label, "red")))))
    .orderBy(asc(posts.title));
  const busy = sql.$with("busy").as(sql.select({ title: posts.title, votes: posts.votes }).from(posts).where(and(eq(posts.authorId, a), gte(posts.votes, 3))));
  const cte = await sql.with(busy).select({ title: busy.title, votes: busy.votes }).from(busy);
  const distinct = await sql.selectDistinct({ votes: posts.votes }).from(posts).where(eq(posts.authorId, a)).orderBy(asc(posts.votes));
  const distinctDone = await sql.selectDistinct({ done: posts.done }).from(posts).where(eq(posts.authorId, a));
  return {
    apple: row(apple),
    banana: row(banana),
    inner,
    left: left.map((r) => ({ author: r.author === ns ? "A" : r.author === `${ns}:b` ? "B" : r.author, title: r.title })),
    leftTags,
    subquery: titles(subquery),
    cte: [...cte].sort((x, y) => (x.title < y.title ? -1 : x.title > y.title ? 1 : 0)),
    distinct: distinct.map((d) => d.votes),
    distinctDone: distinctDone.map((d) => d.done).sort(),
  };
};

/** Writes with and without `returning`, upserts against a declared unique constraint. */
const writes = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const name = `${ns}:w`;
  const a = newId();
  const p1 = newId();
  const p2 = newId();
  const p3 = newId();
  const label = (id: string): string => (id === p1 ? "p1" : id === p2 ? "p2" : id === p3 ? "p3" : id === a ? "author" : "other");
  const ids = (rows: readonly { id: string }[]): string[] => rows.map((r) => label(r.id)).sort();
  try {
    const insertPlain = await sql.insert(authors).values({ id: a, name });
    const insertReturning = await sql
      .insert(posts)
      .values([
        { id: p1, authorId: a, title: "w1", votes: 1, createdAt: 10 },
        { id: p2, authorId: a, title: "w2", votes: 5, createdAt: 20 },
      ])
      .returning({ id: posts.id });
    const insertReturningAll = await sql.insert(posts).values({ id: p3, authorId: a, title: "w3", createdAt: 30 }).returning();
    const updatePlain = await sql.update(posts).set({ body: "changed" }).where(eq(posts.id, p1));
    const updateReturning = await sql.update(posts).set({ done: true }).where(and(eq(posts.authorId, a), gte(posts.votes, 1))).returning({ id: posts.id });
    const updateNone = await sql.update(posts).set({ done: false }).where(and(eq(posts.authorId, a), gt(posts.votes, 100))).returning({ id: posts.id });
    const afterUpdate = await sql.select({ title: posts.title, body: posts.body, done: posts.done }).from(posts).where(eq(posts.authorId, a)).orderBy(asc(posts.title));
    const tagId = newId();
    await sql.insert(tags).values({ id: tagId, postId: p1, label: "x" });
    const upsertNothing = await sql.insert(tags).values({ id: newId(), postId: p1, label: "x" }).onConflictDoNothing({ target: [tags.postId, tags.label] }).returning({ id: tags.id });
    const upsertUpdate = await sql
      .insert(authors)
      .values({ id: newId(), name })
      .onConflictDoUpdate({ target: authors.name, set: { name: `${ns}:w-renamed` } })
      .returning({ id: authors.id, name: authors.name });
    const deleteReturning = await sql.delete(tags).where(eq(tags.postId, p1)).returning({ id: tags.id });
    const deleteNone = await sql.delete(posts).where(and(eq(posts.authorId, a), eq(posts.title, "missing"))).returning({ id: posts.id });
    const deletePlain = await sql.delete(posts).where(eq(posts.id, p3));
    const deleteReturningPosts = await sql.delete(posts).where(eq(posts.authorId, a)).returning({ id: posts.id });
    const remaining = await sql.select({ id: posts.id }).from(posts).where(eq(posts.authorId, a));
    return {
      insertPlain: insertPlain === undefined ? "undefined" : typeName(insertPlain),
      insertReturning: ids(insertReturning),
      insertReturningAll: insertReturningAll.map((r) => ({ id: label(r.id), title: r.title, votes: r.votes, score: r.score, done: r.done, body: r.body })),
      updatePlain: updatePlain === undefined ? "undefined" : typeName(updatePlain),
      updateReturning: ids(updateReturning),
      updateNone,
      afterUpdate,
      upsertNothing,
      upsertUpdate: upsertUpdate.map((r) => ({ id: label(r.id), renamed: r.name === `${ns}:w-renamed` })),
      deleteReturning: deleteReturning.map((r) => (r.id === tagId ? "tag" : "other")),
      deleteNone,
      deletePlain: deletePlain === undefined ? "undefined" : typeName(deletePlain),
      deleteReturningPosts: ids(deleteReturningPosts),
      remaining: remaining.length,
    };
  } finally {
    await removeAuthor(sql, name);
    await removeAuthor(sql, `${ns}:w-renamed`);
  }
};

const boundaryInput = z.object({ ns: z.string().min(8).max(64), upperId: z.string(), notUuid: z.string() });

/** SQL-AC-004: boundary values per column type, written and compared; each rejection is reported by code. */
const boundaries = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const { ns, upperId, notUuid } = boundaryInput.parse(input);
  const name = `${ns}:v`;
  const a = newId();
  await sql.insert(authors).values({ id: a, name });
  try {
    const post = (values: Partial<typeof posts.$inferInsert>) => () => sql.insert(posts).values({ id: newId(), authorId: a, title: "t", createdAt: 1, ...values });
    const rejected = {
      integerMaxPlusOne: await codeOf(post({ votes: 2147483648 })),
      integerMinMinusOne: await codeOf(post({ votes: -2147483649 })),
      integerFraction: await codeOf(post({ votes: 1.5 })),
      integerNaN: await codeOf(post({ votes: Number.NaN })),
      numberInfinity: await codeOf(post({ score: Number.POSITIVE_INFINITY })),
      numberMinusInfinity: await codeOf(post({ score: Number.NEGATIVE_INFINITY })),
      numberNaN: await codeOf(post({ weight: Number.NaN })),
      timestampNegative: await codeOf(post({ createdAt: -1 })),
      timestampUnsafe: await codeOf(post({ createdAt: 2 ** 53 })),
      timestampFraction: await codeOf(post({ seenAt: 1.5 })),
      textLoneHigh: await codeOf(post({ title: "a\uD800" })),
      textLoneLow: await codeOf(post({ title: "\uDC00b" })),
      textReversedPair: await codeOf(post({ body: "\uDE00\uD83D" })),
      textNul: await codeOf(post({ body: "a\u0000b" })),
      idUppercase: await codeOf(() => sql.insert(authors).values({ id: upperId, name: `${name}:upper` })),
      idNotUuid: await codeOf(() => sql.insert(authors).values({ id: notUuid, name: `${name}:bad` })),
      refUppercase: await codeOf(post({ authorId: a.toUpperCase() })),
      updateIntegerMaxPlusOne: await codeOf(() => sql.update(posts).set({ votes: 2147483648 }).where(eq(posts.authorId, a))),
      updateTextLone: await codeOf(() => sql.update(posts).set({ title: "\uD800" }).where(eq(posts.authorId, a))),
      compareIntegerMaxPlusOne: await codeOf(() => sql.select({ id: posts.id }).from(posts).where(eq(posts.votes, 2147483648))),
      multiRowOneBad: await codeOf(() =>
        sql.insert(posts).values([
          { id: newId(), authorId: a, title: "good", createdAt: 1 },
          { id: newId(), authorId: a, title: "bad", createdAt: 1, votes: 2147483648 },
        ]),
      ),
    };
    const rowsAfterRejections = (await sql.select({ id: posts.id }).from(posts).where(eq(posts.authorId, a))).length;
    const max = newId();
    const min = newId();
    await sql.insert(posts).values([
      { id: max, authorId: a, title: "max 😀", body: "", votes: 2147483647, score: Number.MAX_VALUE, done: true, createdAt: Number.MAX_SAFE_INTEGER, rating: 2147483647, weight: Number.MIN_VALUE, flag: true, seenAt: Number.MAX_SAFE_INTEGER },
      { id: min, authorId: a, title: "min \u{10FFFF}", body: "￿", votes: -2147483648, score: -0, done: false, createdAt: 0, rating: -2147483648, weight: -Number.MAX_VALUE, flag: false, seenAt: 0 },
    ]);
    const read = await sql.select().from(posts).where(eq(posts.authorId, a)).orderBy(asc(posts.createdAt));
    const negativeZero = (v: number | null) => (v !== null && Object.is(v, -0) ? "-0" : v);
    const accepted = read.map((r) => ({
      title: r.title,
      body: r.body,
      votes: r.votes,
      score: negativeZero(r.score),
      done: r.done,
      createdAt: r.createdAt,
      rating: r.rating,
      weight: negativeZero(r.weight),
      flag: r.flag,
      seenAt: r.seenAt,
    }));
    const compareMax = (await sql.select({ id: posts.id }).from(posts).where(and(eq(posts.authorId, a), eq(posts.votes, 2147483647)))).length;
    return { rejected, rowsAfterRejections, accepted, compareMax };
  } finally {
    await removeAuthor(sql, name);
  }
};

/** SQL-AC-005: the last step violates a uniqueness constraint; nothing of the earlier steps remains. */
const atomicRollback = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const name = `${ns}:x`;
  const a = newId();
  const p = newId();
  const result = await outcome(() =>
    atomic(sql, [
      (w) => w.insert(authors).values({ id: a, name }),
      (w) => w.insert(posts).values({ id: p, authorId: a, title: "in atomic", createdAt: 1 }),
      (w) => w.insert(tags).values({ id: newId(), postId: p, label: "x" }),
      (w) => w.insert(authors).values({ id: newId(), name }),
    ]),
  );
  const left = {
    authors: (await sql.select({ id: authors.id }).from(authors).where(eq(authors.name, name))).length,
    posts: (await sql.select({ id: posts.id }).from(posts).where(eq(posts.id, p))).length,
    tags: (await sql.select({ id: tags.id }).from(tags).where(eq(tags.postId, p))).length,
  };
  await removeAuthor(sql, name);
  return { result, left };
};

/** SQL-AC-005: a successful `atomic` call commits every step and returns each step's RETURNING rows. */
const atomicCommit = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const name = `${ns}:x`;
  const a = newId();
  const p = newId();
  try {
    const results = await atomic(sql, [
      (w) => w.insert(authors).values({ id: a, name }),
      (w) => w.insert(posts).values({ id: p, authorId: a, title: "committed", createdAt: 1 }).returning({ id: posts.id }),
    ]);
    const stored = (await sql.select({ title: posts.title }).from(posts).where(eq(posts.authorId, a))).map((r) => r.title);
    return { first: results[0] === undefined ? "undefined" : typeName(results[0]), second: results[1].map((r) => r.id === p), stored, empty: await atomic(sql, []) };
  } finally {
    await removeAuthor(sql, name);
  }
};

/** SQL-AC-005: one step's write is built on the outer handle; nothing is executed, including earlier steps. */
const atomicOuterHandle = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const name = `${ns}:x`;
  const first = newId();
  const result = await outcome(() =>
    atomic(sql, [
      (w) => w.insert(authors).values({ id: first, name }),
      () => sql.insert(authors).values({ id: newId(), name: `${name}:outer` }),
    ]),
  );
  const left = (await sql.select({ id: authors.id }).from(authors).where(inArray(authors.name, [name, `${name}:outer`]))).length;
  await removeAuthor(sql, name);
  await removeAuthor(sql, `${name}:outer`);
  return { result, left };
};

/** SQL-AC-006: a duplicate unique value (single-column, then composite) yields `SQL.CONFLICT`. */
const duplicateUnique = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const name = `${ns}:c`;
  const a = newId();
  const p = newId();
  try {
    await sql.insert(authors).values({ id: a, name });
    await sql.insert(posts).values({ id: p, authorId: a, title: "c", createdAt: 1 });
    await sql.insert(tags).values({ id: newId(), postId: p, label: "dup" });
    const composite = await codeOf(() => sql.insert(tags).values({ id: newId(), postId: p, label: "dup" }));
    const updateToDuplicate = await codeOf(async () => {
      const other = newId();
      await sql.insert(authors).values({ id: other, name: `${name}:2` });
      try {
        await sql.update(authors).set({ name }).where(eq(authors.id, other));
      } finally {
        await sql.delete(authors).where(eq(authors.id, other));
      }
    });
    const stillOne = (await sql.select({ id: authors.id }).from(authors).where(eq(authors.name, name))).length;
    return { composite, updateToDuplicate, stillOne };
  } finally {
    await removeAuthor(sql, name);
  }
};

/** SQL-AC-006: a plain duplicate unique insert, left to propagate (the HTTP answer is the framework's ErrorResponse). */
const duplicateThrows = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const ns = namespace(input);
  const name = `${ns}:c`;
  try {
    await sql.insert(authors).values({ id: newId(), name });
    await sql.insert(authors).values({ id: newId(), name });
    return "second insert accepted";
  } finally {
    await removeAuthor(sql, name);
  }
};

/** Characters per oversized row: over PAR-215 (256 KiB) in UTF-8, one row only (plan §1 limits). */
const OVERSIZED_CHARS = 270_000;
/** Characters per row that fits: a result of one such row is within PAR-215. */
const FITTING_CHARS = 200_000;

const sizeInput = z.object({ ns: z.string().min(8).max(64), chars: z.number().int().min(1).max(OVERSIZED_CHARS) });

/** SQL-AC-006: one row of `chars` ASCII characters is written and selected back, then removed. */
const resultSize = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const { chars } = sizeInput.parse(input);
  const id = newId();
  await sql.insert(blobs).values({ id, body: "x".repeat(chars) });
  try {
    const rows = await sql.select({ body: blobs.body }).from(blobs).where(eq(blobs.id, id));
    return { rows: rows.length, length: rows[0]?.body.length ?? 0 };
  } finally {
    await sql.delete(blobs).where(eq(blobs.id, id));
  }
};

/**
 * SQL-AC-006 (DEC-0542): one row of `chars` ASCII characters is inserted with `returning`, which
 * must resolve with the row even when it is larger than PAR-215; the stored rows are then counted
 * (exactly one: the write was saved once and reported as a success), and the row is removed.
 */
const writeResultSize = async ({ sql }: CaseServices, input: unknown): Promise<unknown> => {
  const { chars } = sizeInput.parse(input);
  const id = newId();
  try {
    const returned = await sql.insert(blobs).values({ id, body: "x".repeat(chars) }).returning({ id: blobs.id, body: blobs.body });
    const stored = await sql.select({ id: blobs.id }).from(blobs).where(eq(blobs.id, id));
    return { returned: returned.length, length: returned[0]?.body.length ?? 0, stored: stored.length };
  } finally {
    await sql.delete(blobs).where(eq(blobs.id, id));
  }
};

export const SQL_SIZES = { oversized: OVERSIZED_CHARS, fitting: FITTING_CHARS } as const;

export const sqlCases: CaseSet = {
  seed,
  cleanup,
  ordering,
  filters,
  text,
  aggregates,
  shapes,
  writes,
  boundaries,
  atomicRollback,
  atomicCommit,
  atomicOuterHandle,
  duplicateUnique,
  duplicateThrows,
  resultSize,
  writeResultSize,
};
