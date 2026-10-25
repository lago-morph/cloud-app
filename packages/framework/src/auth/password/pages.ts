/**
 * The sign-in pages (password.md §2 "Routes and pages"; internal/auth-password.openapi.yaml,
 * `components.responses.Page`): server-rendered HTML with plain forms and no script. Each form
 * posts to one of the framework's `/api/auth/password/*` endpoints, which answer a form with a
 * 303 back to one of these pages.
 *
 * - A page never echoes an address, a password or anything the person typed; the only request
 *   values it renders are the sanitized `returnTo` (sign-in) and the token of a mailed link
 *   (verify, reset), as hidden form fields, escaped.
 * - `error` and `notice` select fixed, generic messages; unknown values show nothing.
 * - No page names the credential library, a cloud or any other implementation detail.
 * - Verify and reset change nothing on GET: their button posts the token (AUTH-REQ-007), so a
 *   mail scanner opening the link cannot use it up.
 *
 * Framework-internal, Workers-compatible.
 */
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./options.js";

/** The pages' paths (all under `/api/auth/`, so Worker routing and the Vite proxy do not change). */
export const PAGES = {
  signIn: "/api/auth/sign-in",
  signUp: "/api/auth/sign-up",
  forgot: "/api/auth/forgot",
  verify: "/api/auth/verify",
  reset: "/api/auth/reset",
} as const;

/** The POST endpoints the forms post to. */
export const ENDPOINTS = {
  signIn: "/api/auth/password/sign-in",
  signUp: "/api/auth/password/sign-up",
  resend: "/api/auth/password/resend",
  verify: "/api/auth/password/verify",
  forgot: "/api/auth/password/forgot",
  reset: "/api/auth/password/reset",
} as const;

/** The generic messages a page can show for `?error=` (the sign-in page's enum, plus the others' own). */
export type PageError = "login_failed" | "not_verified" | "rate_limited" | "forgery" | "invalid_input" | "link_invalid";
/** The notices of the sign-in page. */
export type PageNotice = "check_email" | "verified" | "password_reset";

const PASSWORD_RULE = `between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`;

const ERRORS: Record<PageError, string> = {
  login_failed: "Sign-in failed. Check your email address and password and try again.",
  not_verified: "Your email address has not been confirmed yet. Use the link in the email we sent you, or ask for a new link.",
  rate_limited: "Too many attempts. Please wait a few minutes, then try again.",
  forgery: "The form could not be accepted. Please open this page again and retry.",
  invalid_input: `Please check the form. The password must be ${PASSWORD_RULE}, and every field is required.`,
  link_invalid: "That link is invalid, already used or expired. You can ask for a new one below.",
};

const NOTICES: Record<PageNotice, string> = {
  check_email: "Check your email. If the address can be used, we have sent a message with a link to it.",
  verified: "Your email address is confirmed. You can sign in now.",
  password_reset: "Your password has been changed. You can sign in with the new one.",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function pick<K extends string>(table: Record<K, string>, value: string | undefined, allowed: readonly K[]): string | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? table[value as K] : undefined;
}

/** The fixed message for `?error=` / `?notice=`, when the page offers it. */
function messages(query: PageQuery, errors: readonly PageError[], notices: readonly PageNotice[] = []): string {
  const error = pick(ERRORS, query.error, errors);
  const notice = pick(NOTICES, query.notice, notices);
  return (error === undefined ? "" : `<p class="error" role="alert">${escapeHtml(error)}</p>`) + (notice === undefined ? "" : `<p class="notice" role="status">${escapeHtml(notice)}</p>`);
}

