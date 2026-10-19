/**
 * Login flow with the stub login provider, locally.
 * AUTH-AC-008: callback URL built from the public origin despite forged Host / forwarding headers.
 * AUTH-AC-010: failed callbacks create no session, redirect to
 * `/?authError=login_failed&requestId=<id>`, and log one fixed reason; unsafe `returnTo` values
 * redirect to `/`. docs/components/auth.md AUTH-REQ-008, AUTH-REQ-010, §2 "Login", "Failed login".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { TestApp } from "../../../src/testing/index.js";
import {
  FIXED_REASONS,
  SESSION_COOKIE,
  cookieHeader,
  disposeAll,
  followCallback,
  locationOf,
  me,
  newApp,
  sessionCookieSet,
  setCookies,
  startStubLogin,
  stubLoginVia,
} from "./support.js";

afterEach(async () => {
  vi.useRealTimers();
  await disposeAll();
});

/** Asserts the failed-login redirect and returns the requestId it names. */
function expectFailedLoginRedirect(res: Response): string {
  expect(res.status).toBe(302);
  const location = locationOf(res);
  expect(location.pathname).toBe("/");
  expect([...location.searchParams.keys()].sort()).toStrictEqual(["authError", "requestId"]);
  expect(location.searchParams.get("authError")).toBe("login_failed");
  const requestId = location.searchParams.get("requestId") ?? "";
  expect(requestId).not.toBe("");
  // No session is created.
  expect(sessionCookieSet(res)).toBeUndefined();
  return requestId;
}

/** The fixed reasons named by the log entries of one request; exactly one reason is expected. */
function reasonsLogged(app: TestApp, requestId: string): RegExp[] {
  const entries = app.logs().filter((e) => e.requestId === requestId);
  const named = FIXED_REASONS.filter((reason) => entries.some((e) => reason.test(e.message)));
  return named;
}

/** Entries written since `from`, each naming its reasons. */
function newReasons(app: TestApp, from: number): RegExp[] {
  const entries = app.logs().slice(from);
  return FIXED_REASONS.filter((reason) => entries.some((e) => reason.test(e.message)));
}

function expectNoProtocolValuesLogged(app: TestApp, callback: URL): void {
  const secrets = [...callback.searchParams.values()].filter((v) => v.length >= 6);
  for (const entry of app.logs()) {
    for (const value of secrets) expect(entry.message).not.toContain(value);
  }
}

