/**
 * HTTP criteria in-process through `createTestApp` (testing.d.ts): unknown API paths, the error
 * format, input validation and size limits, and the server-error log entry.
 * Criteria: docs/components/http.md §4.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { LogEntry, TestApp } from "../../../src/testing/index.js";
import {
  cookiePair,
  errorBody,
  errorResponseViolations,
  PAR,
  STACK_FRAME,
  uniqueValue,
} from "../core/harness/harness.js";
import {
  codesWithStatus,
  createRefApp,
  handlerRuns,
  PLAIN_ERROR_MESSAGE,
  seenRequestIds,
} from "../core/harness/reference-app.js";

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let app: TestApp | undefined;
afterEach(async () => {
  await app?.dispose();
  app = undefined;
});

/** A JSON body of exactly `bytes` bytes: `{"pad":"xxx…"}`. */
function paddedBody(bytes: number): string {
  const body = `{"pad":"${"x".repeat(bytes - 10)}"}`;
  if (new TextEncoder().encode(body).length !== bytes) throw new Error("padding arithmetic");
  return body;
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const chunk = 64 * 1024;
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunk));
      offset += chunk;
    },
  });
}

describe("HTTP-AC-001 unknown API paths (in-process)", () => {
  it(tag("HTTP-AC-001", "/api part: GET /api/does-not-exist returns 404 HTTP.NOT_FOUND as an ErrorResponse"), async () => {
    app = await createRefApp();
    for (const path of ["/api/does-not-exist", "/api/does/not/exist/deeply"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type") ?? "", path).toMatch(/^application\/json/);
      const body = await errorBody(res);
      expect(errorResponseViolations(body), path).toEqual([]);
      expect(body.error.code, path).toBe("HTTP.NOT_FOUND");
    }
  });
});

describe("HTTP-AC-002 error format", () => {
  it(tag("HTTP-AC-002", "every catalogue code with a status returns that status and a schema-valid ErrorResponse with the request's ID"), async () => {
    app = await createRefApp();
    const codes = codesWithStatus();
    expect(codes.length).toBeGreaterThan(20);
    for (const [code, status] of codes) {
      const probe = randomUUID();
      const res = await app.request(`/api/throw/code/${code}`, { headers: { "x-bt1-probe": probe } });
      expect(res.status, code).toBe(status);
      const body = await errorBody(res);
      expect(errorResponseViolations(body), code).toEqual([]);
      expect(body.error.code, code).toBe(code);
      const seen = seenRequestIds.get(probe);
      expect(seen, `${code}: app middleware saw no requestId`).toBeTypeOf("string");
      expect(body.error.requestId, code).toBe(seen);
    }
  });

  it(tag("HTTP-AC-002", "a route throwing an error containing a known secret value does not echo it"), async () => {
    const secret = uniqueValue("bt1secret");
    app = await createRefApp({ secrets: { apiKey: secret } });
    for (const path of ["/api/throw/secret-in-plain-error", "/api/throw/secret-in-framework-error"]) {
      const res = await app.request(path);
      expect(res.status, path).toBeGreaterThanOrEqual(400);
      const raw = await res.text();
      expect(errorResponseViolations(JSON.parse(raw)), path).toEqual([]);
      expect(raw, path).not.toContain(secret);
      for (const [name, value] of res.headers) expect(`${name}: ${value}`, path).not.toContain(secret);
    }
  });
});

describe("HTTP-AC-003 validated input", () => {
  it(tag("HTTP-AC-003", "a body of PAR-200 + 1 bytes is rejected with 413 before the handler runs"), async () => {
    app = await createRefApp();
    const runs = () => handlerRuns.get("echo-large") ?? 0;

    // At the limit the body reaches the handler, so the limit is exactly PAR-200.
    const atLimit = paddedBody(PAR.maxJsonBody);
    const ok = await app.request("/api/echo-large", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(atLimit.length) },
      body: atLimit,
    });
    expect(ok.status).toBe(200);
    expect(runs()).toBe(1);

    const over = paddedBody(PAR.maxJsonBody + 1);
    const declared = await app.request("/api/echo-large", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(over.length) },
      body: over,
    });
    expect(declared.status).toBe(413);
    const declaredBody = await errorBody(declared);
    expect(errorResponseViolations(declaredBody)).toEqual([]);
    expect(declaredBody.error.code).toBe("HTTP.PAYLOAD_TOO_LARGE");

    // Streamed, with no Content-Length: the streamed size is checked too (http.md §2).
    const streamed = await app.request("/api/echo-large", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: streamOf(over),
      duplex: "half",
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect((await errorBody(streamed)).error.code).toBe("HTTP.PAYLOAD_TOO_LARGE");

    expect(runs()).toBe(1);
  });

  it(tag("HTTP-AC-003", "a schema-invalid body is rejected with 400 HTTP.INVALID_INPUT before the handler runs"), async () => {
    app = await createRefApp();
    const runs = () => handlerRuns.get("echo") ?? 0;
    const valid = await app.request("/api/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "n", size: 3 }),
    });
    expect(valid.status).toBe(200);
    expect(runs()).toBe(1);

    const invalidBodies = [
      JSON.stringify({ name: "", size: 3 }),
      JSON.stringify({ name: "n", size: 2.5 }),
      JSON.stringify({ name: "n" }),
      JSON.stringify({ name: 7, size: 3 }),
      "[]",
      "{not json",
    ];
    for (const body of invalidBodies) {
      const res = await app.request("/api/echo", { method: "POST", headers: { "content-type": "application/json" }, body });
      expect(res.status, body).toBe(400);
      const parsed = await errorBody(res);
      expect(errorResponseViolations(parsed), body).toEqual([]);
      expect(parsed.error.code, body).toBe("HTTP.INVALID_INPUT");
    }
    expect(runs()).toBe(1);
  });
});

