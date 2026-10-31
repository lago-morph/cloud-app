/**
 * Unit tests for the in-memory fake of the auth-app service binding (src/auth/auth-app-binding.ts;
 * contract docs/contracts/ts/internal/auth-app.d.ts; plan-v0.2.0 §4.1 step 4–5, §7). The fake must
 * behave like the real auth app at the binding: one-time codes bound to an app, 60 s lifetime,
 * single use, and failures that throw (so the app's role refresh can retry, §4.1 step 5).
 */
import { describe, expect, it } from "vitest";
import { AUTH_APP_CODE_LIFETIME_MS, createFakeAuthAppBinding, type AuthAppIdentity } from "../auth/auth-app-binding.js";

const alice: AuthAppIdentity = { sub: "sub-alice", email: "alice@example.com", role: "user" };

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe("fake auth-app binding: redeem", () => {
  it("returns the identity for a code issued to the same app", async () => {
    const fake = createFakeAuthAppBinding();
    const code = fake.issueCode(alice, { app: "notes-prod" });
    await expect(fake.redeem({ code, app: "notes-prod" })).resolves.toEqual(alice);
  });

  it("is single use: a second redeem of the same code returns null", async () => {
    const fake = createFakeAuthAppBinding();
    const code = fake.issueCode(alice, { app: "notes-prod" });
    await fake.redeem({ code, app: "notes-prod" });
    await expect(fake.redeem({ code, app: "notes-prod" })).resolves.toBeNull();
  });

  it("is bound to the app: another app gets null and the code is not used up", async () => {
    const fake = createFakeAuthAppBinding();
    const code = fake.issueCode(alice, { app: "notes-prod" });
    await expect(fake.redeem({ code, app: "other-app" })).resolves.toBeNull();
    await expect(fake.redeem({ code, app: "notes-prod" })).resolves.toEqual(alice);
  });

  it("accepts a code at exactly the lifetime and refuses it 1 ms later", async () => {
    const c = clock();
    const fake = createFakeAuthAppBinding({ now: c.now });
    const atLimit = fake.issueCode(alice, { app: "a" });
    const pastLimit = fake.issueCode(alice, { app: "a" });
    c.advance(AUTH_APP_CODE_LIFETIME_MS);
    await expect(fake.redeem({ code: atLimit, app: "a" })).resolves.toEqual(alice);
    c.advance(1);
    await expect(fake.redeem({ code: pastLimit, app: "a" })).resolves.toBeNull();
  });

  it("returns null for an unknown or empty code", async () => {
    const fake = createFakeAuthAppBinding();
    await expect(fake.redeem({ code: "nope", app: "a" })).resolves.toBeNull();
    await expect(fake.redeem({ code: "", app: "a" })).resolves.toBeNull();
  });

  it("issues a different code each time", () => {
    const fake = createFakeAuthAppBinding();
    expect(fake.issueCode(alice, { app: "a" })).not.toBe(fake.issueCode(alice, { app: "a" }));
  });

  it("lets exactly one of several concurrent redemptions of one code succeed, wrong-app ones racing too", async () => {
    const fake = createFakeAuthAppBinding();
    const code = fake.issueCode(alice, { app: "a" });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => fake.redeem({ code, app: i % 2 === 0 ? "a" : "b" })));
    expect(results.filter((r) => r !== null)).toEqual([alice]);
  });

  it("issues codes in the real format: 43 base64url characters", () => {
    const fake = createFakeAuthAppBinding();
    expect(fake.issueCode(alice, { app: "a" })).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("refuses app IDs that only resemble the issuing one, without using the code up", async () => {
    const fake = createFakeAuthAppBinding();
    const code = fake.issueCode(alice, { app: "notes-prod" });
    for (const app of ["notes", "notes-prod ", "Notes-prod", "notes-prоd" /* Cyrillic о */, "notes-prod́", ""]) {
      await expect(fake.redeem({ code, app }), app).resolves.toBeNull();
    }
    await expect(fake.redeem({ code, app: "notes-prod" })).resolves.toEqual(alice);
  });

  it("refuses an expired code even with the right app", async () => {
    const c = clock();
    const fake = createFakeAuthAppBinding({ now: c.now });
    const code = fake.issueCode(alice, { app: "a" });
    c.advance(AUTH_APP_CODE_LIFETIME_MS + 1);
    await expect(fake.redeem({ code, app: "a" })).resolves.toBeNull();
  });

  it("is bound to the return URL: after unregisterApp the code is refused", async () => {
    const fake = createFakeAuthAppBinding();
    const code = fake.issueCode(alice, { app: "a", returnUrl: "https://a.example/api/auth/callback" });
    const other = fake.issueCode(alice, { app: "b" });
    fake.unregisterApp("a");
    await expect(fake.redeem({ code, app: "a" })).resolves.toBeNull();
    await expect(fake.redeem({ code: other, app: "b" })).resolves.toEqual(alice);
  });

  it("returns the user as stored at redeem time: a later role change shows, a removed user is null", async () => {
    const fake = createFakeAuthAppBinding();
    const changed = fake.issueCode(alice, { app: "a" });
    fake.setRole("sub-alice", "admin");
    await expect(fake.redeem({ code: changed, app: "a" })).resolves.toEqual({ ...alice, role: "admin" });
    const removed = fake.issueCode(alice, { app: "a" });
    fake.setRole("sub-alice", null);
    await expect(fake.redeem({ code: removed, app: "a" })).resolves.toBeNull();
  });
});

