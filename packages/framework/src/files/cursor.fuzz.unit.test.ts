/**
 * Fuzz target F6, FILES part (S4, `ai/implementation/v0.2.0-coverage-fuzz.md` §2; plan §7a.1.7):
 * `cursor.ts` (`decodeCursor`, `encodeCursor`). The KV part is `kv/cursor.fuzz.unit.test.ts`,
 * with the same seed.
 * Reason: list cursors come back from clients (apps forward them from query parameters);
 * DEC-0150, DEC-0162 (amended by DEC-0430). `cursor.ts` decodes with `base64url.ts`, so the
 * canonical-spelling check is also the similar-case test of F4's finding (plan §7a.1.8 step 4).
 * Runs: 1,000 per property (PAR-412). Seed: 2026103106 (DEC-0647).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { decodeCursor, encodeCursor } from "./cursor.js";

const RUNS = 1_000;
const SEED = 2026103106;
const OPTIONS = { seed: SEED, numRuns: RUNS } as const;

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const edge = fc.constantFrom("a", "/", ".", "..", "\u0000", "\u0001", "\u007f", "\u0080", "퟿", "", "￿", "\u{10ffff}", "\ud800", "\udc00");
const anyText = fc.array(fc.oneof(edge, fc.string({ unit: "binary", maxLength: 2 })), { maxLength: 6 }).map((p) => p.join(""));
const wellFormedText = fc.array(fc.oneof(edge.filter((c) => !/^[\ud800-\udfff]$/.test(c)), fc.string({ unit: "grapheme", maxLength: 2 })), { maxLength: 6 }).map((p) => p.join(""));
/** Prefixes shared by generated cursors and requests, so that some cursors match the prefix asked for. */
const prefixPool = fc.oneof(fc.constantFrom("", "a", "a/", "\u{10ffff}"), anyText);

/** A cursor as `encodeCursor` issues it, for any prefix and name, usually with the name inside the prefix. */
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

describe("F6: FILES list cursors fuzz (FILES-REQ-001)", () => {
  it(`decoding any string gives a name inside the prefix, or FILES.INVALID_CURSOR (${RUNS} runs, seed ${SEED})`, () => {
    fc.assert(
      fc.property(cursorInput, prefixPool, (cursor, prefix) => {
        let name: string;
        try {
          name = decodeCursor(prefix, cursor);
        } catch (error) {
          expect(error).toBeInstanceOf(FrameworkError);
          expect((error as FrameworkError).code).toBe("FILES.INVALID_CURSOR");
          return;
        }
        expect(name.startsWith(prefix)).toBe(true);
        // Only the canonical base64url spelling of the bytes decodes (as in KV, kv.md §2).
        expect(Buffer.from(cursor, "base64url").toString("base64url")).toBe(cursor);
      }),
      OPTIONS,
    );
  });

  it(`decoding an encoded (prefix, name) gives the name back (${RUNS} runs, seed ${SEED})`, () => {
    fc.assert(
      fc.property(wellFormedText, wellFormedText, (prefix, rest) => {
        expect(decodeCursor(prefix, encodeCursor(prefix, prefix + rest))).toBe(prefix + rest);
      }),
      OPTIONS,
    );
  });
});
