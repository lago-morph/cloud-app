/**
 * The Cloudflare stage's transfer-ticket issuer (`StageOptions.tickets`): D-02's
 * `createWorkerTicketIssuer`, addressed by the account ID and stage bucket name that `deploy`
 * delivers as the plain-text Worker variables `FRAMEWORK_R2_ACCOUNT_ID` and
 * `FRAMEWORK_FILES_BUCKET` (DEC-0353). The variables are read when a ticket is
 * created, so a Worker without them still serves every other request; creating a ticket then
 * fails with `CORE.MISCONFIGURED`. Workers-compatible.
 */
import type { RuntimeEnv } from "../../core/assemble.js";
import { FrameworkError } from "../../core/errors.js";
import { createWorkerTicketIssuer } from "../../files/cloudflare/tickets.js";
import type { TicketIssuer } from "../../files/service.js";
import type { FrameworkSecretName } from "../../secrets/names.js";
import { BINDINGS } from "./bindings.js";

type Env = RuntimeEnv["Bindings"];

function variable(env: Env, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value === "") {
    throw new FrameworkError("CORE.MISCONFIGURED", `the Worker variable ${name} is not set, so file transfer tickets cannot be signed; deploy the stage again`);
  }
  return value;
}

export function workerTicketIssuer(env: Env, frameworkSecret: (name: FrameworkSecretName) => Promise<string>): TicketIssuer {
  const issuer = () => createWorkerTicketIssuer({ accountId: variable(env, BINDINGS.r2AccountId), bucket: variable(env, BINDINGS.filesBucket) }, frameworkSecret);
  return {
    upload: async (name, contentType) => issuer().upload(name, contentType),
    download: async (name, contentType) => issuer().download(name, contentType),
  };
}
