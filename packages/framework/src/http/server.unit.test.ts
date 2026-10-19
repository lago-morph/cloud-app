import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { assembleApp, type RuntimeParts } from "../core/assemble.js";
import { ERROR_CATALOGUE, FrameworkError, type ErrorCode } from "../core/errors.js";
import { createDeployment } from "../core/identity.js";
import { defineApp, type AppEnv, type Services } from "../core/public.js";
import type { LogService, Severity } from "../log/public.js";
import { createHttpParts, type HttpOptions } from "./runtime.js";

interface Written {
  component: string;
  severity: Severity;
  message: string;
}

/** An assembled app with HTTP's runtime parts and fake everything else; records log writes. */
function app(routes: (api: Hono<AppEnv>) => void, options: HttpOptions = {}, overrides: Partial<RuntimeParts> = {}) {
  const written: Written[] = [];
  const http = createHttpParts(options);
  const hono = assembleApp(defineApp({ name: "notes", config: {}, secrets: [], tables: {}, routes }), {
    deployment: createDeployment({ app: "notes", stage: "dev", target: "local" }),
    createLog: () => {
      const log: LogService = { write: (component, severity, message) => void written.push({ component, severity, message }) };
      return log;
    },
    createServices: () => ({ sql: {}, kv: {}, files: {}, config: {}, secrets: {} }) as unknown as Omit<Services, "log">,
    currentUser: async (c, next) => {
      c.set("user", { level: "anonymous" });
      await next();
    },
    forgeryCheck: async (_c, next) => next(),
    ...http.parts,
    ...overrides,
  });
  http.attach(hono);
  return { hono, written };
}

const ID = /^[0-9a-f-]{36}$/;

/** Checks the ErrorResponse schema of framework.openapi.yaml exactly (no extra properties). */
function expectErrorResponse(body: unknown, code: ErrorCode): { message: string; requestId: string } {
  expect(body).toEqual({ error: { code, message: expect.any(String), requestId: expect.stringMatching(ID) } });
  return (body as { error: { message: string; requestId: string } }).error;
}

describe("HTTP error handler", () => {
  it(tag("HTTP-AC-002", "every catalogue code with a status returns that status and an ErrorResponse with the request's ID"), async () => {
    const codes = (Object.keys(ERROR_CATALOGUE) as ErrorCode[]).filter((code) => ERROR_CATALOGUE[code].status !== null);
    const seen: string[] = [];
    const { hono } = app((api) => {
      api.get("/throw/:code", (c) => {
        seen.push(c.var.requestId);
        throw new FrameworkError(c.req.param("code") as ErrorCode, "app said no");
      });
    });
    for (const code of codes) {
      const res = await hono.request(`/api/throw/${code}`);
      expect(res.status, code).toBe(ERROR_CATALOGUE[code].status);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      const error = expectErrorResponse(await res.json(), code);
      expect(error.requestId).toBe(seen.at(-1));
    }
  });

  it(tag("HTTP-AC-002", "a route throwing an error containing a known secret value does not echo it"), async () => {
    const secret = "s3cr3t-value-123";
    const { hono } = app(
      (api) => {
        api.get("/plain", () => {
          throw new Error(`upstream rejected key ${secret}`);
        });
        api.get("/app-code", () => {
          throw new FrameworkError("HTTP.CONFLICT", `cannot use ${secret} twice`);
        });
        api.get("/server", () => {
          throw new FrameworkError("CORE.MISCONFIGURED", `binding DB holds ${secret}`);
        });
      },
      { secretValues: () => [secret] },
    );
    for (const path of ["/api/plain", "/api/app-code", "/api/server"]) {
      const text = await (await hono.request(path)).text();
      expect(text, path).not.toContain(secret);
      expect(text, path).not.toMatch(/\bat .*\.ts:\d+/);
    }
  });

  it("4xx responses keep the app's message (secret values redacted); 5xx responses give only the catalogue meaning", async () => {
    const { hono } = app(
      (api) => {
        api.get("/conflict", () => {
          throw new FrameworkError("HTTP.CONFLICT", "note limit reached (s3cr3t)");
        });
        api.get("/misconfigured", () => {
          throw new FrameworkError("CORE.MISCONFIGURED", "binding DB is missing");
        });
        api.get("/plain", () => {
          throw new TypeError("x is undefined");
        });
      },
      { secretValues: () => ["s3cr3t", ""] },
    );
    expect(expectErrorResponse(await (await hono.request("/api/conflict")).json(), "HTTP.CONFLICT").message).toBe(
      "note limit reached ([redacted])",
    );
    expect(expectErrorResponse(await (await hono.request("/api/misconfigured")).json(), "CORE.MISCONFIGURED").message).toBe(
      ERROR_CATALOGUE["CORE.MISCONFIGURED"].meaning,
    );
    expect(expectErrorResponse(await (await hono.request("/api/plain")).json(), "CORE.INTERNAL").message).toBe(
      ERROR_CATALOGUE["CORE.INTERNAL"].meaning,
    );
  });
});

