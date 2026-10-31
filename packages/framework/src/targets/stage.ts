/**
 * The stage runtime shared by every target runtime (local `dev` and Cloudflare; the AWS Lambda on branch `aws`, DEC-0508)
 * and `createTestApp` (core.md §2 "Runtime assembly", "Services per request"; local.md §2: the
 * local target uses the Cloudflare adapters wherever possible). It wires every component's
 * runtime parts into CORE's assembler: LOG's request writer, HTTP's error/not-found handlers
 * and routes, AUTH's current-user middleware, forgery check and routes, and a
 * `createServices` that builds SQL, KV, FILES, CFG and SEC per request over the target's
 * bindings. What differs per target (bindings, sink, ticket issuer, extra routes, mock,
 * provider) is passed in. Workers-compatible: no Node APIs. Target-neutral: it imports no
 * target's adapters, so it lives here rather than under `targets/cloudflare/`
 * (DEC-0473; `targets/cloudflare/stage.ts` re-exports it).
 */
import type { Hono } from "hono";
import { assembleApp, type RuntimeContext, type RuntimeEnv } from "../core/assemble.js";
import type { DefinedApp } from "../core/public.js";
import type { ConfigDeclaration } from "../config/public.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { createConfigService } from "../config/service.js";
import { createHttpParts, type HealthCheck } from "../http/runtime.js";
import { createAuthParts } from "../auth/runtime.js";
import type { AuthMock } from "../auth/mock.js";
import type { CookieSettings } from "../auth/cookies.js";
import type { LoginProvider } from "../auth/login-provider.js";
import { createKv } from "../kv/service.js";
import { createFilesService, type FilesStore, type TicketIssuer } from "../files/service.js";
import { createFrameworkSecrets, createSecretsService, type SecretReader } from "../secrets/service.js";
import type { FrameworkSecretName } from "../secrets/names.js";
import { requestLogFactory } from "../log/request.js";
import type { LogSink } from "../log/writer.js";
import type { LogService } from "../log/public.js";
import type { MailSender } from "../mail/sender.js";
import { bindRequestMail } from "../mail/request.js";
import { adapterOf } from "../sql/handle.js";
import type { PortableDb } from "../sql/types.js";
import { frameworkTables } from "../mig/framework.js";

type Env = RuntimeEnv["Bindings"];

/** What one target supplies to run a stage. */
export interface StageOptions {
  /** The embedded resolved configuration (its `deployment` is the embedded identity). */
  readonly resolved: ResolvedConfig;
  /** Where log entries go on this target. */
  readonly sink: LogSink;
  /**
   * A sink built per request (it needs that request's bindings and `waitUntil`, as the
   * Cloudflare R2 log writer does); when given, it is used instead of `sink`.
   */
  readonly requestSink?: (c: RuntimeContext) => LogSink;
  /** The deployment's public origin, from deployment-time settings (never request headers). */
  readonly publicOrigin: (c: RuntimeContext) => string;
  /**
   * The SQL handles for one request: the app's (`sql`, given the request's log for
   * `SQL.UNAVAILABLE` entries) and KV's own handle on the same database (no log: KV logs its
   * own `KV.UNAVAILABLE`), DEC-0149.
   */
  readonly sql: (env: Env, log: LogService) => { readonly sql: PortableDb; readonly kv: PortableDb };
  /** The object store FILES uses (the R2 binding, or a stand-in). */
  readonly store: (env: Env) => FilesStore;
  /** The target's ticket issuer, given the framework-internal secrets of this request. */
  readonly tickets: (env: Env, frameworkSecret: (name: FrameworkSecretName) => Promise<string>) => TicketIssuer;
  /** Reader of the app's secrets. */
  readonly readSecret: (env: Env) => SecretReader;
  /** Reader of the framework-internal secrets. */
  readonly readFrameworkSecret: (env: Env) => SecretReader;
  /** Every secret value this request may hold, for redaction (HTTP). */
  readonly secretValues: (c: RuntimeContext) => Iterable<string>;
  /**
   * Framework-internal secrets the health check requires on this target. They are also readable
   * by framework code, which is how a target adds its own (locally `LOCAL_FRAMEWORK_SECRETS`).
   */
  readonly requiredFrameworkSecrets: readonly FrameworkSecretName[];
  /** AUTH's cookie settings; default the cloud ones (the local runtime passes `LOCAL_COOKIES`). */
  readonly cookies?: CookieSettings;
  /** The authentication mock: only locally and on test stages. */
  readonly mock?: AuthMock;
  /** The stage's real login provider (the auth-app provider, built per request), or the stub in tests. */
  readonly provider?: LoginProvider | ((c: RuntimeContext) => LoginProvider);
  /** Further framework routes under `/api` (the local file-transfer route, the test-stage test-mail route). */
  readonly routes?: (api: Hono<RuntimeEnv>) => void;
  /**
   * The stage's outgoing-mail sender for one request (MAIL §2): Email Service on production
   * stages, a capture everywhere else. It is bound to each request; the password provider (PWD)
   * sends through it with `sendRequestMail` (mail/request.ts), after the response.
   */
  readonly mail?: (c: RuntimeContext) => MailSender;
}

