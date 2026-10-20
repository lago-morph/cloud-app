/**
 * Cloudflare target runtime (`./targets/cloudflare` subpath; importable by generated entry
 * points only, CORE-REQ-005). The generated entry passes the app definition and the embedded
 * resolved configuration; test-stage entries also pass `createAuthMock`, production entries
 * do not import it, so production bundles contain no mock (CORE-REQ-006, PROV-REQ-005).
 *
 * Log entries go to the account's shared log bucket through the `LOGS` binding, each write
 * handed to the request's `waitUntil` (LOG-REQ-004). Transfer tickets are SigV4-signed R2 URLs
 * (D-02) for the account and bucket the Worker variables name (`tickets.ts`).
 * Workers-compatible: no Node APIs.
 */
import type { RuntimeContext } from "../../core/assemble.js";
import type { DefinedApp } from "../../core/public.js";
import type { ConfigDeclaration } from "../../config/public.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import type { AuthMock, AuthMockOptions } from "../../auth/mock.js";
import { createGoogleLoginProvider } from "../../google/provider.js";
import { workerOutputSink } from "../../log/local.js";
import { r2LogSink } from "../../log/cloudflare/sink.js";
import { envSecretReader } from "../../secrets/service.js";
import { FRAMEWORK_SECRETS, type FrameworkSecretName } from "../../secrets/names.js";
import { workerLogBucket, workerPublicOrigin, workerSecretValues, workerSql, workerStore, type WorkerHandler } from "./bindings.js";
import { assembleStage } from "./stage.js";
import { workerTicketIssuer } from "./tickets.js";

export { createAuthMock } from "../../auth/mock.js";
export type { WorkerHandler } from "./bindings.js";

export interface CloudflareWorkerOptions {
  /** Test stages only: the authentication mock's factory (`createAuthMock`). */
  readonly mock?: (options?: AuthMockOptions) => AuthMock;
}

export function createCloudflareWorker<C extends ConfigDeclaration, S extends string>(
  app: DefinedApp<C, S>,
  resolved: ResolvedConfig,
  options: CloudflareWorkerOptions = {},
): WorkerHandler {
  const { deployment } = resolved;
  const production = !deployment.isTestStage;
  const required: FrameworkSecretName[] = [FRAMEWORK_SECRETS.sessionKey];
  if (production) required.push(FRAMEWORK_SECRETS.googleClientSecret);
  const hono = assembleStage(app, {
    resolved,
    sink: workerOutputSink(),
    requestSink: (c: RuntimeContext) => r2LogSink({ bucket: workerLogBucket(c.env), waitUntil: (pending) => c.executionCtx.waitUntil(pending) }),
    publicOrigin: (c: RuntimeContext) => workerPublicOrigin(c.env),
    sql: workerSql,
    store: workerStore,
    tickets: workerTicketIssuer,
    readSecret: (env) => envSecretReader(env, deployment.target),
    readFrameworkSecret: (env) => envSecretReader(env, deployment.target),
    secretValues: (c) => workerSecretValues(c.env),
    requiredFrameworkSecrets: required,
    // Production stages log in with Google; a test stage uses the mock unless it configures Google.
    ...(production || resolved.google !== undefined ? { provider: createGoogleLoginProvider() } : {}),
    ...(options.mock === undefined ? {} : { mock: options.mock() }),
  });
  return { fetch: (request, env, ctx) => hono.fetch(request, env, ctx as never) };
}
