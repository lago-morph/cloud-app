/**
 * Local target runtime (`./targets/local` subpath; importable by generated entry points only,
 * CORE-REQ-005): the Worker that `dev` runs under Wrangler. It uses the Cloudflare adapters
 * (local D1 and R2 bindings, `SECRET_<NAME>` from `.dev.vars`) with the local-only parts of
 * local.md §2: the authentication mock in place of a real provider, same-origin file transfers
 * through `/api/__framework/files/*` signed with `frameworkLocalTicketKey`, and log entries as
 * marked Worker output lines that `dev` captures into `.logs/` (DEC-0066), and the framework's
 * email likewise as marked lines that `dev` captures into `.mail/` (MAIL §2; nothing is sent and
 * no `send_email` binding is used). Workers-compatible.
 */
import type { RuntimeContext } from "../../core/assemble.js";
import type { DefinedApp } from "../../core/public.js";
import type { ConfigDeclaration } from "../../config/public.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import { createAuthMock } from "../../auth/mock.js";
import { workerOutputSink } from "../../log/local.js";
import { workerOutputMailSender } from "../../mail/local.js";
import { mailSenderName } from "../../mail/config.js";
import { createFrameworkSecrets, envSecretReader } from "../../secrets/service.js";
import { FRAMEWORK_SECRETS } from "../../secrets/names.js";
import { LOCAL_FRAMEWORK_SECRETS, LOCAL_TICKET_KEY } from "../../secrets/local-names.js";
import { LOCAL_COOKIES } from "../../auth/local-cookies.js";
import { createLocalTicketIssuer } from "../../files/local/tickets.js";
import { registerLocalTransferRoute } from "../../files/local/route.js";
import { workerPublicOrigin, workerSecretValues, workerSql, workerStore, type WorkerHandler } from "../cloudflare/bindings.js";
import { assembleStage } from "../stage.js";

export type { WorkerHandler } from "../cloudflare/bindings.js";

export function createLocalWorker<C extends ConfigDeclaration, S extends string>(app: DefinedApp<C, S>, resolved: ResolvedConfig): WorkerHandler {
  const target = "local";
  const ticketKey = (c: RuntimeContext) => createFrameworkSecrets({ read: envSecretReader(c.env, target), log: c.var.log, extra: LOCAL_FRAMEWORK_SECRETS }).get(LOCAL_TICKET_KEY);
  const mail = workerOutputMailSender({ senderName: mailSenderName(resolved) });
  const hono = assembleStage(app, {
    resolved,
    sink: workerOutputSink(),
    publicOrigin: (c) => workerPublicOrigin(c.env),
    sql: workerSql,
    store: workerStore,
    tickets: (_env, frameworkSecret) => createLocalTicketIssuer({ key: () => frameworkSecret(LOCAL_TICKET_KEY) }),
    readSecret: (env) => envSecretReader(env, target),
    readFrameworkSecret: (env) => envSecretReader(env, target),
    secretValues: (c) => workerSecretValues(c.env),
    requiredFrameworkSecrets: [FRAMEWORK_SECRETS.sessionKey, FRAMEWORK_SECRETS.authSecret, ...LOCAL_FRAMEWORK_SECRETS],
    cookies: LOCAL_COOKIES,
    mock: createAuthMock(),
    routes: (api) => registerLocalTransferRoute(api, { key: ticketKey }),
    mail: () => mail,
  });
  return { fetch: (request, env, ctx) => hono.fetch(request, env, ctx as never) };
}
