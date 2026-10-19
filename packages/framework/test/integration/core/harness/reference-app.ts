/**
 * In-process fixture app for the B-T1 suites, defined only with the `.` exports and run with
 * `createTestApp` from `./testing` (testing.d.ts). `defineApp` and `defineTable` are called
 * lazily so that a missing implementation fails each test, not the module import.
 *
 * Every route here is a "reference route" in the sense of the criteria (HTTP-AC-002, -007,
 * CORE-AC-003, -004, -008, CFG-AC-001, SEC-AC-001, LOG-AC-002, -005).
 */
import {
  configBoolean,
  configInteger,
  configString,
  configStringList,
  defineApp,
  defineTable,
  ERROR_CATALOGUE,
  FrameworkError,
  id,
  jsonBody,
  text,
  z,
  type DefinedApp,
  type ErrorCode,
} from "../../../../src/index.js";
import { createTestApp, type TestApp, type TestAppOptions } from "../../../../src/testing/index.js";

export const APP_NAME = "bt1ref";

/** Message of the plain `Error` thrown by `/api/throw/plain`; must never reach a response. */
export const PLAIN_ERROR_MESSAGE = "bt1 plain failure: internal detail /srv/secret/path line 42";

function makeConfig() {
  return {
    greeting: configString({ default: "hello" }),
    limit: configInteger({ default: 7 }),
    enabled: configBoolean({ default: true }),
    tags: configStringList({ default: ["alpha", "beta"] }),
    /** No default: the tests always supply it (`createRefApp`). */
    title: configString(),
  };
}
export type RefConfig = ReturnType<typeof makeConfig>;

export type RefSecrets = "apiKey" | "unsetSecret";
export const SECRET_NAMES: readonly RefSecrets[] = ["apiKey", "unsetSecret"];

/** Request IDs seen by app middleware, keyed by the `x-bt1-probe` request header. */
export const seenRequestIds = new Map<string, string>();
/** Number of times each handler body ran, keyed by handler name. */
export const handlerRuns = new Map<string, number>();

function ran(name: string): void {
  handlerRuns.set(name, (handlerRuns.get(name) ?? 0) + 1);
}

let cached: DefinedApp<RefConfig, RefSecrets> | undefined;

export function referenceApp(): DefinedApp<RefConfig, RefSecrets> {
  if (cached) return cached;
  const items = defineTable("bt1_items", { id: id(), title: text() });
  cached = defineApp({
    name: APP_NAME,
    config: makeConfig(),
    secrets: SECRET_NAMES,
    tables: { items },
    routes: (api) => {
      api.use("*", async (c, next) => {
        const probe = c.req.header("x-bt1-probe");
        if (probe) seenRequestIds.set(probe, c.var.requestId);
        await next();
      });

      api.get("/deployment", (c) => c.json(c.var.deployment));
      api.get("/var-keys", (c) => c.json(Object.keys(c.var).sort()));
      api.get("/whoami", (c) => c.json(c.var.user));

      api.get("/throw/plain", () => {
        throw new Error(PLAIN_ERROR_MESSAGE);
      });
      api.post("/throw/plain", () => {
        throw new Error(PLAIN_ERROR_MESSAGE);
      });
      api.get("/throw/code/:code", (c) => {
        const code = c.req.param("code");
        if (!(code in ERROR_CATALOGUE)) return c.json({ unknown: code }, 200);
        throw new FrameworkError(code as ErrorCode, `bt1 thrown ${code}`);
      });
      api.get("/throw/misconfigured", () => {
        throw new FrameworkError("CORE.MISCONFIGURED", "bt1 misconfigured");
      });
      api.get("/throw/secret-in-plain-error", async (c) => {
        const value = await c.var.secrets.get("apiKey");
        throw new Error(`bt1 failure while using ${value}`);
      });
      api.get("/throw/secret-in-framework-error", async (c) => {
        const value = await c.var.secrets.get("apiKey");
        throw new FrameworkError("HTTP.CONFLICT", `bt1 conflict with ${value}`);
      });

      api.get("/config", (c) =>
        c.json({
          greeting: c.var.config.get("greeting"),
          limit: c.var.config.get("limit"),
          enabled: c.var.config.get("enabled"),
          tags: c.var.config.get("tags"),
          title: c.var.config.get("title"),
        }),
      );
      api.get("/config/undeclared", (c) => {
        // Deliberately reads a key the app did not declare (CFG-REQ-001).
        const read = c.var.config.get as (key: string) => unknown;
        return c.json({ value: read.call(c.var.config, "bt1UndeclaredKey") });
      });

      api.get("/secret/:name", async (c) => {
        const read = c.var.secrets.get as (name: string) => Promise<string>;
        const value = await read.call(c.var.secrets, c.req.param("name"));
        return c.json({ value });
      });

      api.get("/secret-missing", async (c) => {
        const value = await c.var.secrets.get("unsetSecret");
        return c.json({ length: value.length });
      });

      api.post("/files/upload-ticket", async (c) =>
        c.json(await c.var.files.createUploadTicket("bt1/upload.txt", { contentType: "text/plain" })),
      );
      api.post("/files/download-ticket", async (c) => {
        await c.var.files.put("bt1/download.txt", new TextEncoder().encode("bt1 file body"), { contentType: "text/plain" });
        return c.json(await c.var.files.createDownloadTicket("bt1/download.txt"));
      });

      api.get("/sql/items", async (c) => {
        const rows = await c.var.sql.select().from(items);
        return c.json({ count: rows.length });
      });

      api.get("/log", (c) => {
        const message = c.req.query("message") ?? "bt1 log entry";
        c.var.log.write("bt1app", "info", message);
        c.var.log.write("bt1app", "warn", `${message} (warn)`);
        return c.json({ ok: true });
      });

      api.post(
        "/echo",
        jsonBody(z.object({ name: z.string().min(1), size: z.number().int() })),
        (c) => {
          ran("echo");
          return c.json({ received: c.req.valid("json") });
        },
      );
      api.post("/echo-large", jsonBody(z.object({ pad: z.string() })), (c) => {
        ran("echo-large");
        return c.json({ length: c.req.valid("json").pad.length });
      });
    },
  });
  return cached;
}

/** `createTestApp` for the reference app, always supplying the no-default key `title`. */
export function createRefApp(options: TestAppOptions = {}): Promise<TestApp> {
  return createTestApp(referenceApp(), { ...options, config: { title: "bt1 title", ...(options.config ?? {}) } });
}

/** Catalogue codes that have an HTTP status, with that status. */
export function codesWithStatus(): [ErrorCode, number][] {
  return (Object.entries(ERROR_CATALOGUE) as [ErrorCode, { status: number | null }][])
    .filter(([, e]) => e.status !== null)
    .map(([code, e]) => [code, e.status as number]);
}
