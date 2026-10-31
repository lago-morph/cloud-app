/**
 * Fuzz target F1 (S4, `ai/implementation/v0.2.0-coverage-fuzz.md` §2; plan §7a.1.7).
 * Reason: `returnTo` on `/api/auth/login` comes from any link and becomes the post-login
 * `Location`, and `sanitizeReturnTo` is a hand-written multi-clause rule (DEC-0173).
 * Runs: 1,000 (PAR-412). Seed: 2026103101 (DEC-0647).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "./return-to.js";

const RUNS = 1_000;
const SEED = 2026103101;

/** Pieces that the six clauses (and the URL parser) treat specially, mixed with arbitrary text. */
const piece = fc.oneof(
  fc.constantFrom("/", "\\", "%2f", "%2F", "%5c", "%5C", "%09", "%0a", "%0D", "%20", "%25", "%", "@", ":", ".", "%2e", "?", "#", "\t", "\n", " "),
  fc.constantFrom("evil.example", "//evil.example", "https:", "javascript:", "a", "x=1&y=2", "%E2%80%AE", "%C0%AF", "%ZZ"),
  fc.string({ unit: "binary", maxLength: 4 }),
);
/** What may follow the leading "/" to turn it into a scheme-relative or backslash path. */
const separator = fc.constantFrom("/", "\\", "%2f", "%2F", "%5c", "%5C", "%09", "%0a", "%0d", "\t", "\n", "@", ":");
const candidate = fc.oneof(
  fc.array(piece, { maxLength: 8 }).map((parts) => parts.join("")),
  fc.array(piece, { maxLength: 8 }).map((parts) => `/${parts.join("")}`),
  fc
    .tuple(fc.array(separator, { minLength: 1, maxLength: 3 }), fc.array(piece, { maxLength: 4 }))
    .map(([head, tail]) => `/${head.join("")}${tail.join("")}`),
  fc.string({ unit: "binary" }),
);
const httpsOrigin = fc.domain().map((host) => new URL(`https://${host}`).origin);

describe("F1: sanitizeReturnTo (AUTH-AC-010, DEC-0173) fuzz", () => {
  it(`keeps only same-origin paths, also after one more percent-decode (${RUNS} runs, seed ${SEED})`, () => {
    fc.assert(
      fc.property(candidate, httpsOrigin, (input, origin) => {
        const out = sanitizeReturnTo(input);
        expect(out === "/" || out === input).toBe(true);
        expect(out).toMatch(/^[\x21-\x7e]+$/);
        expect(new URL(out, origin).origin).toBe(origin);
        expect(new URL(decodeURIComponent(out), origin).origin).toBe(origin);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
