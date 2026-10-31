import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { signToken, verifyToken } from "./signing.js";
import { SESSION_FORMAT_VERSION, SESSION_LIFETIME_SECONDS, issueSession, readSession } from "./session.js";

const KEY = "unit-test-key-0123456789abcdefghijklmnop";
const T0 = Date.parse("2026-03-01T12:00:00Z");
const REAL = { id: "u_ABC", displayName: "Ada", provider: "stub", subject: "s-user-1", role: { level: "user", checkedAt: T0 / 1000 } } as const;
const EXP = T0 / 1000 + SESSION_LIFETIME_SECONDS;

describe("session tokens", () => {
  it("PAR-250 is 7 days; the format is version 3 (DEC-0672)", () => {
    expect(SESSION_LIFETIME_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(SESSION_FORMAT_VERSION).toBe(3);
  });

  it(tag("AUTH-AC-006", "a real-provider session reads back its user ID, display name, provider and subject until it expires"), async () => {
    const token = await issueSession(KEY, REAL, T0);
    expect(await readSession(KEY, token, T0)).toStrictEqual({ ...REAL, expiresAt: EXP });
    expect(await readSession(KEY, token, T0 + (SESSION_LIFETIME_SECONDS - 60) * 1000)).toStrictEqual({ ...REAL, expiresAt: EXP });
    expect(await readSession(KEY, token, T0 + SESSION_LIFETIME_SECONDS * 1000)).toBeUndefined();
  });

  it("version 3 carries the provider id, the subject and the confirmed level of a real session", async () => {
    const payload = await verifyToken(KEY, "session", await issueSession(KEY, REAL, T0));
    expect(payload).toStrictEqual({ v: 3, id: "u_ABC", name: "Ada", iat: T0 / 1000, exp: EXP, prv: "stub", sub: "s-user-1", rol: "user", rat: T0 / 1000 });
  });

  it(tag("AUTH-AC-006", "a future-dated session is rejected beyond the PAR-252 skew"), async () => {
    const token = await issueSession(KEY, { ...REAL, displayName: null }, T0 + 24 * 3600 * 1000);
    expect(await readSession(KEY, token, T0)).toBeUndefined();
    const slight = await issueSession(KEY, { ...REAL, displayName: null }, T0 + 30 * 1000);
    expect(await readSession(KEY, slight, T0)).toStrictEqual({ ...REAL, displayName: null, expiresAt: (T0 + 30 * 1000) / 1000 + SESSION_LIFETIME_SECONDS });
  });

  it("a mock session carries its level and no provider or subject", async () => {
    const mock = await issueSession(KEY, { id: "x", displayName: null, mockLevel: "admin" }, T0);
    expect(await readSession(KEY, mock, T0)).toStrictEqual({ id: "x", displayName: null, mockLevel: "admin" });
    expect(await verifyToken(KEY, "session", mock)).not.toHaveProperty("sub");
  });

  describe("a session with a confirmed role (plan §4.1 step 5)", () => {
    const CF = { id: "u_CF", displayName: null, provider: "cf-account", subject: "cf-sub" } as const;
    const iat = T0 / 1000;

    it("carries the level and when it was confirmed, and reads back with its expiry", async () => {
      const token = await issueSession(KEY, { ...CF, role: { level: "admin", checkedAt: iat } }, T0);
      expect(await verifyToken(KEY, "session", token)).toStrictEqual({ v: 3, id: "u_CF", name: null, iat, exp: iat + SESSION_LIFETIME_SECONDS, prv: "cf-account", sub: "cf-sub", rol: "admin", rat: iat });
      expect(await readSession(KEY, token, T0)).toStrictEqual({ ...CF, role: { level: "admin", checkedAt: iat }, expiresAt: iat + SESSION_LIFETIME_SECONDS });
    });

    it("re-issued with its expiry, it keeps that expiry instead of starting a new lifetime", async () => {
      const exp = iat + 3600;
      const later = T0 + 600_000;
      const token = await issueSession(KEY, { ...CF, role: { level: "user", checkedAt: later / 1000 }, expiresAt: exp }, later);
      expect(await verifyToken(KEY, "session", token)).toMatchObject({ iat: later / 1000, exp, rol: "user", rat: later / 1000 });
      expect(await readSession(KEY, token, exp * 1000)).toBeUndefined();
    });

    it("a malformed role, or a role on a mock session, is no session", async () => {
      const exp = iat + 100;
      const real = { v: 3, id: "x", name: null, iat, exp, prv: "p", sub: "s" };
      for (const payload of [
        // Version 3 requires the level (DEC-0672).
        real,
        { ...real, rol: "admin" },
        { ...real, rat: iat },
        { ...real, rol: "owner", rat: iat },
        { ...real, rol: "admin", rat: "now" },
        { v: 3, id: "x", name: null, iat, exp, lvl: "user", rol: "user", rat: iat },
      ]) {
        expect(await readSession(KEY, await signToken(KEY, "session", payload), T0), JSON.stringify(payload)).toBeUndefined();
      }
    });
  });

  it(tag("AUTH-AC-012", "a version 1 cookie, and well-signed payloads of another shape, are no session"), async () => {
    const iat = Math.floor(T0 / 1000);
    const exp = iat + 100;
    for (const payload of [
      // Version 1, as issued before DEC-0524 (real and mock).
      { v: 1, id: "x", name: null, iat, exp },
      { v: 1, id: "x", name: null, iat, exp, lvl: "admin" },
      { v: 3, id: "x", name: null, iat, exp, prv: "p", sub: "s" },
      // Version 2 (before v0.2.0), real and mock: no session (DEC-0672).
      { v: 2, id: "x", name: null, iat, exp, prv: "p", sub: "s" },
      { v: 2, id: "x", name: null, iat, exp, lvl: "user" },
      // Version 2 without provider and subject, or with only one, or with both kinds.
      { v: 2, id: "x", name: null, iat, exp },
      { v: 2, id: "x", name: null, iat, exp, prv: "p" },
      { v: 2, id: "x", name: null, iat, exp, sub: "s" },
      { v: 2, id: "x", name: null, iat, exp, prv: "", sub: "s" },
      { v: 2, id: "x", name: null, iat, exp, prv: "p", sub: 5 },
      { v: 2, id: "x", name: null, iat, exp, prv: "p", sub: "s", lvl: "admin" },
      { v: 2, id: "", name: null, iat, exp, prv: "p", sub: "s" },
      { v: 2, id: 5, name: null, iat, exp, prv: "p", sub: "s" },
      { v: 2, id: "x", name: 5, iat, exp, prv: "p", sub: "s" },
      { v: 2, id: "x", name: null, iat: "a", exp, prv: "p", sub: "s" },
      { v: 2, id: "x", name: null, iat, exp, lvl: "anonymous" },
      ["v", 2],
      null,
    ]) {
      expect(await readSession(KEY, await signToken(KEY, "session", payload), T0), JSON.stringify(payload)).toBeUndefined();
    }
  });
});
