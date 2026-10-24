import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import type { LogService, Severity } from "../log/public.js";
import { assembleApp, type RuntimeParts } from "./assemble.js";
import { FrameworkError } from "./errors.js";
import { createDeployment } from "./identity.js";
import { defineApp, type AppEnv, type Services } from "./public.js";

interface Written {
  component: string;
  severity: Severity;
  message: string;
  requestId: string | undefined;
}

/** Fake runtime parts: records calls and log writes; services are inert placeholders. */
function fakeParts(overrides: Partial<RuntimeParts> = {}) {
  const calls: string[] = [];
  const written: Written[] = [];
  const parts: RuntimeParts = {
    deployment: createDeployment({ app: "notes", stage: "dev", target: "local" }),
    createLog: (c) => {
      calls.push("log");
      const requestId = c.get("requestId");
      const log: LogService = { write: (component, severity, message) => void written.push({ component, severity, message, requestId }) };
      return log;
    },
    createServices: () => {
      calls.push("services");
      return { sql: {}, kv: {}, files: {}, config: {}, secrets: {} } as unknown as Omit<Services, "log">;
    },
    currentUser: async (c, next) => {
      calls.push("user");
      c.set("user", { level: "anonymous" });
      await next();
    },
    forgeryCheck: async (_c, next) => {
      calls.push("forgery");
      await next();
    },
    ...overrides,
  };
  return { parts, calls, written };
}

function app(routes: (api: Hono<AppEnv>) => void, overrides: Partial<RuntimeParts> = {}) {
  const fake = fakeParts(overrides);
  const hono = assembleApp(defineApp({ name: "notes", config: {}, secrets: [], tables: {}, routes }), fake.parts);
  return { hono, ...fake };
}

describe("assembleApp: routes", () => {
  it("mounts app routes under /api", async () => {
    const { hono } = app((api) => api.get("/hello", (c) => c.json({ hello: "world" })));
    const res = await hono.request("/api/hello");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
    expect((await hono.request("/hello")).status).toBe(404);
  });
});

describe("assembleApp: request IDs", () => {
  it("gives each request its own non-empty ID, never taken from request headers", async () => {
    const { hono } = app((api) => api.get("/id", (c) => c.text(c.var.requestId)));
    const a = await (await hono.request("/api/id", { headers: { "X-Request-Id": "forged" } })).text();
    const b = await (await hono.request("/api/id")).text();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });
});

describe("assembleApp: middleware order and c.var", () => {
  it("runs request ID, log writer, services, current user, forgery check, then the route", async () => {
    const { hono, calls } = app((api) =>
      api.get("/order", (c) => {
        calls.push("route");
        return c.body(null, 204);
      }),
    );
    expect((await hono.request("/api/order")).status).toBe(204);
    expect(calls).toEqual(["log", "services", "user", "forgery", "route"]);
  });

  it(tag("CORE-AC-001", "c.var holds exactly the RequestVars members at run time"), async () => {
    let keys: string[] = [];
    const { hono } = app((api) =>
      api.get("/vars", (c) => {
        keys = Object.keys(c.var).sort();
        return c.body(null, 204);
      }),
    );
    await hono.request("/api/vars");
    expect(keys).toEqual(["config", "deployment", "files", "kv", "log", "requestId", "secrets", "sql", "user"]);
  });

  it(tag("CORE-AC-003", "forged Host and forwarding headers do not change c.var.deployment"), async () => {
    const { hono } = app((api) => api.get("/who", (c) => c.json(c.var.deployment)));
    const res = await hono.request("http://evil.example/api/who", {
      headers: { Host: "other-app-prod.example", "X-Forwarded-Host": "x-prod.example", Forwarded: "host=y", "X-Forwarded-Proto": "https" },
    });
    expect(await res.json()).toEqual({ app: "notes", stage: "dev" });
  });
});

