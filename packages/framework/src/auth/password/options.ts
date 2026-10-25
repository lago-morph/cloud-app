/**
 * The Better Auth (BA) instance of one request (password.md §2 "Where", "BA options";
 * DEC-0516, DEC-0517). Framework-internal, Workers-compatible.
 *
 * - Imported only as `better-auth/minimal` and `better-auth/adapters/drizzle` (RESULT.md P5):
 *   the bundle then references only `node:crypto` and `node:async_hooks`.
 * - The origin check and the rate limiter are forced on whatever `NODE_ENV` or `TEST` say
 *   (P1, P2), telemetry is off, and `baseURL` is the resolved public origin, never a request
 *   header (PWD-REQ-007).
 * - `sendOnSignIn` is off (P8): a refused sign-in sends nothing.
 * - BA's logger never writes BA's message text (P10): only a fixed reason.
 *
 * Nothing here is admin-related: admins stay in configuration (SYS-REQ-018), and BA's admin
 * plugin is not used. A later `role` field on the user model would be one `user.additionalFields`
 * entry here plus a column in `tables.ts`.
 */
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { LogService } from "../../log/public.js";
import type { Dialect } from "../../sql/dialect.js";
import { AUTH_MODEL_NAMES, authSchema } from "./tables.js";

/** Where BA believes it is mounted; only the bridge sends requests there (never the browser). */
export const PASSWORD_BASE_PATH = "/api/auth/password";

/** PAR-254, PAR-255: password length in characters, no composition rules (PWD-REQ-002). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** PAR-256: verification link validity, seconds. */
export const VERIFICATION_LINK_SECONDS = 24 * 3600;
/** PAR-257: reset link validity, seconds. */
export const RESET_LINK_SECONDS = 3600;

/** PWD-REQ-006: per client IP and BA path; `window` in seconds. */
export const RATE_LIMITS = {
  /** PAR-258 */
  signIn: { window: 60, max: 5 },
  /** PAR-259: sign-up, forgot and resend. */
  mailing: { window: 300, max: 3 },
  /** PAR-242: verify and reset submissions. */
  tokenSubmit: { window: 60, max: 10 },
  /** PAR-243: any other BA path. */
  other: { window: 60, max: 100 },
} as const;

/** BA's paths the bridge uses (relative to `PASSWORD_BASE_PATH`). */
export const BA_PATHS = {
  signUp: "/sign-up/email",
  signIn: "/sign-in/email",
  sendVerification: "/send-verification-email",
  verify: "/verify-email",
  requestReset: "/request-password-reset",
  reset: "/reset-password",
} as const;

/** The request's SQL database as BA's Drizzle adapter needs it: a plain Drizzle database of the dialect. */
export interface PasswordDatabase {
  readonly dialect: Dialect;
  /** `drizzle-orm/d1` over the D1 binding, or `drizzle-orm/pglite` over the harness. */
  readonly db: object;
}

/** A BA user as the mail hooks receive it. */
export interface BaUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/** What BA asks the framework to mail; each hook only schedules the send and returns at once. */
export interface PasswordMailHooks {
  verification(user: BaUser, token: string): void;
  reset(user: BaUser, token: string): void;
  existing(user: BaUser): void;
}

export interface PasswordAuthSettings {
  readonly database: PasswordDatabase;
  /** The deployment's resolved public origin (`https://host`, no path). */
  readonly publicOrigin: string;
  /** `frameworkAuthSecret` (SEC). */
  readonly secret: string;
  /** The request's background tasks. */
  readonly waitUntil: (work: Promise<unknown>) => void;
  readonly log: LogService;
  readonly mail: PasswordMailHooks;
}

/** The logger's one entry: a fixed reason, never BA's message (it can carry an address, P10). */
export const LIBRARY_ERROR_MESSAGE = "credential library error";

/** One BA instance (about 0.6 ms to build, RESULT.md S2) over the request's database. */
export function createPasswordAuth(settings: PasswordAuthSettings) {
  const { publicOrigin, mail } = settings;
  const provider = settings.database.dialect === "sqlite" ? "sqlite" : "pg";
  return betterAuth({
    baseURL: publicOrigin,
    basePath: PASSWORD_BASE_PATH,
    secret: settings.secret,
    trustedOrigins: [publicOrigin],
    telemetry: { enabled: false },
    logger: {
      level: "error",
      log: () => settings.log.write("AUTH", "error", LIBRARY_ERROR_MESSAGE),
    },
    database: drizzleAdapter(settings.database.db as never, { provider, schema: authSchema(settings.database.dialect) }),
    user: { modelName: AUTH_MODEL_NAMES.user },
    account: { modelName: AUTH_MODEL_NAMES.account },
    session: { modelName: AUTH_MODEL_NAMES.session },
    verification: { modelName: AUTH_MODEL_NAMES.verification },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: AUTH_MODEL_NAMES.rateLimit,
      window: RATE_LIMITS.other.window,
      max: RATE_LIMITS.other.max,
      customRules: {
        [BA_PATHS.signIn]: RATE_LIMITS.signIn,
        [BA_PATHS.signUp]: RATE_LIMITS.mailing,
        [BA_PATHS.requestReset]: RATE_LIMITS.mailing,
        [BA_PATHS.sendVerification]: RATE_LIMITS.mailing,
        [BA_PATHS.verify]: RATE_LIMITS.tokenSubmit,
        [BA_PATHS.reset]: RATE_LIMITS.tokenSubmit,
      },
    },
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      backgroundTasks: { handler: settings.waitUntil },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_LINK_SECONDS,
      sendResetPassword: ({ user, token }) => {
        mail.reset(user, token);
        return Promise.resolve();
      },
      onExistingUserSignUp: ({ user }) => {
        mail.existing(user);
        return Promise.resolve();
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: VERIFICATION_LINK_SECONDS,
      sendVerificationEmail: ({ user, token }) => {
        mail.verification(user, token);
        return Promise.resolve();
      },
    },
  });
}

export type PasswordAuth = ReturnType<typeof createPasswordAuth>;
