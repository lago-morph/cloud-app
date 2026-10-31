/**
 * Fuzz target F4, auth part (S4, `ai/implementation/v0.2.0-coverage-fuzz.md` §2; plan §7a.1.7):
 * `signing.ts` (`verifyToken`, `base64urlDecode`), `session.ts` `readSession`,
 * `transaction.ts` `readTransaction`, `cookies.ts` `readCookie`. The files part (local tickets,
 * `files/base64url.ts`) is `files/local/tickets.fuzz.unit.test.ts`, with the same seed.
 * Reason: the `Cookie` header (`__Host-session`, `__Host-login`) comes from any browser.
 * Runs: 500 per property (S4), except 250 for each property that signs and verifies with HMAC
 * (`crypto.subtle`, async), which keeps F4 within PAR-411 (DEC-0777). Seed: 2026103104 (DEC-0647).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readCookie } from "./cookies.js";
import { readSession, issueSession, SESSION_LIFETIME_SECONDS, type SessionData } from "./session.js";
import { base64urlDecode, base64urlEncode, verifyToken } from "./signing.js";
import { issueTransaction, readTransaction } from "./transaction.js";

const RUNS = 500;
const SEED = 2026103104;
const OPTIONS = { seed: SEED, numRuns: RUNS } as const;
/** DEC-0777: the HMAC properties run 250 times, so that F4 stays within PAR-411 (1 s per target). */
const HMAC_RUNS = 250;
const HMAC_OPTIONS = { seed: SEED, numRuns: HMAC_RUNS } as const;

/** A generated dummy key (at least PAR-253 bytes), never a real credential. */
const KEY = `fuzz-session-key-${"k".repeat(32)}`;
const NOW = 1_800_000_000_000;

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

const text = fc.string({ unit: "binary", maxLength: 8 });
const sessionData: fc.Arbitrary<SessionData> = fc.oneof(
  fc.record({
    id: text.filter((s) => s !== ""),
    displayName: fc.option(text, { nil: null }),
    provider: fc.constantFrom("cf-account", "oidc"),
    subject: text.filter((s) => s !== ""),
    role: fc.record({ level: fc.constantFrom("user" as const, "admin" as const), checkedAt: fc.integer({ min: 0, max: NOW / 1000 }) }),
    // Session format 3: readSession returns the expiry, and issueSession keeps a given one.
    expiresAt: fc.integer({ min: NOW / 1000 + 1, max: NOW / 1000 + SESSION_LIFETIME_SECONDS }),
  }),
  fc.record({ id: text.filter((s) => s !== ""), displayName: fc.option(text, { nil: null }), mockLevel: fc.constantFrom("user" as const, "admin" as const) }),
);
const transactionData = fc.record({ state: text, returnTo: text });

describe("F4: signed browser tokens fuzz (auth.md §2 Session cookie, Login)", () => {
  it(`no mutation of a valid session token reads as a session, and a session token never verifies as login (${HMAC_RUNS} runs, seed ${SEED})`, async () => {
    await fc.assert(
      fc.asyncProperty(sessionData, mutation, async (data, m) => {
        const token = await issueSession(KEY, data, NOW);
        expect(await readSession(KEY, token, NOW)).toEqual(data);
        expect(await verifyToken(KEY, "login", token)).toBeUndefined();
        const mutated = mutate(token, m);
        if (mutated !== token) expect(await readSession(KEY, mutated, NOW)).toBeUndefined();
      }),
      HMAC_OPTIONS,
    );
  });

  it(`no mutation of a valid login token reads as a transaction, and a login token never reads as a session (${HMAC_RUNS} runs, seed ${SEED})`, async () => {
    await fc.assert(
      fc.asyncProperty(transactionData, mutation, async (tx, m) => {
        const token = await issueTransaction(KEY, tx, NOW);
        expect(await readTransaction(KEY, token, NOW)).toEqual(tx);
        expect(await readSession(KEY, token, NOW)).toBeUndefined();
        const mutated = mutate(token, m);
        if (mutated !== token) expect(await readTransaction(KEY, mutated, NOW)).toBeUndefined();
      }),
      HMAC_OPTIONS,
    );
  });

  it(`base64urlDecode returns a value only for the canonical spelling of it (${RUNS} runs, seed ${SEED})`, () => {
    const b64 = fc.string({ unit: fc.constantFrom(...B64URL), maxLength: 48 });
    fc.assert(
      fc.property(fc.oneof(b64, fc.string({ unit: "binary", maxLength: 16 })), (input) => {
        const bytes = base64urlDecode(input);
        if (bytes !== undefined) expect(base64urlEncode(bytes)).toBe(input);
      }),
      OPTIONS,
    );
  });

  it(`readCookie returns the value of the first pair named exactly the name, whatever the other pairs and whitespace (${RUNS} runs, seed ${SEED})`, () => {
    const NAME = "__Host-session";
    const ws = fc.string({ unit: fc.constantFrom(" ", "\t"), maxLength: 2 });
    const cookieName = fc.constantFrom(NAME, "__Host-login", `${NAME}x`, `x${NAME}`, NAME.toLowerCase(), "__Host-sessio", "a");
    const cookieValue = fc.string({ unit: fc.constantFrom(...B64URL, ".", "="), maxLength: 12 });
    const pair = fc.oneof(
      fc.record({ name: cookieName, value: cookieValue, ws: fc.tuple(ws, ws, ws, ws) }),
      fc.record({ garbage: fc.string({ unit: fc.constantFrom(...B64URL, " ", "."), maxLength: 8 }) }),
    );
    fc.assert(
      fc.property(fc.array(pair, { maxLength: 6 }), (pairs) => {
        const header = pairs.map((p) => ("garbage" in p ? p.garbage : `${p.ws[0]}${p.name}${p.ws[1]}=${p.ws[2]}${p.value}${p.ws[3]}`)).join(";");
        const first = pairs.find((p) => !("garbage" in p) && p.name === NAME);
        const expected = first === undefined || "garbage" in first || first.value === "" ? undefined : first.value;
        expect(readCookie(header, NAME)).toBe(expected);
      }),
      OPTIONS,
    );
  });
});
