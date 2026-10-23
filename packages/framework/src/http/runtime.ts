/**
 * HTTP's runtime parts for `assembleApp` (core.md §2 "Runtime assembly"): the error handler,
 * the not-found handler and the framework routes HTTP owns. Framework-internal; target
 * runtimes (B-16) call `createHttpParts`, pass `parts` to the assembler, then `attach` the
 * assembled app.
 */
import type { Hono, MiddlewareHandler } from "hono";
import type { RouterRoute } from "hono/types";
import type { RuntimeContext, RuntimeEnv, RuntimeParts } from "../core/assemble.js";
import { createErrorHandler, createNotFoundHandler, type SecretValues } from "./errors.js";

/**
 * One deploy health check (framework.openapi.yaml `/api/__framework/health`): throws a
 * `FrameworkError` when it fails. The target runtime supplies them: one trivial SQL read, and
 * that every declared and every required framework secret has a value.
 */
export type HealthCheck = (c: RuntimeContext) => void | Promise<void>;

export interface HttpOptions {
  /** Run in order by the health route; the first failure is the response. */
  readonly healthChecks?: readonly HealthCheck[];
  /** The secret values this request may hold (SEC, wired by the target runtime); redacted from responses and log entries. */
  readonly secretValues?: SecretValues;
}

export interface HttpParts {
  readonly parts: Pick<RuntimeParts, "errorHandler" | "notFound" | "frameworkRoutes">;
  /** Gives the not-found handler the assembled app's routes, for `HTTP.METHOD_NOT_ALLOWED`. */
  attach(app: Hono<RuntimeEnv>): void;
}

/** HTTP-REQ-005: `Cache-Control: no-store` on every API response that sets no caching itself. */
export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
};

export function createHttpParts(options: HttpOptions = {}): HttpParts {
  let attached: Hono<RuntimeEnv> | undefined;
  const routes = (): readonly RouterRoute[] => attached?.routes ?? [];
  return {
    parts: {
      errorHandler: createErrorHandler(options.secretValues ? { secretValues: options.secretValues } : {}),
      notFound: createNotFoundHandler(routes),
      frameworkRoutes: (api) => {
        // Registered under /api before app routes, so it wraps every API route.
        api.use("*", noStore);
        api.get("/__framework/health", async (c) => {
          for (const check of options.healthChecks ?? []) await check(c);
          return c.body(null, 204);
        });
      },
    },
    attach: (app) => {
      attached = app;
    },
  };
}
