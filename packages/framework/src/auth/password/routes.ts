/**
 * The password provider's routes (password.md §2 "Routes and pages", "Answers";
 * internal/auth-password.openapi.yaml). Registered by AUTH on the framework's `/api` router when
 * the stage has a credential provider.
 *
 * - GET pages: `sign-in`, `sign-up`, `forgot`, `verify?token=`, `reset?token=` (pages.ts).
 * - POST endpoints under `password/`: each validates its body (JSON or a form), calls AUTH's
 *   credential operation, and answers JSON when the request has `Accept: application/json`,
 *   otherwise a 303 to a page. Refusals are the catalogue's errors in JSON, or a 303 to a page
 *   with a generic message for a form. Nothing of the provider's answer is forwarded.
 * - The request forgery check (AUTH-REQ-007) has already run: every POST under `/api/auth/`
 *   needs `Origin` equal to the public origin, with or without a session.
 * - Bodies and answers never carry an address back (PWD-REQ-005), and the answers of sign-up,
 *   resend and forgot are fixed, so they are identical for an existing and an unknown address.
 *
 * Imports no credential library: the provider is built by the target and reached through
 * `CredentialOperations`. Framework-internal, Workers-compatible.
 */
import type { Context, Hono } from "hono";
import type { RuntimeContext, RuntimeEnv } from "../../core/assemble.js";
import { FrameworkError } from "../../core/errors.js";
import { readLimitedText } from "../../http/validation.js";
import type { CredentialOperations } from "../runtime.js";
import { sanitizeReturnTo } from "../return-to.js";
import { RATE_LIMITS } from "./options.js";
import { ENDPOINTS, forgotPage, PAGES, resetPage, signInPage, signUpPage, verifyPage, type PageError } from "./pages.js";

type Fields = Readonly<Record<string, string>>;

function invalid(message: string): FrameworkError {
  return new FrameworkError("HTTP.INVALID_INPUT", message);
}

function wantsJson(c: Context): boolean {
  return (c.req.header("accept") ?? "").toLowerCase().includes("application/json");
}

/**
 * The body's string fields. JSON bodies follow the contract's schemas exactly (an object of
 * strings, the required fields present, no other field); form bodies need the required fields
 * and ignore any other. Messages name fields, never values.
 */
async function readFields(c: Context, required: readonly string[], optional: readonly string[] = []): Promise<Fields> {
  const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const text = await readLimitedText(c.req.raw);
  const out: Record<string, string> = {};
  if (type === "application/json") {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw invalid("request body is not valid JSON");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("body: expected an object");
    const known = new Set([...required, ...optional]);
    for (const [key, v] of Object.entries(value)) {
      if (!known.has(key)) throw invalid(`body.${key}: unknown field`);
      if (typeof v !== "string") throw invalid(`body.${key}: expected a string`);
      out[key] = v;
    }
  } else if (type === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(text);
    for (const key of [...required, ...optional]) {
      const v = form.get(key);
      if (v !== null) out[key] = v;
    }
  } else {
    throw invalid("the body must be JSON or a form (application/x-www-form-urlencoded)");
  }
  for (const key of required) if (out[key] === undefined) throw invalid(`body.${key}: required`);
  return out;
}

/** The page message of a refusal; undefined for an error that is not a refusal (it is rethrown). */
function pageError(thrown: unknown): PageError | undefined {
  if (!(thrown instanceof FrameworkError)) return undefined;
  switch (thrown.code) {
    case "AUTH.LOGIN_FAILED":
      return "login_failed";
    case "AUTH.NOT_VERIFIED":
      return "not_verified";
    case "AUTH.RATE_LIMITED":
      return "rate_limited";
    case "AUTH.REQUEST_FORGERY":
      return "forgery";
    case "HTTP.INVALID_INPUT":
      return "invalid_input";
    default:
      return undefined;
  }
}

function withQuery(path: string, query: Readonly<Record<string, string | undefined>>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, v);
  const search = params.toString();
  return search === "" ? path : `${path}?${search}`;
}

interface Endpoint {
  readonly path: string;
  readonly required: readonly string[];
  readonly optional?: readonly string[];
  /** PWD-REQ-006's window for this operation, in seconds: the 429's `Retry-After`. */
  readonly retryAfter: number;
  /** Runs the operation; returns the JSON success body and the form's 303 target. */
  run(c: RuntimeContext, fields: Fields): Promise<{ readonly json: Readonly<Record<string, string>>; readonly location: string }>;
  /** The form's 303 target for a refusal. */
  refused(error: PageError, fields: Partial<Fields>): string;
}

const CHECK_EMAIL = { json: { result: "check-email" }, location: withQuery(PAGES.signIn, { notice: "check_email" }) } as const;

function signInRefused(error: PageError, fields: Partial<Fields>): string {
  const returnTo = sanitizeReturnTo(fields["returnTo"]);
  // A malformed sign-in form is a failed sign-in, generically.
  return withQuery(PAGES.signIn, { error: error === "invalid_input" ? "login_failed" : error, returnTo: returnTo === "/" ? undefined : returnTo });
}

