import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { issueSession } from "./session.js";
import { LOGIN_LIFETIME_SECONDS, issueTransaction, readTransaction } from "./transaction.js";

const KEY = "unit-test-key-0123456789abcdefghijklmnop";
const T0 = Date.parse("2026-04-01T09:00:00Z");

describe("login transaction tokens", () => {
  it("PAR-251 is 10 minutes", () => {
    expect(LOGIN_LIFETIME_SECONDS).toBe(600);
  });

  it(tag("AUTH-AC-010", "a transaction reads back its state and returnTo until PAR-251 passes"), async () => {
    const token = await issueTransaction(KEY, { state: "s-1", returnTo: "/notes" }, T0);
    expect(await readTransaction(KEY, token, T0 + 9 * 60 * 1000)).toStrictEqual({ state: "s-1", returnTo: "/notes" });
    expect(await readTransaction(KEY, token, T0 + 11 * 60 * 1000)).toBeUndefined();
  });

  it(tag("AUTH-AC-010", "a session token is not a transaction"), async () => {
    const session = await issueSession(KEY, { id: "u_X", displayName: null, provider: "stub", subject: "s" }, T0);
    expect(await readTransaction(KEY, session, T0)).toBeUndefined();
  });
});
