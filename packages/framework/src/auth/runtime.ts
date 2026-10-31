/**
 * AUTH's runtime parts for `assembleApp` (core.md §2 "Runtime assembly"): the current-user
 * middleware, the request forgery check, and the `/api/auth/*` routes. Framework-internal; the
 * target runtimes (B-16) call `createAuthParts` and register `routes` inside the assembler's
 * `frameworkRoutes` slot. Workers-compatible.
 */
import type { Hono, MiddlewareHandler } from "hono";
import type { RuntimeContext, RuntimeEnv } from "../core/assemble.js";
import { FrameworkError } from "../core/errors.js";
import type { Deployment } from "../core/identity.js";
import { FRAMEWORK_SECRETS } from "../secrets/names.js";
import { deferredCheck } from "../core/deferred.js";
import { clearCookie, cookieSettings, readCookie, setCookie, type CookieSettings } from "./cookies.js";
import { levelFromAccount } from "./levels.js";
import type { AccountStatus, CredentialContext, CredentialProvider, LoginProvider, ProviderContext, ProviderIdentity } from "./login-provider.js";
import { MOCK_DEFAULT_IDS } from "./mock-ids.js";
import { PAGES } from "./password/pages.js";
import { registerPasswordRoutes } from "./password/routes.js";
import type { AuthMock } from "./mock.js";
import type { CurrentUser } from "./public.js";
import { sanitizeReturnTo } from "./return-to.js";
import { SESSION_LIFETIME_SECONDS, isMockSession, issueSession, readSession, type ProviderSessionData, type SessionData } from "./session.js";
import { LOGIN_LIFETIME_SECONDS, issueTransaction, readTransaction } from "./transaction.js";
import { deriveUserId } from "./user-id.js";

export interface AuthOptions {
  readonly deployment: Deployment;
  /** The deployment's resolved public origin (never request headers), e.g. `http://localhost:8787`. */
  readonly publicOrigin: string | ((c: RuntimeContext) => string);
  /**
   * The stage's `framework` configuration, read by providers through `getConfig`. It holds no
   * admin or users list (DEC-0521, DEC-0522): the level comes from the account (AUTH-REQ-003).
   */
  readonly framework?: Readonly<Record<string, unknown>>;
  /** Reads a framework-internal secret (SEC) for this request: the session key and provider secrets. */
  readonly secret: (c: RuntimeContext, name: string) => Promise<string>;
  /**
   * The stage's redirect login provider: the auth-app provider on production Cloudflare stages
   * (plan §4.1), the stub in some tests. A function builds it per request, over that request's
   * bindings (`env.AUTH`, DEC-0667).
   */
  readonly provider?: LoginProvider | ((c: RuntimeContext) => LoginProvider);
  /**
   * The stage's credential provider (PWD), built per request over that request's SQL database
   * (DEC-0510). AUTH derives the user ID from its `id` and subject and issues the session.
   */
  readonly credentialProvider?: (c: RuntimeContext) => CredentialProvider;
  /** The authentication mock: only locally and on test stages. */
  readonly mock?: AuthMock;
  /** Cookie settings; default: the cloud settings. The local runtime passes `LOCAL_COOKIES`; non-Secure settings on a cloud target are CORE.MISCONFIGURED. */
  readonly cookies?: CookieSettings;
}

/**
 * The credential operations the password routes call (password.md §2, auth.md §2 "Credential
 * login"), each over the request's credential provider and a context AUTH builds. Only
 * `signIn` creates a session: on success it appends the framework session cookie to the
 * response (`c.header("Set-Cookie", ...)`), with the user ID `deriveUserId(provider.id, subject)`.
 * Failures are the provider's FrameworkErrors (internal/login-provider.d.ts).
 */
