/**
 * SQL-AC-004 (local part: local D1 and PGlite) — boundary values for each portable column
 * type (sql.md §2.1) are accepted or rejected identically. Rejections are
 * `SQL.INVALID_VALUE` (SQL-REQ-004) and write nothing; accepted values read back exactly
 * (negative zero as zero). `ref` boundaries are database constraints and surface as
 * `SQL.CONFLICT` (SQL-REQ-006). The same literals run in one process per dialect.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { asc, count, eq, newId } from "../../../src/index.js";
import type { TestApp } from "../../../src/testing/index.js";
import { DIALECT_LABEL, type Dialect } from "./support/dialect.js";
import { expectCode } from "./support/errors.js";
import { probe, run } from "./support/probe.js";
import { A1, A4, seed } from "./support/seed.js";
import { newTestApp, tables, uuid } from "./support/suite-app.js";

const { samples, authors, posts } = tables;
type SampleInsert = typeof samples.$inferInsert;
type Column = "intValue" | "numValue" | "tsValue" | "boolValue" | "textValue";

/** Smuggles a value the static types forbid, as untyped app input would. */
const raw = <T>(v: unknown): T => v as T;

export function defineValueSuite(dialect: Dialect): void {
  const on = `(${DIALECT_LABEL[dialect]})`;
  const t = (title: string): string => tag("SQL-AC-004", `${title} ${on}`);

  describe(`SQL value rules ${on}`, () => {
    let app: TestApp;
    let n = 100;

    beforeEach(async () => {
      app = await newTestApp();
      await seed(app);
    }, 120_000);
    afterEach(async () => {
      await app?.dispose();
    }, 120_000);

    const sampleCount = (): Promise<number> =>
      run(app, async ({ sql }) => (await sql.select({ n: count() }).from(samples))[0]?.n ?? -1);

    async function expectAccepted(column: Column, value: unknown, readBack: unknown = value): Promise<void> {
      const id = uuid(++n);
      const row = { id, label: `ok-${n}`, [column]: value } as SampleInsert;
      const inserted = await probe(app, async ({ sql }) => sql.insert(samples).values(row));
      expect(inserted.ok, `${column} = ${String(value)} should be accepted`).toBe(true);
      const read = await run(app, async ({ sql }) => sql.select().from(samples).where(eq(samples.id, id)));
      expect(read).toHaveLength(1);
      const got = read[0]?.[column];
      expect(Object.is(got, readBack), `${column}: wrote ${String(value)}, read ${String(got)}`).toBe(true);
    }

    async function expectRejected(column: Column, value: unknown): Promise<void> {
      const before = await sampleCount();
      const id = uuid(++n);
      const row = { id, label: `bad-${n}`, [column]: value } as SampleInsert;
      const inserted = await probe(app, async ({ sql }) => sql.insert(samples).values(row));
      expectCode(inserted, "SQL.INVALID_VALUE");
      expect(await sampleCount()).toBe(before);
      // The same value is rejected on update, and the stored value is unchanged.
      const target = uuid(++n);
      await run(app, async ({ sql }) => sql.insert(samples).values({ id: target, label: `target-${n}` }));
      const updated = await probe(app, async ({ sql }) => sql.update(samples).set({ [column]: value } as Partial<SampleInsert>).where(eq(samples.id, target)));
      expectCode(updated, "SQL.INVALID_VALUE");
      const after = await run(app, async ({ sql }) => sql.select().from(samples).where(eq(samples.id, target)));
      expect(after[0]?.[column]).toBeNull();
    }

    it(t("integer: signed 32-bit integral numbers only (2147483647 accepted, 2147483648 rejected)"), async () => {
      await expectAccepted("intValue", 2147483647);
      await expectAccepted("intValue", -2147483648);
      await expectAccepted("intValue", 0);
      await expectAccepted("intValue", -0, 0);
      await expectRejected("intValue", 2147483648);
      await expectRejected("intValue", -2147483649);
      await expectRejected("intValue", 1.5);
      await expectRejected("intValue", Number.NaN);
      await expectRejected("intValue", Number.POSITIVE_INFINITY);
      await expectRejected("intValue", 2 ** 53);
      await expectRejected("intValue", raw("1"));
    });

    it(t("number: finite doubles accepted, negative zero stored as zero, non-finite rejected"), async () => {
      await expectAccepted("numValue", Number.MAX_VALUE);
      await expectAccepted("numValue", -Number.MAX_VALUE);
      await expectAccepted("numValue", Number.MIN_VALUE);
      await expectAccepted("numValue", 0.1);
      await expectAccepted("numValue", -2.5);
      await expectAccepted("numValue", -0, 0);
      await expectRejected("numValue", Number.POSITIVE_INFINITY);
      await expectRejected("numValue", Number.NEGATIVE_INFINITY);
      await expectRejected("numValue", Number.NaN);
      await expectRejected("numValue", raw("1.5"));
    });

    it(t("timestamp: non-negative safe integers (epoch ms) only"), async () => {
      await expectAccepted("tsValue", 0);
      await expectAccepted("tsValue", Number.MAX_SAFE_INTEGER);
      await expectAccepted("tsValue", 1_760_000_000_000);
      await expectRejected("tsValue", -1);
      await expectRejected("tsValue", Number.MAX_SAFE_INTEGER + 1);
      await expectRejected("tsValue", 1.5);
      await expectRejected("tsValue", Number.NaN);
      await expectRejected("tsValue", raw("0"));
    });

    it(t("boolean: actual booleans only"), async () => {
      await expectAccepted("boolValue", true);
      await expectAccepted("boolValue", false);
      await expectRejected("boolValue", raw(1));
      await expectRejected("boolValue", raw(0));
      await expectRejected("boolValue", raw("true"));
    });

    it(t("text: well-formed Unicode without NUL (unpaired surrogates rejected)"), async () => {
      await expectAccepted("textValue", "");
      await expectAccepted("textValue", "é漢😀�");
      await expectAccepted("textValue", "😀"); // a correctly paired surrogate pair
      await expectAccepted("textValue", "x".repeat(10_000));
      await expectRejected("textValue", "\uD800");
      await expectRejected("textValue", "\uDC00");
      await expectRejected("textValue", "a\uD800b");
      await expectRejected("textValue", "\uDE00\uD83D"); // reversed pair: two unpaired surrogates
      await expectRejected("textValue", "a\u0000b");
      await expectRejected("textValue", raw(42));
    });

    it(t("NOT NULL columns reject NULL; nullable columns and defaults behave as declared"), async () => {
      const before = await run(app, async ({ sql }) => sql.select({ n: count() }).from(posts));
      const nullTitle = await probe(app, async ({ sql }) =>
        sql.insert(posts).values({ id: uuid(60), authorId: A1, title: raw<string>(null), draft: false }));
      expectCode(nullTitle, "SQL.INVALID_VALUE");
      const nullRequired = await probe(app, async ({ sql }) =>
        sql.insert(samples).values({ id: uuid(61), label: "null-required", required: raw<number>(null) }));
      expectCode(nullRequired, "SQL.INVALID_VALUE");
      expect(await run(app, async ({ sql }) => sql.select({ n: count() }).from(posts))).toEqual(before);
      await run(app, async ({ sql }) => sql.insert(samples).values({ id: uuid(62), label: "defaults" }));
      const row = await run(app, async ({ sql }) => sql.select().from(samples).where(eq(samples.id, uuid(62))));
      expect(row).toEqual([{
        id: uuid(62), label: "defaults", intValue: null, numValue: null, tsValue: null, boolValue: null, textValue: null,
        authorId: null, required: 1,
      }]);
    });

    it(t("a multi-row write with one invalid value writes nothing"), async () => {
      const before = await sampleCount();
      const outcome = await probe(app, async ({ sql }) =>
        sql.insert(samples).values([
          { id: uuid(70), label: "fine-1", intValue: 1 },
          { id: uuid(71), label: "fine-2", intValue: 2147483648 },
        ]));
      expectCode(outcome, "SQL.INVALID_VALUE");
      expect(await sampleCount()).toBe(before);
    });

    it(t("id: values from newId() are UUID v4 text and accepted; other text is rejected"), async () => {
      const ids = [newId(), newId(), newId()];
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(new Set(ids).size).toBe(3);
      await run(app, async ({ sql }) => sql.insert(samples).values(ids.map((id, i) => ({ id, label: `newid-${i}` }))));
      const read = await run(app, async ({ sql }) =>
        sql.select({ id: samples.id }).from(samples).where(eq(samples.label, "newid-0")));
      expect(read).toEqual([{ id: ids[0] }]);
      const before = await sampleCount();
      const bad = await probe(app, async ({ sql }) => sql.insert(samples).values({ id: "not-a-uuid", label: "bad-id" }));
      expectCode(bad, "SQL.INVALID_VALUE");
      expect(await sampleCount()).toBe(before);
    });

    it(t("ref: must reference an existing row, and a referenced row cannot be deleted (SQL.CONFLICT)"), async () => {
      // A4 has no posts, so only the sample row references it.
      await run(app, async ({ sql }) => sql.insert(samples).values({ id: uuid(80), label: "ref-ok", authorId: A4 }));
      const missing = await probe(app, async ({ sql }) =>
        sql.insert(samples).values({ id: uuid(81), label: "ref-missing", authorId: uuid(999) }));
      expectCode(missing, "SQL.CONFLICT");
      const del = await probe(app, async ({ sql }) => sql.delete(authors).where(eq(authors.id, A4)));
      expectCode(del, "SQL.CONFLICT");
      const left = await run(app, async ({ sql }) => sql.select({ id: authors.id }).from(authors).where(eq(authors.id, A4)));
      expect(left).toEqual([{ id: A4 }]);
      const refs = await run(app, async ({ sql }) =>
        sql.select({ label: samples.label }).from(samples).where(eq(samples.authorId, A4)).orderBy(asc(samples.label)));
      expect(refs).toEqual([{ label: "ref-ok" }]);
    });
  });
}
