/**
 * The handler bridge (password.md §2 "Handler bridge"; DEC-0510, DEC-0516). BA's server-side API
 * calls skip its rate limiter, so every operation goes through `auth.handler()` with a request
 * the bridge builds itself:
 * - the URL is the public origin plus BA's path, never the incoming URL or `Host`;
 * - the only headers copied are `Origin`, `CF-Connecting-IP` (the context's client IP) and
 *   `User-Agent`; never `Cookie`, `Host` or `X-Forwarded-*`;
 * - the body is JSON built from validated input.
 * The answer is reduced to BA's status, its error code and the few fields the provider reads.
 * None of BA's headers (its `Set-Cookie` included) and none of its body leave this module.
 */
import type { CredentialContext } from "../login-provider.js";
import { PASSWORD_BASE_PATH } from "./options.js";

/** What the bridge keeps of BA's answer. */
export interface BridgeAnswer {
  readonly status: number;
  /** BA's error code (`EMAIL_NOT_VERIFIED`, `INVALID_TOKEN`, ...), when it gave one of the expected shape. */
  readonly code: string | undefined;
  /** Sign-in only: the fields AUTH needs and the BA session token to delete. */
  readonly signIn: { readonly userId: string; readonly name: string; readonly token: string } | undefined;
}

export interface BridgeRequest {
  readonly method: "GET" | "POST";
  /** BA's path, relative to `PASSWORD_BASE_PATH`. */
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, string>>;
}

/** The request BA receives. Exported for the bridge's own tests. */
export function bridgeRequest(ctx: CredentialContext, request: BridgeRequest): Request {
  const url = new URL(`${new URL(ctx.publicOrigin).origin}${PASSWORD_BASE_PATH}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) url.searchParams.set(key, value);
  const headers = new Headers({ accept: "application/json" });
  if (ctx.origin !== "") headers.set("origin", ctx.origin);
  headers.set("cf-connecting-ip", ctx.clientIp);
  if (ctx.userAgent !== null) headers.set("user-agent", ctx.userAgent);
  if (request.body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, {
    method: request.method,
    headers,
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
}

const BA_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** Forwards one request to BA's handler and reduces its answer (see the module comment). */
export async function forward(auth: { handler(request: Request): Promise<Response> }, ctx: CredentialContext, request: BridgeRequest): Promise<BridgeAnswer> {
  const response = await auth.handler(bridgeRequest(ctx, request));
  const text = await response.text();
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  const code = field(body, "code");
  const user = field(body, "user");
  const userId = field(user, "id");
  const name = field(user, "name");
  const token = field(body, "token");
  return {
    status: response.status,
    code: typeof code === "string" && BA_CODE.test(code) ? code : undefined,
    signIn:
      response.status === 200 && typeof userId === "string" && typeof name === "string" && typeof token === "string" && token !== ""
        ? { userId, name, token }
        : undefined,
  };
}
