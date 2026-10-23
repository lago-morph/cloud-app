import type { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { assembleApp, type RuntimeParts } from "../core/assemble.js";
import type { ErrorResponseBody } from "../core/errors.js";
import { createDeployment } from "../core/identity.js";
import { defineApp, type AppEnv, type Services } from "../core/public.js";
import { isLogEntry } from "./entry.js";
import { createMemorySink } from "./memory.js";
import { requestLogFactory } from "./request.js";
import { failingSink, neverCompletingSink } from "./test-sinks.js";
import type { LogSink } from "./writer.js";

/** PAR-260: maximum time a response waits for pending log writes. */
const PAR_260_MS = 2000;

const deployment = createDeployment({ app: "notes", stage: "dev", target: "local" });

function app(sink: LogSink, routes: (api: Hono<AppEnv>) => void) {
  const parts: RuntimeParts = {
    deployment,
    createLog: requestLogFactory(deployment, sink),
    createServices: () => ({ sql: {}, kv: {}, files: {}, config: {}, secrets: {} }) as unknown as Omit<Services, "log">,
    currentUser: async (c, next) => {
      c.set("user", { level: "anonymous" });
      await next();
    },
    forgeryCheck: async (_c, next) => {
      await next();
    },
  };
  return assembleApp(defineApp({ name: "notes", config: {}, secrets: [], tables: {}, routes }), parts);
}

const writing = (api: Hono<AppEnv>) =>
  api.get("/notes", (c) => {
    for (let i = 0; i < 20; i += 1) c.var.log.write("notes", "info", `entry ${i}`);
    c.var.log.write("notes", "error", "and an error");
    return c.json({ ok: true });
  });

async function timed(hono: ReturnType<typeof app>): Promise<{ status: number; ms: number }> {
  const started = performance.now();
  const res = await hono.request("/api/notes");
  await res.arrayBuffer();
  return { status: res.status, ms: performance.now() - started };
}

describe("request log writers in an assembled app", () => {
  for (const [name, sink] of [
    ["fails (throws)", failingSink()],
    ["fails (rejects)", failingSink("reject")],
    ["never completes", neverCompletingSink()],
  ] as const) {
    it(tag("LOG-AC-001", `a request that writes entries succeeds, within PAR-260 of the baseline, when the writer ${name}`), async () => {
      const baseline = await timed(app(createMemorySink(() => undefined).sink, writing));
      const result = await timed(app(sink, writing));
      expect(result.status).toBe(200);
      expect(result.ms - baseline.ms).toBeLessThanOrEqual(PAR_260_MS);
    });
  }

  it(tag("LOG-AC-002", "stored entries validate and carry the request ID of the matching error response"), async () => {
    const memory = createMemorySink(() => undefined);
    const hono = app(memory.sink, (api) =>
      api.get("/broken", (c) => {
        c.var.log.write("notes", "info", "before failing");
        throw new Error("plain failure");
      }),
    );
    const res = await hono.request("/api/broken?code=abc");
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponseBody;
    const entries = memory.entries();
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(isLogEntry(entry)).toBe(true);
      expect(entry).toMatchObject({ app: "notes", stage: "dev", target: "local", requestId: body.error.requestId });
    }
    expect(entries[1]).toMatchObject({ component: "CORE", severity: "error" });
    expect(entries[1]?.message).toMatch(/^GET \/api\/broken failed with CORE.INTERNAL\nError: plain failure\n/);
  });

  it("gives each request's writer that request's ID", async () => {
    const memory = createMemorySink(() => undefined);
    const hono = app(memory.sink, writing);
    await hono.request("/api/notes");
    await hono.request("/api/notes");
    const ids = new Set(memory.entries().map((e) => e.requestId));
    expect(ids.size).toBe(2);
  });
});
