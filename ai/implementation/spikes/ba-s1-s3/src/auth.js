// One BA instance per request (plan-auth §1 "Calling BA"). Shared by the Worker and the Node/PGlite runs.
import { betterAuth } from "better-auth/minimal"; // not "better-auth": that pulls in kysely (~185 KiB min) for adapter auto-detection
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export const BASE_PATH = "/api/auth/password";
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/**
 * @param {object} o
 * @param {any} o.db          Drizzle database (drizzle-orm/d1 or drizzle-orm/pglite)
 * @param {"sqlite"|"pg"} o.provider
 * @param {Record<string, any>} o.schema
 * @param {string} o.origin   resolved public origin (never from request headers)
 * @param {string} o.secret
 * @param {{ send(kind: string, to: string, url: string, token: string): Promise<void> }} o.mail
 * @param {(p: Promise<unknown>) => void} [o.background]  ctx.waitUntil
 * @param {"default"|"node"|"noble"} [o.hasher]
 * @param {Record<string, {window: number, max: number}>} [o.rules]
 */
export function makeAuth(o) {
  const password = o.hasher && o.hasher !== "default" ? o.hashers[o.hasher] : undefined;
  return betterAuth({
    appName: "spike",
    baseURL: o.origin,
    basePath: BASE_PATH,
    secret: o.secret,
    trustedOrigins: [o.origin],
    telemetry: { enabled: false },
    database: drizzleAdapter(o.db, { provider: o.provider, schema: o.schema }),
    user: { modelName: "__framework_auth_user" },
    session: { modelName: "__framework_auth_session" },
    account: { modelName: "__framework_auth_account" },
    verification: { modelName: "__framework_auth_verification" },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "__framework_auth_rate_limit",
      window: 60,
      max: 100,
      customRules: o.rules ?? {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 300, max: 3 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
        "/verify-email": { window: 60, max: 10 },
        "/reset-password": { window: 60, max: 10 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      // BA turns the origin check OFF when NODE_ENV=test or TEST is truthy (createTestApp under vitest!).
      ...(o.baDefaultOriginCheck ? {} : { disableOriginCheck: false }),
      ...(o.background ? { backgroundTasks: { handler: o.background } } : {}),
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      ...(password ? { password } : {}),
      sendResetPassword: async ({ user, url, token }) => o.mail.send("reset", user.email, url, token),
      onExistingUserSignUp: async ({ user }) => o.mail.send("existing", user.email, "", ""),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 86400,
      sendVerificationEmail: async ({ user, url, token }) => o.mail.send("verify", user.email, url, token),
    },
  });
}