describe("HTTP-AC-007 server errors are logged", () => {
  /** The error entries a request added to the test app's log. */
  async function errorEntriesOf(
    t: TestApp,
    path: string,
    init?: RequestInit,
  ): Promise<{ res: Response; requestId: string; entries: LogEntry[] }> {
    const before = t.logs().length;
    const res = await t.request(path, init);
    const body = await errorBody(res);
    const entries = t.logs().slice(before).filter((e) => e.severity === "error");
    return { res, requestId: body.error.requestId, entries };
  }

  /** The name and message of the error a /caught/<what> twin route caught (reference-app.ts). */
  async function caught(t: TestApp, what: string): Promise<{ name: string; message: string }> {
    const res = await t.request(`/api/caught/${what}`);
    expect(res.status, `/api/caught/${what}`).toBe(200);
    const body = (await res.json()) as { caught: { name: string; message: string } | null };
    expect(body.caught, `/api/caught/${what} caught nothing`).not.toBeNull();
    return body.caught as { name: string; message: string };
  }

  function expectOneEntry(
    result: { res: Response; requestId: string; entries: LogEntry[] },
    expected: {
      method: string;
      path: string;
      code: string;
      status: number;
      underlying: { name: string; message: string };
      contains?: (string | RegExp)[];
    },
  ): void {
    const label = `${expected.method} ${expected.path}`;
    expect(result.res.status, label).toBe(expected.status);
    expect(result.entries.length, `${label}: error entries ${JSON.stringify(result.entries)}`).toBe(1);
    const entry = result.entries[0]!;
    expect(entry.requestId, label).toBe(result.requestId);
    expect(entry.message, label).toContain(expected.method);
    expect(entry.message, label).toContain(expected.path);
    expect(entry.message, label).toContain(expected.code);
    // The underlying error's own name (as a whole token, so "Error" is not satisfied by
    // "FrameworkError"), its message, and a stack (B-T5, flag F12).
    expect(expected.underlying.name, `${label}: the caught twin route reported no error name`).not.toBe("");
    expect(entry.message, `${label}: error name ${expected.underlying.name}`).toMatch(
      new RegExp(`(^|[^\\w$])${escapeRe(expected.underlying.name)}([^\\w$]|$)`),
    );
    expect(entry.message, `${label}: error message`).toContain(expected.underlying.message);
    expect(entry.message, label).toMatch(STACK_FRAME);
    for (const c of expected.contains ?? []) {
      if (typeof c === "string") expect(entry.message, label).toContain(c);
      else expect(entry.message, label).toMatch(c);
    }
  }

  it(tag("HTTP-AC-007", "CORE.INTERNAL leaves exactly one error entry with method, route path, code, error name, message and stack"), async () => {
    app = await createRefApp();
    const underlying = await caught(app, "plain");
    expectOneEntry(await errorEntriesOf(app, "/api/throw/plain"), {
      method: "GET",
      path: "/api/throw/plain",
      code: "CORE.INTERNAL",
      status: 500,
      underlying,
      contains: [PLAIN_ERROR_MESSAGE],
    });
  });

  it(tag("HTTP-AC-007", "CORE.MISCONFIGURED leaves exactly one error entry with method, route path, code, error name, message and stack"), async () => {
    app = await createRefApp();
    const underlying = await caught(app, "misconfigured");
    expectOneEntry(await errorEntriesOf(app, "/api/throw/misconfigured"), {
      method: "GET",
      path: "/api/throw/misconfigured",
      code: "CORE.MISCONFIGURED",
      status: 500,
      underlying,
      contains: ["bt1 misconfigured"],
    });
  });

  it(tag("HTTP-AC-007", "CFG.UNDECLARED_KEY leaves exactly one error entry naming the key"), async () => {
    app = await createRefApp();
    const underlying = await caught(app, "config-undeclared");
    expectOneEntry(await errorEntriesOf(app, "/api/config/undeclared"), {
      method: "GET",
      path: "/api/config/undeclared",
      code: "CFG.UNDECLARED_KEY",
      status: 500,
      underlying,
      contains: ["bt1UndeclaredKey"],
    });
  });

  it(tag("HTTP-AC-007", "SEC.MISSING leaves exactly one error entry naming the secret"), async () => {
    app = await createRefApp();
    const underlying = await caught(app, "secret-missing");
    expectOneEntry(await errorEntriesOf(app, "/api/secret-missing"), {
      method: "GET",
      path: "/api/secret-missing",
      code: "SEC.MISSING",
      status: 500,
      underlying,
      contains: [/unsetSecret|SECRET_UNSET_SECRET/],
    });
  });

  it(tag("HTTP-AC-007", "with unavailable: [\"sql\"], SQL.UNAVAILABLE leaves exactly one error entry"), async () => {
    app = await createRefApp({ unavailable: ["sql"] });
    const underlying = await caught(app, "sql-items");
    expectOneEntry(await errorEntriesOf(app, "/api/sql/items"), {
      method: "GET",
      path: "/api/sql/items",
      code: "SQL.UNAVAILABLE",
      status: 503,
      underlying,
    });
  });

  it(tag("HTTP-AC-007", "a failing request with a session cookie, a JSON body, and OAuth-like code and state leaves none of them in any entry"), async () => {
    app = await createRefApp();
    const login = await app.request("/api/auth/mock-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "user", id: "u_bt1httpseven", displayName: "Seven" }),
    });
    expect(login.status).toBe(204);
    const cookie = cookiePair(login.headers.get("set-cookie"));
    const cookieValue = cookie.slice(cookie.indexOf("=") + 1);
    expect(cookieValue.length).toBeGreaterThan(8);

    const code = uniqueValue("oauthcode");
    const state = uniqueValue("oauthstate");
    const bodyMarker = uniqueValue("bodymarker");
    const before = app.logs().length;
    const res = await app.request(`/api/throw/plain?code=${code}&state=${state}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ note: bodyMarker }),
    });
    expect(res.status).toBe(500);
    const written = app.logs().slice(before);
    expect(written.some((e) => e.severity === "error")).toBe(true);
    const all = JSON.stringify(app.logs());
    for (const v of [cookieValue, code, state, bodyMarker]) expect(all).not.toContain(v);
  });
});
