/**
 * Fuzz target F4, files part (S4, `ai/implementation/v0.2.0-coverage-fuzz.md` §2; plan §7a.1.7):
 * `files/local/tickets.ts` `verifyLocalTicket` with `files/base64url.ts`. The auth part is
 * `auth/signing.fuzz.unit.test.ts`, with the same seed.
 * Reason: transfer-ticket URLs come back from any browser.
 * Runs: 500 per property (S4), except 250 for each property that signs and verifies with HMAC
 * (`crypto.subtle`, async), which keeps F4 within PAR-411 (DEC-0777). Seed: 2026103104 (DEC-0647).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { base64urlToBytes, base64urlToText, bytesToBase64url, textToBase64url } from "../base64url.js";
import { LOCAL_TRANSFER_PATH, createLocalTicketIssuer, verifyLocalTicket } from "./tickets.js";

const RUNS = 500;
const SEED = 2026103104;
const OPTIONS = { seed: SEED, numRuns: RUNS } as const;
/** DEC-0777: the HMAC properties run 250 times, so that F4 stays within PAR-411 (1 s per target). */
const HMAC_RUNS = 250;
const HMAC_OPTIONS = { seed: SEED, numRuns: HMAC_RUNS } as const;

/** A generated dummy key, never a real credential. */
const KEY = `fuzz-local-key-${"k".repeat(32)}`;
const issuer = createLocalTicketIssuer({ key: async () => KEY });

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Characters a mutation may put in: the alphabet, its `+/=` spellings, the separator, look-alikes. */
const MUTANT_CHARS = [...B64URL, "+", "/", "=", ".", " ", "%", "\u0410", "\u2010"];

type Mutation =
  | { readonly kind: "substitute" | "insert"; readonly at: number; readonly ch: string }
  | { readonly kind: "delete"; readonly at: number }
  | { readonly kind: "swap" | "plus-slash" }
  | { readonly kind: "pad"; readonly part: 0 | 1; readonly pad: string }
  | { readonly kind: "respell-end"; readonly part: 0 | 1; readonly flip: 1 | 2 | 3 };

const mutation: fc.Arbitrary<Mutation> = fc.oneof(
  fc.record({ kind: fc.constantFrom("substitute" as const, "insert" as const), at: fc.nat(), ch: fc.constantFrom(...MUTANT_CHARS) }),
  fc.record({ kind: fc.constant("delete" as const), at: fc.nat() }),
  fc.record({ kind: fc.constantFrom("swap" as const, "plus-slash" as const) }),
  fc.record({ kind: fc.constant("pad" as const), part: fc.constantFrom(0 as const, 1 as const), pad: fc.constantFrom("=", "==", "===") }),
  // Another spelling of a part's last character: the same high bits, other low (padding) bits.
  fc.record({ kind: fc.constant("respell-end" as const), part: fc.constantFrom(0 as const, 1 as const), flip: fc.constantFrom(1 as const, 2 as const, 3 as const) }),
);

/** The token with one mutation applied (it may come out unchanged; callers skip that case). */
function mutate(token: string, m: Mutation): string {
  const parts = token.split(".");
  switch (m.kind) {
    case "substitute": {
      const at = m.at % token.length;
      return token.slice(0, at) + m.ch + token.slice(at + 1);
    }
    case "insert": {
      const at = m.at % (token.length + 1);
      return token.slice(0, at) + m.ch + token.slice(at);
    }
    case "delete": {
      const at = m.at % token.length;
      return token.slice(0, at) + token.slice(at + 1);
    }
    case "swap":
      return [...parts].reverse().join(".");
    case "plus-slash":
      return token.replace(/-/g, "+").replace(/_/g, "/");
    case "pad":
      return parts.map((p, i) => (i === m.part ? p + m.pad : p)).join(".");
    case "respell-end":
      return parts.map((p, i) => (i === m.part && p !== "" ? p.slice(0, -1) + (B64URL[B64URL.indexOf(p.slice(-1)) ^ m.flip] ?? "") : p)).join(".");
  }
}

const tokenOf = (ticket: unknown): string => (ticket as { url: string }).url.slice(LOCAL_TRANSFER_PATH.length);
const name = fc.string({ unit: "binary", minLength: 1, maxLength: 8 });
const grant = fc.oneof(
  fc.record({ op: fc.constant("download" as const), name }),
  fc.record({ op: fc.constant("upload" as const), name, contentType: fc.constantFrom("image/png", "text/plain", "application/octet-stream") }),
);

describe("F4: local transfer tickets fuzz (files.md §2 Local)", () => {
  it(`no mutation of a valid ticket verifies (${HMAC_RUNS} runs, seed ${SEED})`, async () => {
    await fc.assert(
      fc.asyncProperty(grant, mutation, async (g, m) => {
        const token = tokenOf(g.op === "upload" ? await issuer.upload(g.name, g.contentType) : await issuer.download(g.name));
        expect(await verifyLocalTicket(token, KEY)).toEqual(g);
        const mutated = mutate(token, m);
        if (mutated !== token) expect(await verifyLocalTicket(mutated, KEY)).toBeUndefined();
      }),
      HMAC_OPTIONS,
    );
  });

  it(`base64urlToBytes and base64urlToText return a value only for its canonical spelling (${RUNS} runs, seed ${SEED})`, () => {
    const b64 = fc.string({ unit: fc.constantFrom(...B64URL), maxLength: 48 });
    // `77u_` is a UTF-8 byte order mark (review of the F4 record, round 1).
    const withBom = b64.map((rest) => `77u_${rest}`);
    fc.assert(
      fc.property(fc.oneof(b64, withBom, fc.string({ unit: "binary", maxLength: 16 })), (input) => {
        const bytes = base64urlToBytes(input);
        if (bytes !== undefined) expect(bytesToBase64url(bytes)).toBe(input);
        const text = base64urlToText(input);
        if (text !== undefined) expect(textToBase64url(text)).toBe(input);
      }),
      OPTIONS,
    );
  });
});