export interface CredentialOperations {
  /** The context handed to the provider for this request. */
  context(c: RuntimeContext): CredentialContext;
  signUp(c: RuntimeContext, input: { readonly email: string; readonly password: string; readonly displayName: string }): Promise<void>;
  /** Validates the credentials, sets the session cookie, and returns the derived user ID. */
  signIn(c: RuntimeContext, input: { readonly email: string; readonly password: string }): Promise<{ readonly id: string }>;
  sendVerification(c: RuntimeContext, input: { readonly email: string }): Promise<void>;
  verify(c: RuntimeContext, input: { readonly token: string }): Promise<void>;
  requestReset(c: RuntimeContext, input: { readonly email: string }): Promise<void>;
  reset(c: RuntimeContext, input: { readonly token: string; readonly newPassword: string }): Promise<void>;
}

export interface AuthParts {
  readonly currentUser: MiddlewareHandler<RuntimeEnv>;
  readonly forgeryCheck: MiddlewareHandler<RuntimeEnv>;
  /** Registers `/auth/*` on the framework's `/api` router. */
  readonly routes: (api: Hono<RuntimeEnv>) => void;
  /** Present when the stage has a credential provider. */
  readonly credentials: CredentialOperations | undefined;
}

/** CredentialContext.clientIp where the request has no `CF-Connecting-IP` (locally, createTestApp). */
export const LOCAL_CLIENT_IP = "127.0.0.1";

const ANONYMOUS: CurrentUser = Object.freeze({ level: "anonymous" });
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Every POST under this path needs the public origin, session or not (AUTH-REQ-007, DEC-0516). */
const AUTH_PREFIX = "/api/auth/";

/** Only codes of this shape are logged (`SQL.UNAVAILABLE`, `SQLITE_ERROR`, ...); never an error's text. */
const ERROR_CODE = /^[A-Z][A-Z0-9_.]{0,63}$/;

/** The code named by `role lookup failed (<code>)`: the error's code, or `unknown`. */
export function lookupErrorCode(thrown: unknown): string {
  const code = typeof thrown === "object" && thrown !== null ? (thrown as { code?: unknown }).code : undefined;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "unknown";
}

