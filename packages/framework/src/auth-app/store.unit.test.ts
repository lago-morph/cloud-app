/**
 * The auth app's D1 store against a real local D1 (plan §3: `users`, `codes`, registry, sign-in
 * state; §4.1 step 3.5 and 3.7; §7 "code lifecycle", "exact-match registry, open redirect refused",
 * "concurrent redemption exactly-one").
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTH_APP_CODE_LIFETIME_MS } from "../auth/auth-app-binding.js";
import { localD1, type LocalD1 } from "./d1.test-support.js";
import { SIGN_IN_TRANSACTION_MS } from "./params.js";
import { createCode, ensureSchema, getRole, isRegistered, parseCode, redeemCode, registerReturnUrl, saveSignIn, takeSignIn, unregisterApp, upsertUser, validReturnUrl } from "./store.js";

const APP = "notes-prod";
const RETURN = "https://notes-prod.acct.workers.dev/api/auth/callback";
const T0 = 1_800_000_000_000;

let d1: LocalD1;
beforeAll(async () => {
  d1 = await localD1();
  await ensureSchema(d1.db);
  await ensureSchema(d1.db); // idempotent
}, 60_000);
afterAll(async () => {
  await d1.dispose();
});
beforeEach(async () => {
  await d1.db.batch(["users", "codes", "registry", "sign_ins"].map((t) => d1.db.prepare(`DELETE FROM ${t}`)));
  await registerReturnUrl(d1.db, APP, RETURN);
  await upsertUser(d1.db, { sub: "sub-a", email: "a@example.com", role: "user" }, T0);
});

describe("users", () => {
  it("upserts: a second sign-in replaces email and role", async () => {
    await expect(getRole(d1.db, "sub-a")).resolves.toBe("user");
    await upsertUser(d1.db, { sub: "sub-a", email: "new@example.com", role: "admin" }, T0 + 1);
    await expect(getRole(d1.db, "sub-a")).resolves.toBe("admin");
    const code = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0);
    await expect(redeemCode(d1.db, { code, app: APP }, T0)).resolves.toEqual({ sub: "sub-a", email: "new@example.com", role: "admin" });
  });

  it("answers null for an unknown subject", async () => {
    await expect(getRole(d1.db, "nobody")).resolves.toBeNull();
  });
});

describe("codes (PAR-414)", () => {
  it("is 43 base64url characters and stored only as its hash", async () => {
    const code = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await d1.db.prepare("SELECT * FROM codes").all<Record<string, unknown>>();
    expect(JSON.stringify(rows.results)).not.toContain(code);
    expect(rows.results[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("redeems once; the second redeem is null", async () => {
    const code = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0);
    await expect(redeemCode(d1.db, { code, app: APP }, T0 + 1)).resolves.toEqual({ sub: "sub-a", email: "a@example.com", role: "user" });
    await expect(redeemCode(d1.db, { code, app: APP }, T0 + 2)).resolves.toBeNull();
  });

  it("is accepted at exactly the lifetime and refused 1 ms later", async () => {
    const a = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0);
    const b = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0);
    await expect(redeemCode(d1.db, { code: a, app: APP }, T0 + AUTH_APP_CODE_LIFETIME_MS)).resolves.not.toBeNull();
    await expect(redeemCode(d1.db, { code: b, app: APP }, T0 + AUTH_APP_CODE_LIFETIME_MS + 1)).resolves.toBeNull();
  });

  it("is bound to the app: another app gets null and does not use it up", async () => {
    await registerReturnUrl(d1.db, "other", "https://other.acct.workers.dev/api/auth/callback");
    const code = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0);
    await expect(redeemCode(d1.db, { code, app: "other" }, T0)).resolves.toBeNull();
    await expect(redeemCode(d1.db, { code, app: APP }, T0)).resolves.not.toBeNull();
  });

  it("is bound to the return URL: once it is no longer registered, the code is refused", async () => {
    const code = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0);
    await unregisterApp(d1.db, APP);
    await expect(redeemCode(d1.db, { code, app: APP }, T0)).resolves.toBeNull();
  });

  it("refuses malformed codes without a query", async () => {
    for (const bad of ["", "short", "x".repeat(44), `${"a".repeat(42)}=`, `${"a".repeat(42)}/`, `${"a".repeat(42)}é`]) {
      expect(parseCode(bad), bad).toBeNull();
      await expect(redeemCode(d1.db, { code: bad, app: APP }, T0)).resolves.toBeNull();
    }
    expect(parseCode("A".repeat(43))).toBe("A".repeat(43));
  });

  it("lets exactly one of concurrent redemptions succeed", async () => {
    const code = await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0);
    const results = await Promise.all(Array.from({ length: 10 }, () => redeemCode(d1.db, { code, app: APP }, T0)));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("refuses a code whose user record is gone", async () => {
    const code = await createCode(d1.db, { sub: "sub-gone", app: APP, returnUrl: RETURN }, T0);
    await expect(redeemCode(d1.db, { code, app: APP }, T0)).resolves.toBeNull();
  });

  it("drops expired codes when a new one is made", async () => {
    await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0);
    await createCode(d1.db, { sub: "sub-a", app: APP, returnUrl: RETURN }, T0 + AUTH_APP_CODE_LIFETIME_MS + 1);
    const n = await d1.db.prepare("SELECT COUNT(*) AS n FROM codes").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});

describe("registry: exact match only", () => {
  it("accepts the registered URL for its app", async () => {
    await expect(isRegistered(d1.db, APP, RETURN)).resolves.toBe(true);
  });

  it("refuses the registered URL for another app", async () => {
    await expect(isRegistered(d1.db, "other", RETURN)).resolves.toBe(false);
  });

  it("refuses every near miss (open redirect attempts)", async () => {
    const near = [
      `${RETURN}/`,
      RETURN.replace("/callback", "/Callback"),
      RETURN.replace("notes-prod", "NOTES-PROD"),
      RETURN.replace("https://", "HTTPS://"),
      RETURN.replace(".dev/", ".dev:443/"),
      RETURN.replace(".dev/", ".dev:8443/"),
      RETURN.replace("/api/", "/%61pi/"),
      RETURN.replace("/callback", "%2Fcallback"),
      `${RETURN}?next=https://evil.example`,
      `${RETURN}#x`,
      RETURN.replace("https://", "http://"),
      RETURN.replace("https://", "https://evil@"),
      RETURN.replace(".dev/", ".dev.evil.example/"),
      RETURN.replace("/api/auth/callback", "/api/auth/callback/../../evil"),
      ` ${RETURN}`,
      `${RETURN} `,
      RETURN.slice(0, -1),
      "",
    ];
    for (const url of near) await expect(isRegistered(d1.db, APP, url), url).resolves.toBe(false);
  });

  it("clears an app's URLs on remove, and only that app's", async () => {
    await registerReturnUrl(d1.db, "other", "https://other.acct.workers.dev/api/auth/callback");
    await unregisterApp(d1.db, APP);
    await expect(isRegistered(d1.db, APP, RETURN)).resolves.toBe(false);
    await expect(isRegistered(d1.db, "other", "https://other.acct.workers.dev/api/auth/callback")).resolves.toBe(true);
  });

  it("registering twice is harmless", async () => {
    await registerReturnUrl(d1.db, APP, RETURN);
    await expect(isRegistered(d1.db, APP, RETURN)).resolves.toBe(true);
  });

  it("accepts only canonical https URLs (or http on localhost) without credentials or fragment", () => {
    expect(validReturnUrl(RETURN)).toBe(true);
    expect(validReturnUrl("http://localhost:8787/api/auth/callback")).toBe(true);
    expect(validReturnUrl("http://127.0.0.1:8787/api/auth/callback")).toBe(true);
    for (const bad of ["http://notes.example/cb", "https://Notes.example/cb", "https://notes.example:443/cb", "https://u:p@notes.example/cb", "https://notes.example/cb#f", "https://notes.example/a/../cb", "javascript:alert(1)", "/relative", "", "notaurl"]) {
      expect(validReturnUrl(bad), bad).toBe(false);
    }
  });

  it("refuses to register a non-canonical URL", async () => {
    await expect(registerReturnUrl(d1.db, APP, "https://Notes.example/cb")).rejects.toThrow(/not a valid return URL/);
  });
});

describe("sign-in state (PAR-416)", () => {
  const signIn = { verifier: "v", nonce: "n", app: APP, returnUrl: RETURN, appState: "s-app" };

  it("is taken once", async () => {
    await saveSignIn(d1.db, "state-1", signIn, T0);
    await expect(takeSignIn(d1.db, "state-1", T0 + 1)).resolves.toEqual(signIn);
    await expect(takeSignIn(d1.db, "state-1", T0 + 2)).resolves.toBeNull();
  });

  it("expires after PAR-416 (accepted at the limit, refused 1 ms past it)", async () => {
    await saveSignIn(d1.db, "s-a", signIn, T0);
    await saveSignIn(d1.db, "s-b", signIn, T0);
    await expect(takeSignIn(d1.db, "s-a", T0 + SIGN_IN_TRANSACTION_MS)).resolves.not.toBeNull();
    await expect(takeSignIn(d1.db, "s-b", T0 + SIGN_IN_TRANSACTION_MS + 1)).resolves.toBeNull();
  });

  it("stores the state only as its hash", async () => {
    await saveSignIn(d1.db, "state-secret", signIn, T0);
    const rows = await d1.db.prepare("SELECT state_hash FROM sign_ins").all<{ state_hash: string }>();
    expect(rows.results[0]!.state_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers null for an unknown state", async () => {
    await expect(takeSignIn(d1.db, "nope", T0)).resolves.toBeNull();
  });
});