/** Resend and forgot: refusals go back to the forgot page, which offers both. */
function forgotRefused(error: PageError): string {
  return withQuery(PAGES.forgot, { error: error === "login_failed" || error === "not_verified" ? undefined : error });
}

/** Verify and reset: an invalid, used or expired token sends the person to ask for a new link. */
function tokenRefused(error: PageError): string {
  return error === "login_failed" ? withQuery(PAGES.forgot, { error: "link_invalid" }) : withQuery(PAGES.signIn, { error: error === "invalid_input" ? "login_failed" : error });
}

function endpoints(credentials: CredentialOperations): readonly Endpoint[] {
  return [
    {
      path: ENDPOINTS.signUp,
      required: ["email", "password", "displayName"],
      retryAfter: RATE_LIMITS.mailing.window,
      async run(c, f) {
        await credentials.signUp(c, { email: f["email"] ?? "", password: f["password"] ?? "", displayName: f["displayName"] ?? "" });
        return CHECK_EMAIL;
      },
      refused: (error) => (error === "invalid_input" || error === "rate_limited" ? withQuery(PAGES.signUp, { error }) : withQuery(PAGES.signIn, { error })),
    },
    {
      path: ENDPOINTS.signIn,
      required: ["email", "password"],
      optional: ["returnTo"],
      retryAfter: RATE_LIMITS.signIn.window,
      async run(c, f) {
        const returnTo = sanitizeReturnTo(f["returnTo"]);
        await credentials.signIn(c, { email: f["email"] ?? "", password: f["password"] ?? "" });
        return { json: { result: "signed-in", returnTo }, location: returnTo };
      },
      refused: signInRefused,
    },
    {
      path: ENDPOINTS.resend,
      required: ["email"],
      retryAfter: RATE_LIMITS.mailing.window,
      async run(c, f) {
        await credentials.sendVerification(c, { email: f["email"] ?? "" });
        return CHECK_EMAIL;
      },
      refused: forgotRefused,
    },
    {
      path: ENDPOINTS.verify,
      required: ["token"],
      retryAfter: RATE_LIMITS.tokenSubmit.window,
      async run(c, f) {
        await credentials.verify(c, { token: f["token"] ?? "" });
        return { json: { result: "verified" }, location: withQuery(PAGES.signIn, { notice: "verified" }) };
      },
      refused: tokenRefused,
    },
    {
      path: ENDPOINTS.forgot,
      required: ["email"],
      retryAfter: RATE_LIMITS.mailing.window,
      async run(c, f) {
        await credentials.requestReset(c, { email: f["email"] ?? "" });
        return CHECK_EMAIL;
      },
      refused: forgotRefused,
    },
    {
      path: ENDPOINTS.reset,
      required: ["token", "password"],
      retryAfter: RATE_LIMITS.tokenSubmit.window,
      async run(c, f) {
        await credentials.reset(c, { token: f["token"] ?? "", newPassword: f["password"] ?? "" });
        return { json: { result: "password-reset" }, location: withQuery(PAGES.signIn, { notice: "password_reset" }) };
      },
      refused: (error, f) => {
        const token = f["token"];
        // A password outside the length rule: back to the same reset form, token kept.
        if ((error === "invalid_input" || error === "rate_limited") && token !== undefined && token !== "") return withQuery(PAGES.reset, { token, error });
        return tokenRefused(error);
      },
    },
  ];
}

/** Strips `/api` (the router's mount) from a page or endpoint path. */
function local(path: string): string {
  return path.slice("/api".length);
}

/** Registers the password pages and endpoints on the framework's `/api` router. */
export function registerPasswordRoutes(api: Hono<RuntimeEnv>, credentials: CredentialOperations): void {
  const html = (c: Context, body: string): Response => {
    c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    c.header("X-Frame-Options", "DENY");
    c.header("Cache-Control", "no-store");
    return c.html(body, 200);
  };

  api.get(local(PAGES.signIn), (c) => html(c, signInPage({ returnTo: sanitizeReturnTo(c.req.query("returnTo")), error: c.req.query("error"), notice: c.req.query("notice") })));
  api.get(local(PAGES.signUp), (c) => html(c, signUpPage({ error: c.req.query("error") })));
  api.get(local(PAGES.forgot), (c) => html(c, forgotPage({ error: c.req.query("error") })));
  api.get(local(PAGES.verify), (c) => html(c, verifyPage(c.req.query("token"))));
  api.get(local(PAGES.reset), (c) => html(c, resetPage(c.req.query("token"), { error: c.req.query("error") })));

  for (const endpoint of endpoints(credentials)) {
    api.post(local(endpoint.path), async (c) => {
      const json = wantsJson(c);
      let fields: Partial<Fields> = {};
      try {
        fields = await readFields(c, endpoint.required, endpoint.optional);
        const done = await endpoint.run(c, fields as Fields);
        return json ? c.json(done.json, 200) : c.redirect(done.location, 303);
      } catch (thrown) {
        const error = pageError(thrown);
        if (error === "rate_limited") c.header("Retry-After", String(endpoint.retryAfter));
        if (json || error === undefined) throw thrown;
        return c.redirect(endpoint.refused(error, fields), 303);
      }
    });
  }
}