function field(input: { readonly id: string; readonly name: string; readonly label: string; readonly type: string; readonly autocomplete: string; readonly password?: boolean }): string {
  const length = input.password === true ? ` minlength="${PASSWORD_MIN_LENGTH}" maxlength="${PASSWORD_MAX_LENGTH}"` : "";
  const hint = input.password === true ? ` aria-describedby="${input.id}-hint"` : "";
  const hintText = input.password === true ? `<span class="hint" id="${input.id}-hint">Between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.</span>` : "";
  return (
    `<div class="field"><label for="${input.id}">${escapeHtml(input.label)}</label>` +
    `<input id="${input.id}" name="${input.name}" type="${input.type}" autocomplete="${input.autocomplete}" required${length}${hint}>${hintText}</div>`
  );
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

function form(action: string, body: string, button: string, label?: string): string {
  const aria = label === undefined ? "" : ` aria-label="${escapeHtml(label)}"`;
  return `<form method="post" action="${action}"${aria}>${body}<button type="submit">${escapeHtml(button)}</button></form>`;
}

function links(items: readonly (readonly [string, string])[]): string {
  return `<nav aria-label="Other actions"><ul>${items.map(([href, text]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(text)}</a></li>`).join("")}</ul></nav>`;
}

const STYLE =
  "body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:1rem;color:#1a1a1a;background:#fff}" +
  "main{max-width:24rem;margin:2rem auto}h1{font-size:1.5rem}h2{font-size:1.15rem;margin-top:2rem}" +
  ".field{margin:0 0 1rem}label{display:block;font-weight:600}" +
  "input{box-sizing:border-box;width:100%;padding:.5rem;font:inherit;border:1px solid #767676;border-radius:4px}" +
  "button{padding:.5rem 1rem;font:inherit;border:1px solid #1a1a1a;border-radius:4px;background:#1a1a1a;color:#fff;cursor:pointer}" +
  "input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #005fcc;outline-offset:2px}" +
  ".hint{display:block;font-size:.875rem;color:#4a4a4a}.error{color:#a50e0e;font-weight:600}.notice{color:#0b5d1e;font-weight:600}" +
  "nav ul{padding-left:1.2rem}" +
  "@media (prefers-color-scheme:dark){body{color:#eee;background:#121212}input{background:#1e1e1e;color:#eee;border-color:#8a8a8a}" +
  "button{background:#eee;color:#121212;border-color:#eee}.hint{color:#bbb}.error{color:#ff8a80}.notice{color:#9be7a5}}";

function page(title: string, content: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">` +
    `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>` +
    `<body><main><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`
  );
}

/** The page's query values the renderer reads (all optional). */
export interface PageQuery {
  readonly error?: string | undefined;
  readonly notice?: string | undefined;
}

const email = (id: string): string => field({ id, name: "email", label: "Email address", type: "email", autocomplete: "email" });

export function signInPage(query: PageQuery & { readonly returnTo: string }): string {
  const body =
    email("email") +
    field({ id: "password", name: "password", label: "Password", type: "password", autocomplete: "current-password" }) +
    (query.returnTo === "/" ? "" : hidden("returnTo", query.returnTo));
  return page(
    "Sign in",
    messages(query, ["login_failed", "not_verified", "rate_limited", "forgery"], ["check_email", "verified", "password_reset"]) +
      form(ENDPOINTS.signIn, body, "Sign in") +
      links([
        [PAGES.signUp, "Create an account"],
        [PAGES.forgot, "Forgot your password?"],
        [`${PAGES.forgot}#resend`, "Send a new confirmation link"],
      ]),
  );
}

export function signUpPage(query: PageQuery): string {
  const body =
    email("email") +
    field({ id: "displayName", name: "displayName", label: "Display name", type: "text", autocomplete: "name" }) +
    field({ id: "password", name: "password", label: "Password", type: "password", autocomplete: "new-password", password: true });
  return page(
    "Create an account",
    messages(query, ["invalid_input", "rate_limited", "forgery"]) +
      form(ENDPOINTS.signUp, body, "Create account") +
      `<p>We will send a link to confirm your email address before you can sign in.</p>` +
      links([[PAGES.signIn, "Sign in instead"]]),
  );
}

export function forgotPage(query: PageQuery): string {
  return page(
    "Forgot your password?",
    messages(query, ["invalid_input", "rate_limited", "forgery", "link_invalid"]) +
      `<p>Enter your email address and we will send you a link to choose a new password.</p>` +
      form(ENDPOINTS.forgot, email("forgot-email"), "Send reset link", "Reset password") +
      `<h2 id="resend">Confirmation link</h2>` +
      `<p>Not received the email to confirm your address? Ask for a new one.</p>` +
      form(ENDPOINTS.resend, email("resend-email"), "Send a new confirmation link", "New confirmation link") +
      links([[PAGES.signIn, "Back to sign in"]]),
  );
}

export function verifyPage(token: string | undefined): string {
  if (token === undefined || token === "") {
    return page("Confirm your email address", `<p class="error" role="alert">${escapeHtml(ERRORS.link_invalid)}</p>` + links([[`${PAGES.forgot}#resend`, "Send a new confirmation link"]]));
  }
  return page(
    "Confirm your email address",
    `<p>Select the button to confirm your email address.</p>` + form(ENDPOINTS.verify, hidden("token", token), "Confirm my email address") + links([[PAGES.signIn, "Sign in"]]),
  );
}

export function resetPage(token: string | undefined, query: PageQuery): string {
  if (token === undefined || token === "") {
    return page("Choose a new password", `<p class="error" role="alert">${escapeHtml(ERRORS.link_invalid)}</p>` + links([[PAGES.forgot, "Ask for a new link"]]));
  }
  const body = hidden("token", token) + field({ id: "password", name: "password", label: "New password", type: "password", autocomplete: "new-password", password: true });
  return page("Choose a new password", messages(query, ["invalid_input", "rate_limited", "forgery"]) + form(ENDPOINTS.reset, body, "Change password") + links([[PAGES.signIn, "Back to sign in"]]));
}
