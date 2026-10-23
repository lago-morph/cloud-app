/**
 * The Cloudflare API seam (DEC-0271) and its real implementation (DEC-0107; DEC-0332).
 *
 * Every Cloudflare operation of the target goes through one `CloudflareApi` function, so unit
 * tests stub it and no other module handles a credential. The real one sends the token from
 * `CLOUDFLARE_API_TOKEN` as a bearer token, as wrangler and SST do: on an owner machine that is
 * the real token; in the sandbox it is a non-secret placeholder that the proxy replaces
 * (DEC-0083). Node's `fetch` uses `HTTPS_PROXY` only when the process runs with
 * `NODE_USE_ENV_PROXY=1` (DEC-0085), which the CLI process must have (D-05). Messages never
 * contain the token or a request body.
 */

/**
 * One Cloudflare API request, relative to `https://api.cloudflare.com/client/v4`. The body is
 * sent as JSON; the answer's body is its parsed JSON, or its text when it is not JSON.
 */
export type CloudflareApi = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => Promise<{ readonly status: number; readonly body: unknown }>;

export type ApiReply = Awaited<ReturnType<CloudflareApi>>;

export const API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareApiOptions {
  /** The value of `CLOUDFLARE_API_TOKEN`. */
  readonly token: string;
  readonly fetch?: typeof fetch;
}

export function createCloudflareApi(options: CloudflareApiOptions): CloudflareApi {
  const doFetch = options.fetch ?? fetch;
  return async (method, path, body) => {
    const headers: Record<string, string> = { authorization: `Bearer ${options.token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await doFetch(`${API_BASE}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (error) {
      throw new Error(`Cloudflare API request ${method} ${path} got no response: ${error instanceof Error ? error.message : String(error)}`);
    }
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text === "" ? null : JSON.parse(text);
    } catch {
      // not JSON: keep the text
    }
    return { status: response.status, body: parsed };
  };
}

/** A 2xx answer whose body says `success: true`. */
export const succeeded = (r: ApiReply): boolean => r.status >= 200 && r.status < 300 && (r.body as { success?: unknown } | null)?.success === true;

/** `HTTP <status>: <Cloudflare's first error, or the text body>`. */
export function describeFailure(r: ApiReply): string {
  const errors = (r.body as { errors?: { code?: unknown; message?: unknown }[] } | null)?.errors;
  const e = Array.isArray(errors) ? errors[0] : undefined;
  const detail = e
    ? `${String(e.message ?? "")}${e.code !== undefined ? ` (code ${String(e.code)})` : ""}`
    : typeof r.body === "string" && r.body !== ""
      ? r.body.slice(0, 200)
      : "no error detail";
  return `HTTP ${r.status}: ${detail}`;
}

/** The answer's `result` when it succeeded; otherwise throws `<what> failed: HTTP …`. */
export function resultOf<T = unknown>(r: ApiReply, what: string): T {
  if (!succeeded(r)) throw new Error(`${what} failed: ${describeFailure(r)}`);
  return (r.body as { result: T }).result;
}

/** Cloudflare's first error code, if any. */
export function errorCode(r: ApiReply): number | undefined {
  const errors = (r.body as { errors?: { code?: unknown }[] } | null)?.errors;
  const code = Array.isArray(errors) ? errors[0]?.code : undefined;
  return typeof code === "number" ? code : undefined;
}
