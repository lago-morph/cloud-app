/**
 * Sign-in with Cloudflare on a Worker (plan-v0.2.0 §3, §4.1; DEC-0667): the auth-app provider
 * built per request over the `AUTH` service binding, with the auth app's origin from the
 * `FRAMEWORK_AUTH_APP_ORIGIN` variable and the app ID `<app>-<stage>` (the Worker name, which
 * `deploy` registers with the auth app together with `<public origin>/api/auth/callback`).
 * Both settings are read on first use, so a missing one is `CORE.MISCONFIGURED` for the request
 * that needs it, never at startup. Workers-compatible.
 */
import type { RuntimeContext, RuntimeEnv } from "../../core/assemble.js";
import { FrameworkError } from "../../core/errors.js";
import type { Deployment } from "../../core/identity.js";
import type { AuthAppBinding } from "../../auth/auth-app-binding.js";
import { createAuthAppProvider } from "../../auth/auth-app-provider.js";
import type { LoginProvider } from "../../auth/login-provider.js";
import { BINDINGS } from "./bindings.js";

type Env = RuntimeEnv["Bindings"];

/** The app's ID at the auth app: the Worker name (provision/cloudflare/names.ts `workerName`). */
export function authAppId(deployment: Pick<Deployment, "app" | "stage">): string {
  return `${deployment.app}-${deployment.stage}`;
}

function authAppBinding(env: Env): AuthAppBinding {
  const value = env[BINDINGS.authApp] as Partial<AuthAppBinding> | undefined | null;
  if (typeof value?.redeem !== "function" || typeof value.role !== "function") {
    throw new FrameworkError("CORE.MISCONFIGURED", `the Worker has no auth-app service binding ${JSON.stringify(BINDINGS.authApp)}`);
  }
  return value as AuthAppBinding;
}

function authAppOrigin(env: Env): string {
  const value = env[BINDINGS.authAppOrigin];
  if (typeof value !== "string" || value === "") {
    throw new FrameworkError("CORE.MISCONFIGURED", `the Worker variable ${BINDINGS.authAppOrigin} (the auth app's origin) is not set`);
  }
  return value;
}

/** The stage's auth-app provider for one request. */
export function workerAuthAppProvider(deployment: Deployment): (c: RuntimeContext) => LoginProvider {
  const app = authAppId(deployment);
  return (c) =>
    createAuthAppProvider({
      // Looked up per call: a missing binding fails the call that needs it (a role read then counts as failed).
      binding: { redeem: (input) => authAppBinding(c.env).redeem(input), role: (sub) => authAppBinding(c.env).role(sub) },
      app,
      get authAppOrigin() {
        return authAppOrigin(c.env);
      },
    });
}
