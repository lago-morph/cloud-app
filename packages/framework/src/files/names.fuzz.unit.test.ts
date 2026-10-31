/**
 * Fuzz target F5 (S4, `ai/implementation/v0.2.0-coverage-fuzz.md` §2; plan §7a.1.7):
 * `names.ts` (`checkName`, `checkPrefix`), `cloudflare/keys.ts` (`storedKey`, `nameOfKey`),
 * `s3/path.ts` `objectPath`.
 * Reason: file names and list prefixes are chosen by app users and become R2 keys and presigned
 * URL paths; the rule regressed repeatedly (DEC-0162 → 0328 → 0430 → 0505 → 0533).
 * Runs: 1,000 (PAR-412). Seed: 2026103105 (DEC-0647).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { nameOfKey, storedKey } from "./cloudflare/keys.js";
import { MAX_NAME_BYTES, checkName, checkPrefix } from "./names.js";
import { objectPath } from "./s3/path.js";

const RUNS = 1_000;
const SEED = 2026103105;
const OPTIONS = { seed: SEED, numRuns: RUNS } as const;

/** UTF-8 length counted from code units, independently of TextEncoder (a lone surrogate counts 3, as U+FFFD). */
function utf8Length(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

function hasLoneSurrogate(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xd800 && cp <= 0xdfff) return true;
  }
  return false;
}

const hasControl = (text: string): boolean => [...text].some((ch) => (ch.codePointAt(0) ?? 0) <= 0x1f || ch === "\u007f");

/** The documented classes of FILES-REQ-002 (names.ts), written out independently. */
function documentedInvalidName(name: string): boolean {
  return name === "" || name === "." || name.split("/").includes("..") || hasLoneSurrogate(name) || hasControl(name) || utf8Length(name) > MAX_NAME_BYTES;
}
const documentedInvalidPrefix = (prefix: string): boolean => hasLoneSurrogate(prefix) || hasControl(prefix) || utf8Length(prefix) > MAX_NAME_BYTES;

function rejects(check: (s: string) => string, input: string): boolean {
  try {
    expect(check(input)).toBe(input);
    return false;
  } catch (error) {
    if (!(error instanceof FrameworkError)) throw error;
    expect(error.code).toBe("FILES.INVALID_NAME");
    return true;
  }
}

/** Code point order (FILES-REQ-001), from code points. */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return x.length - y.length;
}
const utf8 = new TextEncoder();
const compareBytes = (a: string, b: string): number => Buffer.compare(Buffer.from(utf8.encode(a)), Buffer.from(utf8.encode(b)));

const piece = fc.oneof(
  fc.constantFrom("/", ".", "..", "./", "../", "/..", "a", "Z", "é", "😀", "\u0000", "\u0001", "\u001f", "\u007f", "\u0080", "\ud800", "\udc00", "￿", "\u{10ffff}", "%2e", "%2F", " ", "?", "#", "~"),
  fc.string({ unit: "binary", maxLength: 3 }),
);
/** Long names around the 1,024-byte boundary, in 1-, 2-, 3- and 4-byte characters. */
const nearLimit = fc
  .tuple(fc.constantFrom("a", "é", "€", "😀"), fc.integer({ min: -3, max: 3 }), fc.array(piece, { maxLength: 2 }))
  .map(([ch, delta, tail]) => ch.repeat(Math.max(1, Math.floor(MAX_NAME_BYTES / utf8.encode(ch).length) + delta)) + tail.join(""));
const name = fc.oneof(fc.array(piece, { maxLength: 8 }).map((p) => p.join("")), nearLimit, fc.string({ unit: "binary", maxLength: 12 }));
const validName = name.filter((n) => !documentedInvalidName(n));
const S3_BASE = "https://account.r2.cloudflarestorage.com/bucket/";

describe("F5: FILES name to storage address fuzz (FILES-REQ-001, FILES-REQ-002, DEC-0430)", () => {
  it(`checkName and checkPrefix reject exactly the documented classes (${RUNS} runs, seed ${SEED})`, () => {
    fc.assert(
      fc.property(name, (n) => {
        expect(rejects(checkName, n)).toBe(documentedInvalidName(n));
        expect(rejects(checkPrefix, n)).toBe(documentedInvalidPrefix(n));
      }),
      OPTIONS,
    );
  });

  it(`a valid name's stored key round-trips, fits R2, keeps order and prefixes, and survives URL parsing (${RUNS} runs, seed ${SEED})`, () => {
    const prefixOf = fc.tuple(validName, fc.nat()).map(([n, cut]) => Array.from(n).slice(0, cut % (Array.from(n).length + 1)).join(""));
    fc.assert(
      fc.property(validName, validName, fc.oneof(prefixOf, name), (a, b, prefix) => {
        const key = storedKey(a);
        expect(nameOfKey(key)).toBe(a);
        expect(utf8.encode(key).byteLength).toBeLessThanOrEqual(MAX_NAME_BYTES);
        expect(Math.sign(compareBytes(key, storedKey(b)))).toBe(Math.sign(compareCodePoints(a, b)));
        if (!documentedInvalidPrefix(prefix)) expect(key.startsWith(prefix)).toBe(a.startsWith(prefix));
        const url = new URL(S3_BASE + objectPath(a, key));
        expect(url.origin + url.pathname.slice(0, "/bucket/".length)).toBe(S3_BASE);
        expect(decodeURIComponent(url.pathname.slice("/bucket/".length))).toBe(key);
      }),
      OPTIONS,
    );
  });
});
