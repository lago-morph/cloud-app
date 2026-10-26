/**
 * A per-process stop on a Cloudflare API token that the API refused with HTTP 401 (pass 3,
 * PROV-AC-002 diagnosis): once a harness request or a framework CLI call with a token gets 401,
 * this process makes no further Cloudflare call with that token, so that cleanup does not keep
 * sending an invalid (for example deleted) token. The failure is reported as an error that names
 * the token's purpose, never its value.
 *
 * Tokens are told apart by their value, which is held in memory only (as its SHA-256 digest) and
 * never printed.
 *
 * The state is per process, by design: each Vitest worker (`pool: "forks"`), each Playwright
 * worker and the driver process keeps its own. A token refused in one worker is still tried once
 * by another, which then stops too; nothing is shared through files or the environment, so no
 * token value (or digest) leaves the process, and a token the operator replaces between runs is
 * not blocked by an earlier run.
 */
import { createHash } from "node:crypto";

/** The purpose of the main token, read from `CLOUDFLARE_API_TOKEN`. */
export const MAIN_TOKEN_PURPOSE = "the main Cloudflare API token (CLOUDFLARE_API_TOKEN)";

/** A call refused because the Cloudflare API answered 401 to this token earlier in the process (or just now). */
export class InvalidTokenError extends Error {
  constructor(
    readonly purpose: string,
    what: string,
    /** The output of the CLI call that showed the 401, when one did (Cloudflare error texts hold no credential). */
    readonly output?: string,
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

/**
 * Cloudflare API error codes of an authentication failure: 10000 "Authentication error", 10001
 * "Unable to authenticate request", 9106 missing credentials, 9109 "Invalid access token", 1000
 * "Invalid API Token" (tokens/verify).
 */
const AUTH_ERROR_CODES = "10000|10001|9106|9109|1000";

/**
 * True when a framework CLI call's output shows that the Cloudflare API refused its token: the
 * CLI's API failure form (`provision/cloudflare/api.ts` `describeFailure`, and the D1 client's,
 * `HTTP 401: <message> (code <n>)`) with an authentication error code, or the CLI's `tokens/verify`
 * failure (`CLOUDFLARE_API_TOKEN is not usable: HTTP 401`, `provision/cloudflare/target.ts`). Not
 * the health check's `health check failed: HTTP 401: …` (`provision/cloudflare/health.ts`): that
 * 401 is the app's own answer, and says nothing about the token.
 */
export function outputShowsRefusedToken(output: string): boolean {
  if (/CLOUDFLARE_API_TOKEN is not usable: HTTP 401\b/.test(output)) return true;
  return new RegExp(`(?<!health check failed: )\\bHTTP 401: [^\\n]*\\(code (?:${AUTH_ERROR_CODES})\\)`).test(output);
}

/**
 * One framework CLI call with `token`: not run when the token was refused earlier in this
 * process; when its output shows the Cloudflare API refused the token, the token is recorded as
 * refused and the call rejects with `InvalidTokenError` (naming `purpose`, carrying the output).
 */
export async function guardCliCall<R extends { readonly status: number | null; readonly output: string }>(token: string | undefined, purpose: string, what: string, run: () => Promise<R>): Promise<R> {
  assertTokenUsable(token, what);
  const result = await run();
  if (result.status !== 0 && token !== undefined && token !== "" && outputShowsRefusedToken(result.output)) {
    markTokenRefused(token, purpose);
    throw new InvalidTokenError(purpose, what, result.output);
  }
  return result;
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