describe("server error log entries (HTTP-REQ-007)", () => {
  const cases: [ErrorCode, string, string][] = [
    ["CORE.MISCONFIGURED", "CORE", "binding DB is missing"],
    ["CFG.UNDECLARED_KEY", "CFG", 'configuration key "pageSize" is not declared'],
    ["SEC.MISSING", "SEC", 'secret "mailApiKey" has no value in stage dev'],
    ["SQL.UNAVAILABLE", "SQL", "database did not answer within 5000 ms"],
  ];

  it(tag("HTTP-AC-007", "unit part: each 5xx leaves exactly one error entry with method, route path, code, error name, message, stack, and the key or secret name"), async () => {
    const { hono, written } = app((api) => {
      api.post("/items/:id", (c) => {
        const [code, , message] = cases[Number(c.req.param("id"))]!;
        throw new FrameworkError(code, message);
      });
      api.post("/plain/:id", () => {
        throw new TypeError("x is undefined");
      });
    });
    for (const [i, [code, component, message]] of cases.entries()) {
      written.length = 0;
      const res = await hono.request(`/api/items/${i}?code=oauth-code-1&state=st-1`, { method: "POST" });
      expect(res.status).toBe(ERROR_CATALOGUE[code].status);
      expect(written).toHaveLength(1);
      const entry = written[0]!;
      expect(entry.severity).toBe("error");
      expect(entry.component).toBe(component);
      expect(entry.message).toContain(`POST /api/items/:id failed with ${code}`);
      expect(entry.message).toContain(`FrameworkError: ${message}`);
      expect(entry.message).toMatch(/\n\s+at /);
    }
    written.length = 0;
    await hono.request("/api/plain/1", { method: "POST" });
    expect(written).toHaveLength(1);
    expect(written[0]!.component).toBe("CORE");
    expect(written[0]!.message).toMatch(/^POST \/api\/plain\/:id failed with CORE\.INTERNAL\nTypeError: x is undefined\n\s+at /);
  });

  it(tag("HTTP-AC-007", "unit part: a failing request's cookie, JSON body, OAuth-like query values and secret values appear in no entry"), async () => {
    const secret = "s3cr3t-in-message";
    const { hono, written } = app(
      (api) =>
        api.post("/fail", async (c) => {
          await c.req.json();
          throw new Error(`failed with ${secret}`);
        }),
      { secretValues: () => [secret] },
    );
    await hono.request("/api/fail?code=oauth-code-xyz&state=state-abc&nonce=nonce-def", {
      method: "POST",
      headers: { Cookie: "session_local=cookie-value-ghi", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "body-value-jkl" }),
    });
    expect(written).toHaveLength(1);
    for (const value of ["oauth-code-xyz", "state-abc", "nonce-def", "cookie-value-ghi", "body-value-jkl", secret]) {
      expect(written[0]!.message).not.toContain(value);
    }
    expect(written[0]!.message).toContain("[redacted]");
  });

  it("a thrown non-Error value becomes 500 CORE.INTERNAL with exactly one entry", async () => {
    const { hono, written } = app((api) =>
      api.get("/odd", () => {
        throw "just a string";
      }),
    );
    const res = await hono.request("/api/odd");
    expect(res.status).toBe(500);
    expectErrorResponse(await res.json(), "CORE.INTERNAL");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(written).toHaveLength(1);
    expect(written[0]!.message).toMatch(/^GET \/api\/odd failed with CORE\.INTERNAL\nThrownValue: just a string/);
  });

  it("responses below 500 leave no log entry", async () => {
    const { hono, written } = app((api) => {
      api.get("/conflict", () => {
        throw new FrameworkError("HTTP.CONFLICT");
      });
    });
    await hono.request("/api/conflict");
    await hono.request("/api/nothing");
    expect(written).toEqual([]);
  });
});

