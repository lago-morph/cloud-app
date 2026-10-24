import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { signToken } from "./signing.js";
import { SESSION_LIFETIME_SECONDS, issueSession, readSession } from "./session.js";

const KEY = "unit-test-key-0123456789abcdefghijklmnop";
const T0 = Date.parse("2026-03-01T12:00:00Z");

describe("session tokens", () => {
  it("PAR-250 is 7 days", () => {
    expect(SESSION_LIFETIME_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it(tag("AUTH-AC-006", "a session reads back its user ID and display name until it expires"), async () => {
    const token = await issueSession(KEY, { id: "u_ABC", displayName: "Ada" }, T0);
    expect(await readSession(KEY, token, T0)).toStrictEqual({ id: "u_ABC", displayName: "Ada" });
    expect(await readSession(KEY, token, T0 + (SESSION_LIFETIME_SECONDS - 60) * 1000)).toStrictEqual({ id: "u_ABC", displayName: "Ada" });
    expect(await readSession(KEY, token, T0 + SESSION_LIFETIME_SECONDS * 1000)).toBeUndefined();
  });

  it(tag("AUTH-AC-006", "a future-dated session is rejected beyond the PAR-252 skew"), async () => {
    const token = await issueSession(KEY, { id: "u_ABC", displayName: null }, T0 + 24 * 3600 * 1000);
    expect(await readSession(KEY, token, T0)).toBeUndefined();
    const slight = await issueSession(KEY, { id: "u_ABC", displayName: null }, T0 + 30 * 1000);
    expect(await readSession(KEY, slight, T0)).toStrictEqual({ id: "u_ABC", displayName: null });
  });

  it("a mock session carries its level; a real session carries none", async () => {
    const mock = await issueSession(KEY, { id: "x", displayName: null, mockLevel: "admin" }, T0);
    expect(await readSession(KEY, mock, T0)).toStrictEqual({ id: "x", displayName: null, mockLevel: "admin" });
  });

  it("well-signed payloads of another shape or version are rejected", async () => {
    const iat = Math.floor(T0 / 1000);
    const exp = iat + 100;
    for (const payload of [
      { v: 2, id: "x", name: null, iat, exp },
      { v: 1, id: "", name: null, iat, exp },
      { v: 1, id: 5, name: null, iat, exp },
      { v: 1, id: "x", name: 5, iat, exp },
      { v: 1, id: "x", name: null, iat: "a", exp },
      { v: 1, id: "x", name: null, iat, exp, lvl: "anonymous" },
      ["v", 1],
      null,
    ]) {
      expect(await readSession(KEY, await signToken(KEY, "session", payload), T0)).toBeUndefined();
    }
  });
});