describe("AUTH callback URL", () => {
  it(tag("AUTH-AC-008", "the stub receives a callback URL built from the public origin despite forged Host and forwarding headers"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const plain = await startStubLogin(app, "/");
    const publicOrigin = plain.callback.origin;
    expect(plain.callback.pathname).toBe("/api/auth/callback");

    const forgedSets: Record<string, string>[] = [
      { host: "evil.example" },
      { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
      { host: "evil.example:8443", forwarded: "host=evil.example;proto=https", "x-forwarded-host": "evil.example" },
    ];
    for (const headers of forgedSets) {
      const forged = await startStubLogin(app, "/", headers);
      expect(forged.callback.origin).toBe(publicOrigin);
      expect(forged.callback.host).not.toContain("evil.example");
      expect(forged.callback.pathname).toBe("/api/auth/callback");
    }
  });
});

describe("AUTH failed login", () => {
  it(tag("AUTH-AC-010", "refused callback (stub failure 'refused'): no session, one fixed reason logged ('provider refused')"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const before = app.logs().length;
    await app.loginWithStub("ac010-refused", { stubFailure: "refused" }).then(
      () => undefined,
      () => undefined,
    );
    expect(await me(app)).toStrictEqual({ level: "anonymous" });
    expect((await app.request("/api/user-only")).status).toBe(401);
    const reasons = newReasons(app, before);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.source).toBe(FIXED_REASONS[2]?.source); // provider refused
  });

  it(tag("AUTH-AC-010", "replayed transaction (stub failure 'replayed'): no session, one fixed reason logged"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const before = app.logs().length;
    await app.loginWithStub("ac010-replayed", { stubFailure: "replayed" }).then(
      () => undefined,
      () => undefined,
    );
    expect(await me(app)).toStrictEqual({ level: "anonymous" });
    expect(newReasons(app, before)).toHaveLength(1);
  });

  it(tag("AUTH-AC-010", "missing transaction: no session, redirect to /?authError=login_failed&requestId=<id>, 'transaction missing or expired' logged"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const { callback } = await startStubLogin(app, "/notes");
    const res = await followCallback(app, callback);
    const requestId = expectFailedLoginRedirect(res);
    const reasons = reasonsLogged(app, requestId);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.source).toBe(FIXED_REASONS[0]?.source);
    expectNoProtocolValuesLogged(app, callback);
    expect(await me(app)).toStrictEqual({ level: "anonymous" });
  });

  it(tag("AUTH-AC-010", "invalid transaction (tampered cookie, or another login's transaction): no session, failed-login redirect, one fixed reason"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const { callback, transactionCookie } = await startStubLogin(app, "/notes");
    const v = transactionCookie.value;
    const mid = Math.floor(v.length / 2);
    const tampered = `${transactionCookie.name}=${v.slice(0, mid)}${v[mid] === "A" ? "B" : "A"}${v.slice(mid + 1)}`;
    const res = await followCallback(app, callback, tampered);
    const requestId = expectFailedLoginRedirect(res);
    expect(reasonsLogged(app, requestId)).toHaveLength(1);

    // A callback from one login with the transaction cookie of a later login.
    const first = await startStubLogin(app, "/a");
    const second = await startStubLogin(app, "/b");
    const crossed = await followCallback(app, first.callback, cookieHeader(second.transactionCookie));
    const crossedId = expectFailedLoginRedirect(crossed);
    expect(reasonsLogged(app, crossedId)).toHaveLength(1);
    expectNoProtocolValuesLogged(app, first.callback);
  });

  it(tag("AUTH-AC-010", "expired transaction (older than PAR-251): no session, failed-login redirect, 'transaction missing or expired' logged"), async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-04-01T09:00:00Z").getTime();
    vi.setSystemTime(start);
    const app = await newApp({ stubLoginProvider: true });
    const { callback, transactionCookie } = await startStubLogin(app, "/notes");
    vi.setSystemTime(start + 11 * 60 * 1000);
    const res = await followCallback(app, callback, cookieHeader(transactionCookie));
    const requestId = expectFailedLoginRedirect(res);
    const reasons = reasonsLogged(app, requestId);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.source).toBe(FIXED_REASONS[0]?.source);
  });

  it(tag("AUTH-AC-010", "a replayed callback after a completed login creates no new session"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const { callback, transactionCookie } = await startStubLogin(app, "/notes");
    const ok = await followCallback(app, callback, cookieHeader(transactionCookie));
    expect(ok.status).toBe(302);
    expect(sessionCookieSet(ok)).toBeDefined();
    // The callback cleared the transaction cookie; a browser replaying the callback URL has none.
    const cleared = setCookies(ok).find((c) => c.name === transactionCookie.name);
    expect(cleared).toBeDefined();
    const replay = await followCallback(app, callback);
    const requestId = expectFailedLoginRedirect(replay);
    expect(reasonsLogged(app, requestId)).toHaveLength(1);
  });
});

describe("AUTH returnTo sanitising", () => {
  it(tag("AUTH-AC-010", "a same-origin returnTo path is honoured after login (control case)"), async () => {
    const app = await newApp({ stubLoginProvider: true });
    const { redirect, session } = await stubLoginVia(app, "/notes/42?tab=files");
    const loc = locationOf(redirect);
    expect(`${loc.pathname}${loc.search}`).toBe("/notes/42?tab=files");
    expect(session?.name).toBe(SESSION_COOKIE);
  });

  for (const returnTo of ["//evil.example", "/\\evil.example", "https://evil.example", "/%2F%2Fevil.example", "javascript:"]) {
    it(tag("AUTH-AC-010", `returnTo ${JSON.stringify(returnTo)} redirects to / after login`), async () => {
      const app = await newApp({ stubLoginProvider: true });
      const { redirect, session } = await stubLoginVia(app, returnTo);
      const raw = redirect.headers.get("location") ?? "";
      expect(raw === "/" || /^https?:\/\/[^/]+\/$/.test(raw)).toBe(true);
      expect(raw).not.toContain("evil.example");
      const loc = locationOf(redirect);
      expect(loc.pathname).toBe("/");
      expect(loc.search).toBe("");
      // The login itself succeeded.
      expect(session).toBeDefined();
    });
  }
});