describe("assembleApp: errors", () => {
  it("returns a FrameworkError as an ErrorResponse with its catalogue status and the request's ID", async () => {
    let requestId = "";
    const { hono, written } = app((api) =>
      api.post("/full", (c) => {
        requestId = c.var.requestId;
        throw new FrameworkError("HTTP.CONFLICT", "the list is full");
      }),
    );
    const res = await hono.request("/api/full", { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "HTTP.CONFLICT", message: "the list is full", requestId } });
    expect(written).toEqual([]);
  });

  it(tag("CORE-AC-004", "a plain Error becomes 500 CORE.INTERNAL with no details in the response"), async () => {
    let requestId = "";
    const { hono } = app((api) =>
      api.get("/boom", (c) => {
        requestId = c.var.requestId;
        throw new TypeError("db password is hunter2");
      }),
    );
    const res = await hono.request("/api/boom");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "CORE.INTERNAL", message: "Unexpected failure. Details are logged, never returned.", requestId },
    });
    expect(text).not.toMatch(/hunter2|TypeError|at .*:\d+/);
  });

  it("writes the original error to the log once, with the request ID, method, path, code, name, message and stack", async () => {
    let requestId = "";
    const { hono, written } = app((api) =>
      api.get("/boom", (c) => {
        requestId = c.var.requestId;
        throw new TypeError("db password is hunter2");
      }),
    );
    await hono.request("/api/boom?code=oauthcode&state=s1");
    expect(written).toHaveLength(1);
    const [entry] = written;
    expect(entry).toMatchObject({ component: "CORE", severity: "error", requestId });
    expect(entry?.message).toContain("GET /api/boom");
    expect(entry?.message).toContain("CORE.INTERNAL");
    expect(entry?.message).toContain("TypeError: db password is hunter2");
    expect(entry?.message).toMatch(/\n\s+at /);
    expect(entry?.message).not.toContain("oauthcode");
  });

  it("treats a thrown non-Error value as CORE.INTERNAL", async () => {
    const { hono, written } = app((api) =>
      api.get("/str", () => {
        throw "plain string";
      }),
    );
    const res = await hono.request("/api/str");
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CORE.INTERNAL");
    expect(written[0]?.message).toContain("plain string");
  });
});

describe("assembleApp: deferred misconfiguration", () => {
  const mismatched = { app: "other", stage: "dev", target: "local", isTestStage: false } as const;

  it("does not throw while assembling when the embedded identity does not match the app", () => {
    expect(() => app(() => {}, { deployment: mismatched })).not.toThrow();
  });

  it("answers the first request with 500 CORE.MISCONFIGURED, logged, when the embedded identity does not match the app", async () => {
    const { hono, written, calls } = app(() => {}, { deployment: mismatched });
    const res = await hono.request("/api/anything");
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("CORE.MISCONFIGURED");
    expect(written).toHaveLength(1);
    expect(written[0]?.message).toContain('"other"');
    expect(calls).toEqual(["log"]);
  });

  it("rejects an embedded identity that breaks the stage-name rule on the first request", async () => {
    const { hono } = app(() => {}, { deployment: { ...mismatched, app: "notes", stage: "Bad_Stage" } });
    const res = await hono.request("/api/anything");
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("stage-name rule");
  });

  it("surfaces a services factory's CORE.MISCONFIGURED through the error handler", async () => {
    const { hono, written } = app(() => {}, {
      createServices: () => {
        throw new FrameworkError("CORE.MISCONFIGURED", "binding DB is missing");
      },
    });
    const res = await hono.request("/api/x");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "CORE.MISCONFIGURED", message: "binding DB is missing" } });
    expect(written).toHaveLength(1);
  });
});

describe("assembleApp: HTTP slots", () => {
  it("uses the supplied error handler, also for thrown non-Error values", async () => {
    const seen: unknown[] = [];
    const { hono } = app(
      (api) => {
        api.get("/e", () => {
          throw new Error("e");
        });
        api.get("/s", () => {
          throw "s";
        });
      },
      {
        errorHandler: (err, c) => {
          seen.push(err);
          return c.text(`handled ${c.var.requestId.length}`, 418);
        },
      },
    );
    expect((await hono.request("/api/e")).status).toBe(418);
    expect(await (await hono.request("/api/s")).text()).toBe("handled 36");
    expect(seen.map((e) => (e as Error).message)).toEqual(["e", "s"]);
  });

  it("uses the supplied not-found handler", async () => {
    const { hono } = app(() => {}, { notFound: (c) => c.text("nothing here", 404) });
    const res = await hono.request("/api/missing");
    expect(await res.text()).toBe("nothing here");
  });

  it("registers framework routes under /api ahead of app routes, after the framework middleware", async () => {
    const { hono, calls } = app((api) => api.get("/__framework/health", (c) => c.text("app")), {
      frameworkRoutes: (api) =>
        api.get("/__framework/health", (c) => {
          calls.push("health");
          return c.text(`framework ${c.var.deployment.app}`);
        }),
    });
    expect(await (await hono.request("/api/__framework/health")).text()).toBe("framework notes");
    expect(calls).toEqual(["log", "services", "user", "forgery", "health"]);
  });
});