describe("fake auth-app binding: role", () => {
  it("answers the role recorded at the last sign-in, and null for an unknown subject", async () => {
    const fake = createFakeAuthAppBinding();
    fake.issueCode({ ...alice, role: "admin" }, { app: "a" });
    await expect(fake.role("sub-alice")).resolves.toBe("admin");
    await expect(fake.role("sub-nobody")).resolves.toBeNull();
  });

  it("setRole changes the answer, and null removes the user", async () => {
    const fake = createFakeAuthAppBinding();
    fake.setRole("sub-bob", "user");
    await expect(fake.role("sub-bob")).resolves.toBe("user");
    fake.setRole("sub-bob", "admin");
    await expect(fake.role("sub-bob")).resolves.toBe("admin");
    fake.setRole("sub-bob", null);
    await expect(fake.role("sub-bob")).resolves.toBeNull();
  });
});

describe("fake auth-app binding: failures and call counts", () => {
  it("failNext(n) makes the next n calls throw, then answers again", async () => {
    const fake = createFakeAuthAppBinding();
    fake.setRole("sub-bob", "user");
    fake.failNext(2);
    await expect(fake.role("sub-bob")).rejects.toThrow(/auth app unavailable/);
    await expect(fake.redeem({ code: "x", app: "a" })).rejects.toThrow(/auth app unavailable/);
    await expect(fake.role("sub-bob")).resolves.toBe("user");
  });

  it("failNext replaces the pending count rather than adding to it", async () => {
    const fake = createFakeAuthAppBinding();
    fake.failNext(2);
    fake.failNext(1);
    await expect(fake.role("s")).rejects.toThrow();
    await expect(fake.role("s")).resolves.toBeNull();
  });

  it("a failed redeem does not use the code up", async () => {
    const fake = createFakeAuthAppBinding();
    const code = fake.issueCode(alice, { app: "a" });
    fake.failNext(1);
    await expect(fake.redeem({ code, app: "a" })).rejects.toThrow();
    await expect(fake.redeem({ code, app: "a" })).resolves.toEqual(alice);
  });

  it("setUnavailable keeps every call failing until cleared", async () => {
    const fake = createFakeAuthAppBinding();
    fake.setRole("sub-bob", "user");
    fake.setUnavailable(true);
    await expect(fake.role("sub-bob")).rejects.toThrow();
    await expect(fake.role("sub-bob")).rejects.toThrow();
    fake.setUnavailable(false);
    await expect(fake.role("sub-bob")).resolves.toBe("user");
  });

  it("counts calls, including failed ones", async () => {
    const fake = createFakeAuthAppBinding();
    fake.failNext(1);
    await fake.role("s").catch(() => undefined);
    await fake.role("s");
    await fake.redeem({ code: "c", app: "a" });
    expect(fake.calls).toEqual({ redeem: 1, role: 2 });
  });

  it("returns frozen copies, so a caller cannot change the stored identity", async () => {
    const fake = createFakeAuthAppBinding();
    const code = fake.issueCode(alice, { app: "a" });
    const got = await fake.redeem({ code, app: "a" });
    expect(Object.isFrozen(got)).toBe(true);
  });
});
