/**
 * Runtime app assembler (core.md §2 "Hono", "Runtime assembly"). Each target runtime calls
 * `assembleApp` with the app's definition and its own runtime parts; the result is the Hono
 * app the target serves. Never exported to app code.
 */
import { Hono, type Context, type ErrorHandler, type MiddlewareHandler, type NotFoundHandler } from "hono";
import type { ConfigDeclaration } from "../config/public.js";
import type { LogService } from "../log/public.js";
import { asError, coreErrorHandler } from "./error-handler.js";
import { deferredCheck } from "./deferred.js";
import { appIdentity, checkAppName, checkStageName, type Deployment } from "./identity.js";
import type { AppEnv, DefinedApp, RequestVars, Services } from "./public.js";

/** Hono environment of the assembled app: the platform's bindings and the full `c.var`. */
export interface RuntimeEnv {
  Bindings: Record<string, unknown>;
  Variables: RequestVars;
}

export type RuntimeContext = Context<RuntimeEnv>;

/** The pluggable parts a target runtime supplies (slots in core.md §2's middleware order). */
export interface RuntimeParts {
  /** Embedded by the build (`createDeployment`). */
  readonly deployment: Deployment;
  /** LOG writer for this request; `c.var.requestId` is already set. */
  readonly createLog: (c: RuntimeContext) => LogService;
  /** The target's `createServices(env, deployment)`, given the request's log. */
  readonly createServices: (env: RuntimeEnv["Bindings"], deployment: Deployment, log: LogService) => Omit<Services, "log">;
  /** AUTH: sets `c.var.user`. */
  readonly currentUser: MiddlewareHandler<RuntimeEnv>;
  /** AUTH: request forgery check for state-changing requests. */
  readonly forgeryCheck: MiddlewareHandler<RuntimeEnv>;
  /** HTTP error handler. */
  readonly errorHandler?: ErrorHandler<RuntimeEnv>;
  /** HTTP not-found handler. */
  readonly notFound?: NotFoundHandler<RuntimeEnv>;
  /** Framework routes under `/api` (health, auth, local file transfer), registered before app routes. */
  readonly frameworkRoutes?: (api: Hono<RuntimeEnv>) => void;
}

export function assembleApp<C extends ConfigDeclaration, S extends string>(
  defined: DefinedApp<C, S>,
  parts: RuntimeParts,
): Hono<RuntimeEnv> {
  const app = new Hono<RuntimeEnv>();
  const deployment = appIdentity(parts.deployment);
  const checkWiring = deferredCheck(() => {
    checkAppName(parts.deployment.app);
    checkStageName(parts.deployment.stage);
    if (parts.deployment.app !== defined.definition.name) {
      throw new Error(
        `the deployment was built for app ${JSON.stringify(parts.deployment.app)}, but the app definition is named ${JSON.stringify(defined.definition.name)}`,
      );
    }
  });
  app.use(async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
  });
  app.use(async (c, next) => {
    c.set("log", parts.createLog(c));
    await next();
  });
  const onError: ErrorHandler<RuntimeEnv> = parts.errorHandler ?? coreErrorHandler;
  app.onError(onError);
  app.use(async (c, next) => {
    // Hono hands only `Error` instances to onError; anything else thrown is wrapped here.
    try {
      await next();
    } catch (thrown) {
      c.res = await onError(asError(thrown), c);
    }
  });
  app.use(async (c, next) => {
    checkWiring();
    c.set("deployment", deployment);
    const services = parts.createServices(c.env, parts.deployment, c.var.log);
    c.set("sql", services.sql);
    c.set("kv", services.kv);
    c.set("files", services.files);
    c.set("config", services.config);
    c.set("secrets", services.secrets);
    await next();
  });
  app.use(parts.currentUser);
  app.use(parts.forgeryCheck);
  if (parts.notFound) app.notFound(parts.notFound);
  if (parts.frameworkRoutes) {
    const framework = new Hono<RuntimeEnv>();
    parts.frameworkRoutes(framework);
    app.route("/api", framework);
  }
  const api = new Hono<AppEnv<C, S>>();
  defined.definition.routes(api);
  app.route("/api", api as unknown as Hono<RuntimeEnv>);
  return app;
}