describe("health route", () => {
  it("GET /api/__framework/health runs every check in order and returns 204 with no log entry", async () => {
    const ran: string[] = [];
    const { hono, written } = app(() => {}, {
      healthChecks: [() => void ran.push("sql"), async () => void ran.push("secrets")],
    });
    const res = await hono.request("/api/__framework/health");
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(ran).toEqual(["sql", "secrets"]);
    expect(written).toEqual([]);
  });

  it("returns the first failing check's code as an ErrorResponse; details go only to the log", async () => {
    const ran: string[] = [];
    const { hono, written } = app(() => {}, {
      healthChecks: [
        () => void ran.push("sql"),
        () => {
          ran.push("secrets");
          throw new FrameworkError("SEC.MISSING", 'secret "frameworkSessionKey" has no value');
        },
        () => void ran.push("never"),
      ],
    });
    const res = await hono.request("/api/__framework/health");
    expect(res.status).toBe(500);
    const error = expectErrorResponse(await res.json(), "SEC.MISSING");
    expect(error.message).not.toContain("frameworkSessionKey");
    expect(ran).toEqual(["sql", "secrets"]);
    expect(written).toHaveLength(1);
    expect(written[0]!.message).toContain('GET /api/__framework/health failed with SEC.MISSING');
    expect(written[0]!.message).toContain("frameworkSessionKey");
  });
});

describe("API caching", () => {
  it("API responses carry Cache-Control: no-store unless the route sets its own (HTTP-REQ-005)", async () => {
    const { hono } = app((api) => {
      api.get("/plain", (c) => c.json({ ok: true }));
      api.get("/cached", (c) => {
        c.header("Cache-Control", "public, max-age=60");
        return c.json({ ok: true });
      });
      api.get("/fails", () => {
        throw new FrameworkError("HTTP.CONFLICT");
      });
    });
    expect((await hono.request("/api/plain")).headers.get("cache-control")).toBe("no-store");
    expect((await hono.request("/api/cached")).headers.get("cache-control")).toBe("public, max-age=60");
    expect((await hono.request("/api/fails")).headers.get("cache-control")).toBe("no-store");
    expect((await hono.request("/api/missing")).headers.get("cache-control")).toBe("no-store");
  });
});

describe("unknown routes", () => {
  it(tag("HTTP-AC-001", "/api part: GET /api/does-not-exist returns 404 HTTP.NOT_FOUND as an ErrorResponse"), async () => {
    const { hono, written } = app((api) => api.get("/notes", (c) => c.json([])));
    for (const path of ["/api/does-not-exist", "/api/notes/1", "/api"]) {
      const res = await hono.request(path);
      expect(res.status, path).toBe(404);
      expectErrorResponse(await res.json(), "HTTP.NOT_FOUND");
    }
    expect(written).toEqual([]);
  });

  it("a known path with the wrong method returns 405 HTTP.METHOD_NOT_ALLOWED with an Allow header", async () => {
    const { hono, written } = app((api) => {
      api.get("/notes/:id", (c) => c.json({}));
      api.delete("/notes/:id", (c) => c.body(null, 204));
    });
    const res = await hono.request("/api/notes/7", { method: "POST" });
    expect(res.status).toBe(405);
    expectErrorResponse(await res.json(), "HTTP.METHOD_NOT_ALLOWED");
    expect(res.headers.get("allow")).toBe("DELETE, GET");
    expect((await hono.request("/api/health/7", { method: "POST" })).status).toBe(404);
    expect(written).toEqual([]);
  });
});
