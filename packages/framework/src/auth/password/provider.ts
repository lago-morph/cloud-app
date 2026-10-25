/**
 * The email-and-password `CredentialProvider` (password.md §2 "Provider"; PWD-REQ-001…007;
 * DEC-0509, DEC-0510, DEC-0516). Framework-internal, Workers-compatible.
 *
 * `createPasswordProvider` is called per request over the request's SQL database. Each
 * operation builds one BA instance from the context (public origin, `frameworkAuthSecret`,
 * `waitUntil`), forwards one rebuilt request through the handler bridge, and maps BA's status
 * and code to the framework's own outcome: nothing of BA's answer is returned.
 *
 * - Every operation first checks `Origin` against the public origin itself (BA checks it only on
 *   sign-in and sign-up, P3), so a forged `Origin` is `AUTH.REQUEST_FORGERY` whatever AUTH did.
 * - Sign-up, resend and forgot resolve identically for an existing and an unknown address;
 *   sign-in answers one `AUTH.LOGIN_FAILED` for an unknown address and a wrong password.
 * - A sign-in's BA session row is deleted before `signIn` returns; BA's cookies never leave the
 *   bridge. AUTH issues the framework session (`deriveUserId("password", subject)`).
 * - A refusal is one `warn` entry, component `AUTH`, `login failed: <reason>`, with a fixed reason
 *   and never the address, password or token (AUTH-REQ-010).
 */
import { eq } from "drizzle-orm";
import { FrameworkError } from "../../core/errors.js";
import type { LogService } from "../../log/public.js";
import { FRAMEWORK_SECRETS } from "../../secrets/names.js";
import type { CredentialContext, CredentialProvider, ProviderIdentity } from "../login-provider.js";
import { forward, type BridgeAnswer, type BridgeRequest } from "./bridge.js";
import { mailLink, passwordMessage, sendLater, type MailSender } from "./mail.js";
import { BA_PATHS, createPasswordAuth, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type BaUser, type PasswordDatabase } from "./options.js";
import { authTables } from "./tables.js";

/** The provider's name: part of the user ID derivation (AUTH-REQ-002). */
export const PASSWORD_PROVIDER_ID = "password";

export interface PasswordProviderOptions {
  /** The request's SQL database (D1, or PGlite in `createTestApp`), with the framework migrations applied. */
  readonly database: PasswordDatabase;
  /** The request's log. */
  readonly log: LogService;
  /** MAIL's sender for this stage. */
  readonly mail: MailSender;
}

/** The fixed reasons of the failed-login entry (password.md §2 "Failed login log entry"). */
type Reason = "wrong credentials" | "not verified" | "rate limited" | "invalid token" | `provider unavailable (${string})`;

function invalidInput(message: string): FrameworkError {
  return new FrameworkError("HTTP.INVALID_INPUT", message);
}

function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw invalidInput(`the password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters long`);
  }
  return password;
}

