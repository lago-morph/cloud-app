/**
 * AUTH-AC-006, local: session and transaction cookie attributes, tampered / expired /
 * future-dated session cookies, and logout. docs/components/auth.md AUTH-REQ-006 and §2
 * ("Session cookie", "Login"); PAR-250 (7 days), PAR-251 (10 minutes).
 *
 * Time: `createTestApp` runs in the runner's process, so the runner's fake timers govern
 * session expiry (core.md §2 "Testing"). Only `Date` is faked so local storage I/O keeps working.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import {
  SESSION_COOKIE,
  clearsCookie,
  cookieHeader,
  disposeAll,
  me,
  mockLogin,
  newApp,
  setCookies,
  startStubLogin,
  type SetCookie,
} from "./support.js";

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // PAR-250
const MINUTE = 60 * 1000;

afterEach(async () => {
  vi.useRealTimers();
  await disposeAll();
});

function lifetimeMs(cookie: SetCookie, issuedAt: number): number | undefined {
  const maxAge = cookie.attributes.get("max-age");
  if (maxAge !== undefined) return Number(maxAge) * 1000;
  const expires = cookie.attributes.get("expires");
  if (expires !== undefined) return Date.parse(expires) - issuedAt;
  return undefined;
}

function tamper(value: string, at: number): string {
  const i = ((at % value.length) + value.length) % value.length;
  const c = value[i] === "A" ? "B" : "A";
  return value.slice(0, i) + c + value.slice(i + 1);
}

describe("AUTH sessions (local)", () => {
  it(tag("AUTH-AC-006", "session cookie: session_local, HttpOnly, SameSite=Lax, not Secure locally, lasting PAR-250"), async () => {
    const app = await newApp();
    const issuedAt = Date.now();
    const cookie = await mockLogin(app, { level: "user", id: "ac006-attrs" });
    expect(cookie.name).toBe(SESSION_COOKIE);
    expect(cookie.attributes.has("httponly")).toBe(true);
    expect(cookie.attributes.get("samesite")?.toLowerCase()).toBe("lax");
    expect(cookie.attributes.has("secure")).toBe(false);
    const lifetime = lifetimeMs(cookie, issuedAt);
    expect(lifetime).toBeDefined();
    expect(Math.abs((lifetime ?? 0) - SESSION_LIFETIME_MS)).toBeLessThanOrEqual(2 * MINUTE);
    expect(await me(app, cookieHeader(cookie))).toMatchObject({ level: "user", id: "ac006-attrs" });
  });

  it(tag("AUTH-AC-006", "transaction cookie: HttpOnly, SameSite=Lax, not Secure locally"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const { transactionCookie } = await startStubLogin(app, "/");
    expect(transactionCookie.attributes.has("httponly")).toBe(true);
    expect(transactionCookie.attributes.get("samesite")?.toLowerCase()).toBe("lax");
    expect(transactionCookie.attributes.has("secure")).toBe(false);
  });

  it(tag("AUTH-AC-006", "a session from the stub provider's login has the same session cookie attributes"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const { callback, transactionCookie } = await startStubLogin(app, "/");
    const res = await app.request(`${callback.pathname}${callback.search}`, { headers: { cookie: cookieHeader(transactionCookie) } });
    expect(res.status).toBe(302);
    const session = setCookies(res).find((c) => c.name === SESSION_COOKIE && !clearsCookie(c));
    expect(session).toBeDefined();
    expect(session?.attributes.has("httponly")).toBe(true);
    expect(session?.attributes.get("samesite")?.toLowerCase()).toBe("lax");
    expect(session?.attributes.has("secure")).toBe(false);
    // The transaction cookie is cleared by the callback.
    const clearedTx = setCookies(res).find((c) => c.name === transactionCookie.name);
    expect(clearedTx !== undefined && (clearedTx.value === "" || clearsCookie(clearedTx))).toBe(true);
  });

  it(tag("AUTH-AC-006", "a tampered session cookie is treated as anonymous"), async () => {
    const app = await newApp();
    const cookie = await mockLogin(app, { level: "admin", id: "ac006-tamper", displayName: "T" });
    expect((await me(app, cookieHeader(cookie)))["level"]).toBe("admin");
    // Not the last character: its low bits may be base64 padding that decodes identically.
    for (const at of [-2, -5, Math.floor(cookie.value.length / 2), 0]) {
      const forged = `${SESSION_COOKIE}=${tamper(cookie.value, at)}`;
      expect(await me(app, forged)).toStrictEqual({ level: "anonymous" });
      expect((await app.request("/api/user-only", { headers: { cookie: forged } })).status).toBe(401);
    }
    expect(await me(app, `${SESSION_COOKIE}=not-a-session`)).toStrictEqual({ level: "anonymous" });
  });

  it(tag("AUTH-AC-006", "locally, an expired session cookie is anonymous; within PAR-250 it is still valid"), async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-03-01T12:00:00Z").getTime();
    vi.setSystemTime(start);
    const app = await newApp();
    const cookie = await mockLogin(app, { level: "user", id: "ac006-expiry" });

    vi.setSystemTime(start + SESSION_LIFETIME_MS - 5 * MINUTE);
    expect((await me(app, cookieHeader(cookie)))["level"]).toBe("user");

    vi.setSystemTime(start + SESSION_LIFETIME_MS + 5 * MINUTE);
    expect(await me(app, cookieHeader(cookie))).toStrictEqual({ level: "anonymous" });
  });

  it(tag("AUTH-AC-006", "locally, a future-dated session cookie is anonymous"), async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-03-01T12:00:00Z").getTime();
    // Issue the session one day in the future, then return to the present.
    vi.setSystemTime(now + 24 * 60 * MINUTE);
    const app = await newApp();
    const cookie = await mockLogin(app, { level: "user", id: "ac006-future" });
    vi.setSystemTime(now);
    expect(await me(app, cookieHeader(cookie))).toStrictEqual({ level: "anonymous" });
  });

  it(tag("AUTH-AC-006", "logout clears the session cookie"), async () => {
    const app = await newApp();
    const cookie = await mockLogin(app, { level: "user", id: "ac006-logout" });
    const res = await app.request("/api/auth/logout", { method: "POST", headers: { cookie: cookieHeader(cookie) } });
    expect(res.status).toBe(204);
    const cleared = setCookies(res).find((c) => c.name === SESSION_COOKIE);
    expect(cleared).toBeDefined();
    expect(cleared !== undefined && (cleared.value === "" || clearsCookie(cleared))).toBe(true);
  });
});