/** Dotted-path read for the provider's `getConfig` (e.g. `framework.email.senderName`). */
function lookup(root: unknown, key: string): unknown {
  let value = root;
  for (const part of key.split(".")) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

/**
 * The wiring checks for AUTH (also callable by the build): the mock is allowed only locally and on
 * test stages (AUTH-REQ-009), and the local cookie settings only on the local target
 * (LOCAL-REQ-004). Throws CORE.MISCONFIGURED; returns the cookie settings.
 */
export function checkAuthSettings(options: Pick<AuthOptions, "deployment" | "mock" | "cookies">): CookieSettings {
  const { deployment } = options;
  if (options.mock !== undefined && deployment.target !== "local" && !deployment.isTestStage) {
    throw new FrameworkError("CORE.MISCONFIGURED", `the authentication mock is not allowed on production stage "${deployment.stage}"`);
  }
  return cookieSettings(deployment.target, options.cookies);
}

export function createAuthParts(options: AuthOptions): AuthParts {
  const cookies = deferredCheck(() => checkAuthSettings(options));
  const { mock } = options;

  function originOf(c: RuntimeContext): string {
    const configured = typeof options.publicOrigin === "string" ? options.publicOrigin : options.publicOrigin(c);
    return new URL(configured).origin;
  }

  /** The stage's redirect provider for this request, if it has one. */
  function providerFor(c: RuntimeContext): LoginProvider | undefined {
    const { provider } = options;
    return typeof provider === "function" ? provider(c) : provider;
  }

  function sessionKey(c: RuntimeContext): Promise<string> {
    return options.secret(c, FRAMEWORK_SECRETS.sessionKey);
  }

  async function issueSessionCookie(c: RuntimeContext, data: SessionData): Promise<string> {
    const token = await issueSession(await sessionKey(c), data, Date.now());
    return setCookie(cookies(), cookies().session, token, SESSION_LIFETIME_SECONDS);
  }

  /** AUTH-REQ-008: the callback URL comes from the resolved public origin, never from request headers. */
  function providerContext(c: RuntimeContext): ProviderContext {
    const config = { framework: options.framework ?? {} };
    return {
      callbackUrl: `${originOf(c)}/api/auth/callback`,
      getSecret: (name) => options.secret(c, name),
      getConfig: (key) => lookup(config, key),
    };
  }

  function credentialContext(c: RuntimeContext): CredentialContext {
    const config = { framework: options.framework ?? {} };
    return {
      publicOrigin: originOf(c),
      origin: c.req.header("origin") ?? "",
      clientIp: c.req.header("cf-connecting-ip") ?? LOCAL_CLIENT_IP,
      userAgent: c.req.header("user-agent") ?? null,
      waitUntil: (work) => {
        try {
          c.executionCtx.waitUntil(work);
        } catch {
          // No execution context (Hono throws): the work still runs to completion on its own.
          work.catch(() => undefined);
        }
      },
      getSecret: (name) => options.secret(c, name),
      getConfig: (key) => lookup(config, key),
    };
  }

  function credentialOperations(factory: (c: RuntimeContext) => CredentialProvider): CredentialOperations {
    return {
      context: credentialContext,
      signUp: (c, input) => factory(c).signUp(credentialContext(c), input),
      async signIn(c, input) {
        const provider = factory(c);
        const identity = await provider.signIn(credentialContext(c), input);
        const id = await deriveUserId(provider.id, identity.subject);
        const session = { id, displayName: identity.displayName, provider: provider.id, subject: identity.subject };
        c.header("Set-Cookie", await issueSessionCookie(c, session), { append: true });
        return { id };
      },
      sendVerification: (c, input) => factory(c).sendVerification(credentialContext(c), input),
      verify: (c, input) => factory(c).verify(credentialContext(c), input),
      requestReset: (c, input) => factory(c).requestReset(credentialContext(c), input),
      reset: (c, input) => factory(c).reset(credentialContext(c), input),
    };
  }

  async function identify(c: RuntimeContext): Promise<CurrentUser> {
    const fixed = mock?.fixedUser(c);
    if (fixed !== undefined) return fixed;
    const token = readCookie(c.req.header("cookie"), cookies().session);
    if (token === undefined) return ANONYMOUS;
    const key = await options.secret(c, FRAMEWORK_SECRETS.sessionKey);
    const data = await readSession(key, token, Date.now());
    if (data === undefined) return ANONYMOUS;
    if (isMockSession(data)) {
      // AUTH-REQ-009: the mock's level is used directly, with no read; only where the mock is installed.
      return mock === undefined ? ANONYMOUS : { level: data.mockLevel, id: data.id, displayName: data.displayName };
    }
    return levelOf(c, data);
  }

  /**
   * AUTH-REQ-003, DEC-0524: a valid real-provider session's level, from one read of its account
   * through the session's provider. A provider the stage does not install is anonymous (fail closed); a failed read is anonymous with one `warn` entry.
   */
  async function levelOf(c: RuntimeContext, session: ProviderSessionData): Promise<CurrentUser> {
    let read: ((subject: string) => Promise<AccountStatus | null>) | undefined;
    const credential = options.credentialProvider?.(c);
    if (credential !== undefined && credential.id === session.provider) read = (subject) => credential.accountStatus(subject);
    else {
      const provider = providerFor(c);
      if (provider !== undefined && provider.id === session.provider) read = (subject) => provider.accountStatus(subject);
    }
    if (read === undefined) return ANONYMOUS;
    let status: AccountStatus | null;
    try {
      status = await read(session.subject);
    } catch (thrown) {
      c.var.log.write("AUTH", "warn", `role lookup failed (${lookupErrorCode(thrown)})`);
      return ANONYMOUS;
    }
    return levelFromAccount(session, status);
  }

  const credentials = options.credentialProvider === undefined ? undefined : credentialOperations(options.credentialProvider);

  return {
    credentials,
    currentUser: async (c, next) => {
      cookies();
      c.set("user", await identify(c));
      await next();
    },
    forgeryCheck: async (c, next) => {
      // AUTH-REQ-007, DEC-0072: Origin must equal the public origin on a state-changing request
      // that carries a session (any session cookie, valid or not, or the mock's fixed login).
      // DEC-0516: and on every POST under /api/auth/, with or without a session, so that no
      // sign-in, sign-up, verification, reset or resend can be submitted from another site.
      if (STATE_CHANGING.has(c.req.method)) {
        const authPost = c.req.method === "POST" && c.req.path.startsWith(AUTH_PREFIX);
        const carriesSession = readCookie(c.req.header("cookie"), cookies().session) !== undefined || c.var.user.level !== "anonymous";
        if ((authPost || carriesSession) && c.req.header("origin") !== originOf(c)) {
          throw new FrameworkError(
            "AUTH.REQUEST_FORGERY",
            carriesSession ? "a state-changing request with a session came from another origin" : "a login request came from another origin",
          );
        }
      }
      await next();
    },
    routes: (api) => {
      api.use("/auth/*", async (c, next) => {
        await next();
        c.res.headers.set("Cache-Control", "no-store");
      });

      api.get("/auth/login", async (c) => {
        const returnTo = sanitizeReturnTo(c.req.query("returnTo"));
        if (credentials !== undefined) {
          // DEC-0516: the credential provider is on every stage, so login is its sign-in page.
          const query = returnTo === "/" ? "" : `?${new URLSearchParams({ returnTo }).toString()}`;
          return c.redirect(`${PAGES.signIn}${query}`, 302);
        }
        const provider = providerFor(c);
        if (provider === undefined) {
          // Only createTestApp's mock-only app gets here (no stage lacks the credential provider).
          if (mock === undefined) throw new FrameworkError("CORE.MISCONFIGURED", "no login provider is configured for this deployment");
          // Mock only: log in as the mock's default user (local development and test stages).
          c.header("Set-Cookie", await issueSessionCookie(c, { id: MOCK_DEFAULT_IDS.user, displayName: null, mockLevel: "user" }), { append: true });
          return c.redirect(returnTo, 302);
        }
        const begun = await provider.beginLogin(providerContext(c));
        const key = await sessionKey(c);
        const tx = await issueTransaction(key, { state: begun.transactionState, returnTo }, Date.now());
        // A new login replaces any login in progress (same cookie name).
        c.header("Set-Cookie", setCookie(cookies(), cookies().login, tx, LOGIN_LIFETIME_SECONDS), { append: true });
        return c.redirect(begun.redirectUrl, 302);
      });

      api.get("/auth/callback", async (c) => {
        // The transaction is spent whatever happens.
        c.header("Set-Cookie", clearCookie(cookies(), cookies().login), { append: true });
        const failed = (reason: string) => {
          c.var.log.write("AUTH", "warn", `login failed: ${reason}`);
          const query = new URLSearchParams({ authError: "login_failed", requestId: c.var.requestId });
          return c.redirect(`/?${query.toString()}`, 302);
        };
        const token = readCookie(c.req.header("cookie"), cookies().login);
        const key = await sessionKey(c);
        const tx = token === undefined ? undefined : await readTransaction(key, token, Date.now());
        const provider = providerFor(c);
        if (tx === undefined || provider === undefined) return failed("transaction missing or expired");
        let identity: ProviderIdentity;
        try {
          identity = await provider.completeLogin(providerContext(c), new URL(c.req.url).searchParams, tx.state);
        } catch (thrown) {
          if (thrown instanceof FrameworkError && thrown.code === "AUTH.LOGIN_FAILED") return failed(thrown.message);
          throw thrown;
        }
        const id = await deriveUserId(provider.id, identity.subject);
        const session = { id, displayName: identity.displayName, provider: provider.id, subject: identity.subject };
        c.header("Set-Cookie", await issueSessionCookie(c, session), { append: true });
        return c.redirect(tx.returnTo, 302);
      });

      api.post("/auth/logout", (c) => {
        c.header("Set-Cookie", clearCookie(cookies(), cookies().session), { append: true });
        return c.body(null, 204);
      });

      if (credentials !== undefined) registerPasswordRoutes(api, credentials);

      mock?.registerRoutes(api, {
        issue: issueSessionCookie,
        clear: () => clearCookie(cookies(), cookies().session),
      });

      // AUTH-REQ-005: the level and user ID; there is no `unlistedId` (DEC-0522).
      api.get("/auth/me", (c) => {
        c.header("Cache-Control", "no-store");
        return c.json(c.var.user);
      });
    },
  };
}
