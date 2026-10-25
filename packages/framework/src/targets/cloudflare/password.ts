/**
 * The password provider (PWD) on a Worker, shared by the local and Cloudflare runtimes
 * (password.md §2 "Where"; local.md §2: the local target uses the Cloudflare adapters). Built
 * per request over that request's D1 binding (BA's Drizzle adapter, sqlite), the request's log,
 * and the mail sender the stage runtime bound to the request (MAIL §2: Email Service on
 * production stages, a capture elsewhere). The provider reads `frameworkAuthSecret` through
 * AUTH's context (SEC). Workers-compatible.
 */
import { drizzle } from "drizzle-orm/d1";
import type { RuntimeContext } from "../../core/assemble.js";
import { FrameworkError } from "../../core/errors.js";
import type { CredentialProvider } from "../../auth/login-provider.js";
import { createPasswordProvider } from "../../auth/password/provider.js";
import { requestMailSender } from "../../mail/request.js";
import { workerD1 } from "./bindings.js";

export function workerCredentialProvider(c: RuntimeContext): CredentialProvider {
  const mail = requestMailSender(c);
  if (mail === undefined) throw new FrameworkError("CORE.MISCONFIGURED", "this stage has no mail sender for the password provider");
  return createPasswordProvider({ database: { dialect: "sqlite", db: drizzle(workerD1(c.env)) }, log: c.var.log, mail });
}
