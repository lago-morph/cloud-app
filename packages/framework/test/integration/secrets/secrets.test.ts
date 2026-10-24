/**
 * SEC criteria in-process through `createTestApp` (testing.d.ts): reading declared secrets
 * (SEC-AC-001) and the local scan of stored log entries and error responses for secret values,
 * session cookies, ticket URLs and stub authorization codes (SEC-AC-002, in-process part).
 * Criteria: docs/components/secrets.md §4.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { TestApp } from "../../../src/testing/index.js";
import { cookiePair, errorBody, errorResponseViolations, uniqueValue } from "../core/harness/harness.js";
import { createRefApp } from "../core/harness/reference-app.js";

let apps: TestApp[] = [];
afterEach(async () => {
  for (const a of apps) await a.dispose();
  apps = [];
});

describe("SEC-AC-001 in-process", () => {
  it(tag("SEC-AC-001", "a declared secret with a value is returned"), async () => {
    const value = uniqueValue("bt1val");
    const app = await createRefApp({ secrets: { apiKey: value } });
    apps.push(app);
    const res = await app.request("/api/secret/apiKey");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value });
  });

  it(tag("SEC-AC-001", "an undeclared name fails with SEC.UNDECLARED"), async () => {
    const app = await createRefApp({ secrets: { apiKey: "x-value-1" } });
    apps.push(app);
    for (const name of ["notDeclared", "frameworkSessionKey", "SECRET_API_KEY"]) {
      const res = await app.request(`/api/secret/${name}`);
      expect(res.status, name).toBe(500);
      const body = await errorBody(res);
      expect(errorResponseViolations(body), name).toEqual([]);
      expect(body.error.code, name).toBe("SEC.UNDECLARED");
    }
  });

  it(tag("SEC-AC-001", "a declared name without a value fails with SEC.MISSING"), async () => {
    const app = await createRefApp({ secrets: { apiKey: "x-value-2" } });
    apps.push(app);
    const res = await app.request("/api/secret/unsetSecret");
    expect(res.status).toBe(500);
    const body = await errorBody(res);
    expect(errorResponseViolations(body)).toEqual([]);
    expect(body.error.code).toBe("SEC.MISSING");
  });
});

/** Every string inside a JSON value. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** A tiny cookie jar for following redirects with TestApp.request. */
class Jar {
  private readonly cookies = new Map<string, string>();
  readonly values: string[] = [];
  take(res: Response): void {
    const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
    for (const header of all.filter((h) => h !== "")) {
      const pair = cookiePair(header);
      const eq = pair.indexOf("=");
      const value = pair.slice(eq + 1);
      this.cookies.set(pair.slice(0, eq), value);
      if (value.length >= 8) this.values.push(value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

describe("SEC-AC-002 in-process scan", () => {
  it(tag("SEC-AC-002", "local in-process: log entries and error responses contain no test secret value, session cookie value or issued ticket URL"), async () => {
    const secret = uniqueValue("bt1scan");
    const app = await createRefApp({ secrets: { apiKey: secret } });
    apps.push(app);
    const errorResponses: string[] = [];

    for (const path of ["/api/throw/secret-in-plain-error", "/api/throw/secret-in-framework-error", "/api/secret/notDeclared", "/api/secret/unsetSecret"]) {
      const res = await app.request(path);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      errorResponses.push(`${[...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${await res.text()}`);
    }

    // A session cookie.
    const jar = new Jar();
    const login = await app.request("/api/auth/mock-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "user", id: "u_bt1scan", displayName: null }),
    });
    expect(login.status).toBe(204);
    jar.take(login);
    expect(jar.values.length).toBeGreaterThan(0);
    // A failing request carrying it, so the framework writes an error entry with the cookie present.
    const failing = await app.request("/api/throw/plain", { headers: { cookie: jar.header() } });
    expect(failing.status).toBe(500);
    errorResponses.push(await failing.text());

    // Issued tickets (contents are opaque: every string inside them counts as the ticket URL).
    const ticketStrings: string[] = [];
    for (const path of ["/api/files/upload-ticket", "/api/files/download-ticket"]) {
      const res = await app.request(path, { method: "POST", headers: { cookie: jar.header() } });
      expect(res.status, path).toBe(200);
      const ticket = (await res.json()) as unknown;
      const found = strings(ticket).filter((s) => s.length >= 16);
      expect(found.length, `${path}: ticket holds no URL-like string`).toBeGreaterThan(0);
      ticketStrings.push(...found);
      // Use the ticket's same-origin transfer route, so transfers are logged if they are logged at all.
      for (const s of found) {
        const url = s.startsWith("/") ? new URL(s, "http://localhost") : URL.canParse(s) ? new URL(s) : undefined;
        if (!url || !url.pathname.startsWith("/api/")) continue;
        const upload = path.includes("upload");
        await app.request(`${url.pathname}${url.search}`, upload ? { method: "PUT", headers: { "content-type": "text/plain" }, body: "bt1 upload" } : {});
        // A tampered ticket, so a rejection is logged if rejections are logged.
        await app.request(`${url.pathname}${url.search}x`, upload ? { method: "PUT", headers: { "content-type": "text/plain" }, body: "bt1" } : {});
      }
    }

    const logs = JSON.stringify(app.logs());
    expect(app.logs().length).toBeGreaterThan(0);
    expect(logs).not.toContain(secret);
    for (const v of jar.values) expect(logs).not.toContain(v);
    for (const s of ticketStrings) expect(logs).not.toContain(s);
    for (const r of errorResponses) expect(r).not.toContain(secret);
  });

  it(tag("SEC-AC-002", "local in-process: log entries contain no stub login provider authorization code"), async () => {
    const app = await createRefApp({ stubLoginProvider: true });
    apps.push(app);
    const jar = new Jar();
    let location: string | null = "/api/auth/login?returnTo=%2F";
    let callback: string | undefined;
    for (let hop = 0; hop < 6 && location; hop++) {
      const url = new URL(location, "http://localhost");
      if (!url.pathname.startsWith("/api/")) break;
      if (url.pathname === "/api/auth/callback") callback = `${url.pathname}${url.search}`;
      const res = await app.request(`${url.pathname}${url.search}`, { headers: { cookie: jar.header() }, redirect: "manual" });
      jar.take(res);
      location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    }
    expect(callback, "the stub login did not reach /api/auth/callback").toBeDefined();
    const me = await app.request("/api/auth/me", { headers: { cookie: jar.header() } });
    expect(((await me.json()) as { level: string }).level).not.toBe("anonymous");

    // Replay the callback (same code and state), which fails and writes the failed-login entry.
    const replay = await app.request(callback!, { headers: { cookie: jar.header() }, redirect: "manual" });
    expect(replay.status).toBe(302);
    // And a refused stub login.
    await app.loginWithStub("bt1-refused-subject", { stubFailure: "refused" }).catch(() => undefined);

    // The callback's query values other than paths and URLs (e.g. a returnTo) are the
    // provider's authorization code and state.
    const callbackValues = [...new URL(callback!, "http://localhost").searchParams.values()].filter(
      (v) => v.length >= 6 && !v.startsWith("/") && !/^https?:/.test(v),
    );
    expect(callbackValues.length, "the callback carried no authorization code").toBeGreaterThan(0);
    const logs = JSON.stringify(app.logs());
    expect(app.logs().some((e) => e.severity !== "debug")).toBe(true);
    for (const v of [...new Set([...callbackValues, ...jar.values])]) expect(logs).not.toContain(v);
  });
});