/** Addresses are compared case-insensitively, as BA stores them. Not validated here: BA does that. */
function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function createPasswordProvider(options: PasswordProviderOptions): CredentialProvider {
  const { log, database } = options;

  function refuse(reason: Reason, error: FrameworkError): FrameworkError {
    log.write("AUTH", "warn", `login failed: ${reason}`);
    return error;
  }

  /** AUTH-REQ-007, P3: the provider's own check, on every operation. */
  function checkOrigin(ctx: CredentialContext): void {
    if (ctx.origin !== new URL(ctx.publicOrigin).origin) {
      throw new FrameworkError("AUTH.REQUEST_FORGERY", "a credential request came from another origin");
    }
  }

  async function call(ctx: CredentialContext, request: BridgeRequest): Promise<BridgeAnswer> {
    checkOrigin(ctx);
    const secret = await ctx.getSecret(FRAMEWORK_SECRETS.authSecret);
    const send = (kind: "verification" | "reset" | "existing", user: BaUser, link: string): void =>
      sendLater(ctx.waitUntil, options.mail, log, passwordMessage(kind, user.email, user.name, link));
    const auth = createPasswordAuth({
      database,
      publicOrigin: new URL(ctx.publicOrigin).origin,
      secret,
      waitUntil: ctx.waitUntil,
      log,
      mail: {
        verification: (user, token) => send("verification", user, mailLink(ctx.publicOrigin, "verify", token)),
        reset: (user, token) => send("reset", user, mailLink(ctx.publicOrigin, "reset", token)),
        existing: (user) => send("existing", user, mailLink(ctx.publicOrigin, "forgot")),
      },
    });
    const answer = await forward(auth, ctx, request);
    // Outcomes every operation shares.
    if (answer.status === 429) throw refuse("rate limited", new FrameworkError("AUTH.RATE_LIMITED", "too many attempts from this client"));
    if (answer.status === 403 && answer.code !== undefined && /ORIGIN|CSRF/.test(answer.code)) {
      throw new FrameworkError("AUTH.REQUEST_FORGERY", "the credential library refused the request's origin");
    }
    if (answer.status >= 500) throw unavailable(answer);
    return answer;
  }

  function unavailable(answer: BridgeAnswer): FrameworkError {
    return refuse(`provider unavailable (${answer.code ?? String(answer.status)})`, new FrameworkError("CORE.INTERNAL", `the credential library answered ${answer.status}`));
  }

  /** Sign-up, resend, forgot: one outcome whether or not the address has an account. */
  function sameForEveryAddress(answer: BridgeAnswer): void {
    if (answer.status === 200 || answer.status === 400) return; // 400: a malformed address; nothing was sent
    throw unavailable(answer);
  }

  return {
    id: PASSWORD_PROVIDER_ID,

    async signUp(ctx, input) {
      const password = checkPassword(input.password);
      const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
      if (displayName === "") throw invalidInput("a display name is required");
      const email = normalizeEmail(input.email);
      const answer = await call(ctx, { method: "POST", path: BA_PATHS.signUp, body: { email, password, name: displayName } });
      if (answer.status === 400 && answer.code !== undefined && /PASSWORD/.test(answer.code)) throw invalidInput("the password does not meet the length rule");
      if (answer.status === 400) throw invalidInput("the email address is not valid");
      sameForEveryAddress(answer);
    },

    async signIn(ctx, input): Promise<ProviderIdentity> {
      const email = normalizeEmail(input.email);
      const password = typeof input.password === "string" ? input.password : "";
      const answer = await call(ctx, { method: "POST", path: BA_PATHS.signIn, body: { email, password, rememberMe: false } });
      if (answer.status === 403 && answer.code === "EMAIL_NOT_VERIFIED") {
        throw refuse("not verified", new FrameworkError("AUTH.NOT_VERIFIED", "the account's email address has not been verified yet"));
      }
      const signedIn = answer.signIn;
      if (signedIn === undefined) {
        if (answer.status === 200) throw unavailable(answer);
        throw refuse("wrong credentials", new FrameworkError("AUTH.LOGIN_FAILED", "wrong email address or password"));
      }
      // PWD-REQ-003: BA's session must not outlive the request.
      const { session } = authTables(database.dialect);
      const db = database.db as { delete(table: unknown): { where(condition: unknown): Promise<unknown> } };
      await db.delete(session).where(eq(session.token, signedIn.token));
      return { subject: signedIn.userId, displayName: signedIn.name };
    },

    async sendVerification(ctx, input) {
      sameForEveryAddress(await call(ctx, { method: "POST", path: BA_PATHS.sendVerification, body: { email: normalizeEmail(input.email) } }));
    },

    async verify(ctx, input) {
      const token = typeof input.token === "string" ? input.token : "";
      if (token === "") throw refuse("invalid token", new FrameworkError("AUTH.LOGIN_FAILED", "the verification link is invalid or has expired"));
      // P4: BA's verify is GET only; the framework's POST becomes this server-side GET.
      const answer = await call(ctx, { method: "GET", path: BA_PATHS.verify, query: { token } });
      if (answer.status !== 200) throw refuse("invalid token", new FrameworkError("AUTH.LOGIN_FAILED", "the verification link is invalid or has expired"));
    },

    async requestReset(ctx, input) {
      sameForEveryAddress(await call(ctx, { method: "POST", path: BA_PATHS.requestReset, body: { email: normalizeEmail(input.email) } }));
    },

    async reset(ctx, input) {
      const newPassword = checkPassword(input.newPassword);
      const token = typeof input.token === "string" ? input.token : "";
      if (token === "") throw refuse("invalid token", new FrameworkError("AUTH.LOGIN_FAILED", "the reset link is invalid, used or expired"));
      const answer = await call(ctx, { method: "POST", path: BA_PATHS.reset, body: { token, newPassword } });
      if (answer.status === 400 && answer.code !== undefined && /PASSWORD/.test(answer.code)) throw invalidInput("the password does not meet the length rule");
      if (answer.status !== 200) throw refuse("invalid token", new FrameworkError("AUTH.LOGIN_FAILED", "the reset link is invalid, used or expired"));
    },
  };
}
