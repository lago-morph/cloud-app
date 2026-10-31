/**
 * Cloudflare target runtime (`./targets/cloudflare` subpath; importable by generated entry
 * points only, CORE-REQ-005). The generated entry passes the app definition and the embedded
 * resolved configuration; test-stage entries also pass `createAuthMock`, production entries
 * do not import it, so production bundles contain no mock (CORE-REQ-006, PROV-REQ-005). The
 * same holds for the test stages' mail capture and its `GET /api/__framework/test-mail` route
 * (`createTestMailCapture`, MAIL-REQ-002); production stages send through the Email Service
 * binding `EMAIL` from `FRAMEWORK_MAIL_FROM` instead.
 *
 * Log entries go to the account's shared log bucket through the `LOGS` binding, each write
 * handed to the request's `waitUntil` (LOG-REQ-004). Transfer tickets are SigV4-signed R2 URLs
 * (D-02) for the account and bucket the Worker variables name (`tickets.ts`). The R2 binding is
 * addressed through `cloudflareFilesStore`, which stores each name with a U+0001 ending so R2
 * lists in code point order (DEC-0430); the local target keeps plain keys.
 * Workers-compatible: no Node APIs.
 */
import type { RuntimeContext } from "../../core/assemble.js";
import type { DefinedApp } from "../../core/public.js";
import type { ConfigDeclaration } from "../../config/public.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import type { AuthMock, AuthMockOptions } from "../../auth/mock.js";
import type { TestMailCapture } from "../../mail/test-stage.js";
import { workerEmailSender } from "../../mail/cloudflare.js";
import { mailSenderName } from "../../mail/config.js";
import { workerOutputSink } from "../../log/local.js";
import { r2LogSink } from "../../log/cloudflare/sink.js";
import { envSecretReader } from "../../secrets/service.js";
import { FRAMEWORK_SECRETS, type FrameworkSecretName } from "../../secrets/names.js";
import { workerLogBucket, workerPublicOrigin, workerSecretValues, workerSql, workerStore, type WorkerHandler } from "./bindings.js";
import { cloudflareFilesStore } from "../../files/cloudflare/keys.js";
import { assembleStage } from "../stage.js";
import { workerTicketIssuer } from "./tickets.js";
import { workerAuthAppProvider } from "./auth-app.js";

export { createAuthMock } from "../../auth/mock.js";
export { createTestMailCapture } from "../../mail/test-stage.js";
export type { WorkerHandler } from "./bindings.js";

export interface CloudflareWorkerOptions {
  /** Test stages only: the authentication mock's factory (`createAuthMock`). */
  readonly mock?: (options?: AuthMockOptions) => AuthMock;
  /** Test stages only: the mail capture's factory (`createTestMailCapture`). */
  readonly testMail?: () => TestMailCapture;
}

export function createCloudflareWorker<C extends ConfigDeclaration, S extends string>(
  app: DefinedApp<C, S>,
  resolved: ResolvedConfig,
  options: CloudflareWorkerOptions = {},
): WorkerHandler {
  // Every stage's CLI generates both keys (deploy step 5); the health check requires them (PROV-REQ-002 step 7).
  const required: FrameworkSecretName[] = [FRAMEWORK_SECRETS.sessionKey, FRAMEWORK_SECRETS.authSecret];
  const senderName = mailSenderName(resolved);
  const capture = options.testMail?.();
  const hono = assembleStage(app, {
    resolved,
    sink: workerOutputSink(),
    requestSink: (c: RuntimeContext) => r2LogSink({ bucket: workerLogBucket(c.env), waitUntil: (pending) => c.executionCtx.waitUntil(pending) }),
    publicOrigin: (c: RuntimeContext) => workerPublicOrigin(c.env),
    sql: workerSql,
    store: (env) => cloudflareFilesStore(workerStore(env)),
    tickets: workerTicketIssuer,
    readSecret: (env) => envSecretReader(env, "cloudflare"),
    readFrameworkSecret: (env) => envSecretReader(env, "cloudflare"),
    secretValues: (c) => workerSecretValues(c.env),
    requiredFrameworkSecrets: required,
    // Production stages sign in with Cloudflare through the auth app (plan §4.1, DEC-0667); test
    // stages with the mock only (plan §4.3).
    ...(resolved.deployment.isTestStage ? {} : { provider: workerAuthAppProvider(resolved.deployment) }),
    ...(options.mock === undefined ? {} : { mock: options.mock() }),
    // A test stage captures its mail (and serves the test-mail route); only production sends.
    mail: (c: RuntimeContext) => (capture === undefined ? workerEmailSender(c.env, senderName) : capture.sender(c, senderName)),
    ...(capture === undefined ? {} : { routes: capture.routes }),
  });
  return { fetch: (request, env, ctx) => hono.fetch(request, env, ctx as never) };
}