function requestLog(deployment: ResolvedConfig["deployment"], options: StageOptions): (c: RuntimeContext) => LogService {
  const { requestSink } = options;
  if (requestSink === undefined) return requestLogFactory(deployment, options.sink);
  return (c) => requestLogFactory(deployment, requestSink(c))(c);
}

/** Builds the stage's Hono app. Never throws for misconfiguration (checks are deferred to the first request). */
export function assembleStage<C extends ConfigDeclaration, S extends string>(defined: DefinedApp<C, S>, options: StageOptions): Hono<RuntimeEnv> {
  const { resolved } = options;
  const deployment = resolved.deployment;
  const declared = defined.definition.secrets as readonly string[];
  const config = createConfigService(resolved);

  const frameworkSecrets = (env: Env, log?: LogService) =>
    createFrameworkSecrets({ read: options.readFrameworkSecret(env), extra: options.requiredFrameworkSecrets, ...(log === undefined ? {} : { log }) });

  const healthChecks: HealthCheck[] = [
    // One trivial SQL read (the migration record exists once the framework history is applied).
    async (c) => {
      const db = c.var.sql as unknown as { select(): { from(t: unknown): { limit(n: number): Promise<unknown> } } };
      const dialect = adapterOf(c.var.sql)?.dialect ?? "sqlite";
      await db.select().from(frameworkTables(dialect).migrations).limit(1);
    },
    // Every declared app secret and every required framework secret has a value.
    async (c) => {
      for (const name of declared) await c.var.secrets.get(name as S);
      const framework = frameworkSecrets(c.env, c.var.log);
      for (const name of options.requiredFrameworkSecrets) await framework.get(name);
    },
  ];

  const http = createHttpParts({ healthChecks, secretValues: options.secretValues });
  const auth = createAuthParts({
    deployment,
    publicOrigin: options.publicOrigin,
    framework: resolved.email === undefined ? {} : { email: resolved.email },
    secret: (c, name) => frameworkSecrets(c.env, c.var.log).get(name as FrameworkSecretName),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.mock === undefined ? {} : { mock: options.mock }),
    ...(options.cookies === undefined ? {} : { cookies: options.cookies }),
  });

  const app = assembleApp(defined, {
    deployment,
    createLog: requestLog(deployment, options),
    createServices: (env, _deployment, log) => {
      const handles = options.sql(env, log);
      const framework = frameworkSecrets(env, log);
      return {
        sql: handles.sql,
        kv: createKv(handles.kv, { log }),
        files: createFilesService({ store: options.store(env), tickets: options.tickets(env, (name) => framework.get(name)), log }),
        config,
        secrets: createSecretsService({ declared, read: options.readSecret(env), log }),
      };
    },
    currentUser: auth.currentUser,
    forgeryCheck: auth.forgeryCheck,
    ...http.parts,
    frameworkRoutes: (api) => {
      const { mail } = options;
      if (mail !== undefined) {
        // Framework code sends through `requestMail`/`sendRequestMail` (mail/request.ts); the sender is made on first use.
        api.use(async (c, next) => {
          bindRequestMail(c, mail);
          await next();
        });
      }
      http.parts.frameworkRoutes?.(api);
      auth.routes(api);
      options.routes?.(api);
    },
  });
  http.attach(app);
  return app;
}
