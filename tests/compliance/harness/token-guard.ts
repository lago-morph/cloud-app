/**
 * A per-process stop on a Cloudflare API token that the API refused with HTTP 401 (pass 3,
 * PROV-AC-002 diagnosis): once a harness request or a framework CLI call with a token gets 401,
 * this process makes no further Cloudflare call with that token, so that cleanup does not keep
 * sending an invalid (for example deleted) token. The failure is reported as an error that names
 * the token's purpose, never its value.
 *
 * Tokens are told apart by their value, which is held in memory only (as its SHA-256 digest) and
 * never printed.
 */
import { createHash } from "node:crypto";

/** The purpose of the main token, read from `CLOUDFLARE_API_TOKEN`. */
export const MAIN_TOKEN_PURPOSE = "the main Cloudflare API token (CLOUDFLARE_API_TOKEN)";

/** A call refused because the Cloudflare API answered 401 to this token earlier in the process (or just now). */
export class InvalidTokenError extends Error {
  constructor(
    readonly purpose: string,
    what: string,
  ) {
    super(`${what}: the Cloudflare API answered HTTP 401 to ${purpose}; no further Cloudflare call is made with it in this process`);
    this.name = "InvalidTokenError";
  }
}

const refused = new Map<string, string>();

const key = (token: string): string => createHash("sha256").update(token).digest("hex");

/** True when the Cloudflare API refused this token with 401 earlier in this process. */
export function isRefusedToken(token: string | undefined): boolean {
  return token !== undefined && token !== "" && refused.has(key(token));
}

/** Throws `InvalidTokenError` when the token was refused earlier in this process. Call before every Cloudflare call. */
export function assertTokenUsable(token: string | undefined, what: string): void {
  if (token === undefined || token === "") return;
  const earlier = refused.get(key(token));
  if (earlier !== undefined) throw new InvalidTokenError(earlier, what);
}

/** Records that the Cloudflare API answered 401 to the token. */
export function markTokenRefused(token: string | undefined, purpose: string): void {
  if (token === undefined || token === "") return;
  if (!refused.has(key(token))) refused.set(key(token), purpose);
}

/**
 * After a Cloudflare API answer: on 401, records the token as refused and throws
 * `InvalidTokenError` naming its purpose. Other statuses pass.
 */
export function checkTokenStatus(token: string | undefined, purpose: string, status: number, what: string): void {
  if (status !== 401) return;
  markTokenRefused(token, purpose);
  throw new InvalidTokenError(purpose, what);
}

/** True when a framework CLI call's output shows a Cloudflare API answer of HTTP 401 (`describeFailure`'s `HTTP 401:`). */
export function outputShowsRefusedToken(output: string): boolean {
  return /\bHTTP 401\b/.test(output);
}

const CLOUDFLARE_API_HOST = "api.cloudflare.com";

/**
 * `doFetch` guarded for requests to the Cloudflare API with `token`: refused without a request
 * when the token was refused earlier in this process, and an `InvalidTokenError` on a 401 answer.
 * Requests to other hosts pass unchanged.
 */
export function guardFetch(doFetch: typeof fetch, token: string | undefined, purpose: string): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== CLOUDFLARE_API_HOST) return doFetch(input, init);
    const what = `${init?.method ?? "GET"} ${url.pathname.replace(/^\/client\/v4/, "")}`;
    assertTokenUsable(token, what);
    const response = await doFetch(input, init);
    checkTokenStatus(token, purpose, response.status, what);
    return response;
  }) as typeof fetch;
}

/** For unit tests: forgets every refused token. */
export function resetRefusedTokens(): void {
  refused.clear();
}
