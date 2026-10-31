/**
 * Fuzz target F6, KV part (S4, `ai/implementation/v0.2.0-coverage-fuzz.md` §2; plan §7a.1.7):
 * `cursor.ts` (`decodeCursor`, `encodeCursor`) and `range.ts` `prefixEnd`. The FILES part is
 * `files/cursor.fuzz.unit.test.ts`, with the same seed.
 * Reason: list cursors come back from clients (apps forward them from query parameters);
 * DEC-0150, DEC-0162 (amended by DEC-0430).
 * Runs: 1,000 per property (PAR-412). Seed: 2026103106 (DEC-0647).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { prefixEnd } from "./range.js";
import { checkKey, checkPrefix } from "./rules.js";

const RUNS = 1_000;
const SEED = 2026103106;
const OPTIONS = { seed: SEED, numRuns: RUNS } as const;

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Code points at the edges `prefixEnd` handles, plus ordinary ones. */
const edge = fc.constantFrom("a", "z", "/", ":", "\u0000", "\u007f", "\u0080", "߿", "ࠀ", "퟿", "", "￿", "\u{10000}", "\u{10fffe}", "\u{10ffff}");
const loneSurrogate = fc.constantFrom("\ud800", "\udbff", "\udc00", "\udfff");
const wellFormed = fc.array(fc.oneof(edge, fc.string({ unit: "grapheme", maxLength: 2 })), { maxLength: 6 }).map((p) => p.join(""));
const anyText = fc.array(fc.oneof(edge, loneSurrogate, fc.string({ unit: "binary", maxLength: 2 })), { maxLength: 6 }).map((p) => p.join(""));

function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return x.length - y.length;
}

const isValidKey = (key: string): boolean => {
  try {
    checkKey(key);
    return true;
  } catch {
    return false;
  }
};

/** Prefixes shared by generated cursors and requests, so that some cursors match the prefix asked for. */
const prefixPool = fc.oneof(fc.constantFrom("", "a", "a/", "\u{10ffff}", "\ud800"), anyText);

/** A cursor as `encodeCursor` issues it, for any prefix and key (valid or not), usually with the key inside the prefix. */
const issued = fc
  .tuple(prefixPool, anyText, fc.oneof(fc.constant(true), fc.constant(true), fc.constant(false)), anyText)
  .map(([p, rest, inside, other]) => encodeCursor(p, inside ? p + rest : other));

/** Cursor-shaped and arbitrary input: issued cursors, their re-spellings and edits, raw base64url, any text. */
const cursorInput = fc.oneof(
  issued,
  fc.tuple(issued, fc.nat(), fc.constantFrom(...B64URL)).map(([c, at, ch]) => {
    const i = at % c.length;
    return c.slice(0, i) + ch + c.slice(i + 1);
  }),
  fc.tuple(issued, fc.constantFrom("=", "==", "+", "/", " ")).map(([c, extra]) => c + extra),
  // Another spelling of the last character: the same high bits, other low (padding) bits.
  fc.tuple(issued, fc.constantFrom(1, 2, 3)).map(([c, flip]) => c.slice(0, -1) + (B64URL[B64URL.indexOf(c.slice(-1)) ^ flip] ?? "")),
  fc.jsonValue().map((v) => Buffer.from(JSON.stringify(v) ?? "").toString("base64url")),
  fc.string({ unit: fc.constantFrom(...B64URL), maxLength: 40 }),
  fc.string({ unit: "binary", maxLength: 16 }),
);

describe("F6: KV list cursors and prefix ranges fuzz (KV-REQ-003, kv.md §2)", () => {
  it(`decoding any string gives a valid key inside the prefix, or KV.INVALID_CURSOR (${RUNS} runs, seed ${SEED})`, () => {
    fc.assert(
      fc.property(cursorInput, prefixPool, (cursor, prefix) => {
        let key: string;
        try {
          key = decodeCursor(cursor, prefix);
        } catch (error) {
          expect(error).toBeInstanceOf(FrameworkError);
          expect((error as FrameworkError).code).toBe("KV.INVALID_CURSOR");
          return;
        }
        expect(key.startsWith(prefix)).toBe(true);
        expect(isValidKey(key)).toBe(true);
        // Only the canonical base64url spelling of the bytes decodes (kv.md §2).
        expect(Buffer.from(cursor, "base64url").toString("base64url")).toBe(cursor);
      }),
      OPTIONS,
    );
  });

  it(`decoding an encoded (prefix, key) gives the key back (${RUNS} runs, seed ${SEED})`, () => {
    fc.assert(
      fc.property(wellFormed, wellFormed, (prefix, rest) => {
        const key = prefix + rest;
        fc.pre(isValidKey(key));
        expect(decodeCursor(encodeCursor(prefix, key), prefix)).toBe(key);
      }),
      OPTIONS,
    );
  });

  it(`prefixEnd(p) is above every key starting with p and at most every greater key that does not (${RUNS} runs, seed ${SEED})`, () => {
    fc.assert(
      fc.property(wellFormed, wellFormed, fc.oneof(wellFormed, fc.constant("")), (prefix, other, rest) => {
        const end = prefixEnd(prefix);
        const inside = prefix + rest;
        if (end === null) {
          expect(Array.from(prefix).every((c) => c === "\u{10ffff}")).toBe(true);
          return;
        }
        expect(compareCodePoints(inside, end)).toBeLessThan(0);
        if (!other.startsWith(prefix) && compareCodePoints(other, prefix) > 0) expect(compareCodePoints(end, other)).toBeLessThanOrEqual(0);
      }),
      OPTIONS,
    );
  });

  it(`a prefix with a lone surrogate never reaches prefixEnd: checkPrefix refuses it (${RUNS} runs, seed ${SEED})`, () => {
    fc.assert(
      fc.property(wellFormed, loneSurrogate, wellFormed, (before, lone, after) => {
        const prefix = before + lone + after;
        fc.pre(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(prefix));
        expect(() => checkPrefix(prefix)).toThrow(expect.objectContaining({ code: "KV.INVALID_KEY" }));
      }),
      OPTIONS,
    );
  });
});
