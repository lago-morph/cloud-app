/**
 * The Cloudflare API seam (DEC-0271) and its real implementation (DEC-0107; DEC-0332).
 *
 * Every Cloudflare operation of the target goes through one `CloudflareApi` function, so unit
 * tests stub it and no other module handles a credential. The real one sends the token from
 * `CLOUDFLARE_API_TOKEN` as a bearer token, as wrangler and SST do. It is the real token on an
 * owner machine and in the sandbox alike: the sandbox proxy no longer injects or replaces it
 * (DEC-0420, superseding the placeholder of DEC-0083). Node's `fetch` uses `HTTPS_PROXY` only when the process runs with
 * `NODE_USE_ENV_PROXY=1` (DEC-0085), which the CLI process must have (D-05). Messages never
 * contain the token or a request body.
 */

/**
 * One Cloudflare API request, relative to `https://api.cloudflare.com/client/v4`. The body is
 * sent as JSON, except a `FormData` body, which is sent as `multipart/form-data` (a Worker
 * upload); the answer's body is its parsed JSON, or its text when it is not JSON.
 */
export type CloudflareApi = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<{ readonly status: number; readonly body: unknown }>;

export type ApiReply = Awaited<ReturnType<CloudflareApi>>;

export const API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Thrown by a request layer wrapped around the API (or around `cloudflare-setup`'s network check)
 * that will send nothing more: a call budget is used up, or Cloudflare rate-limited the run (HTTP
 * 429). Code that tolerates a failed request (the network check) rethrows it, so the run ends
 * instead of sending more or reporting the stop as something else (DEC-0619).
 */
export class CloudflareRequestsStopped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudflareRequestsStopped";
  }
}

const BASE_PATH = new URL(API_BASE).pathname;

/**
 * The path a request with `path` is sent to, for a guard to judge (DEC-0613): `API_BASE + path`
 * through the URL parser `fetch` uses (dot segments resolved, `\` read as `/`, tabs and newlines
 * dropped, query and fragment cut), then each segment percent-decoded (again while it changes,
 * so a doubly encoded name is read too), any `/` or `\` the decoding reveals split, and empty and
 * dot segments resolved once more. Relative to the API base when it is under it, else the whole
 * path. Undefined when the URL cannot be parsed. Never shorter than what Cloudflare could route,
 * so a guard that matches it errs toward refusing.
 */
export function sentPath(path: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(`${API_BASE}${path}`).pathname;
  } catch {
    return undefined;
  }
  const segments: string[] = [];
  for (const raw of pathname.split("/")) {
    let segment = raw;
    for (let i = 0; i < 8; i++) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        break;
      }
      if (decoded === segment) break;
      segment = decoded;
    }
    for (const part of segment.split(/[/\\]/)) {
      if (part === "" || part === ".") continue;
      if (part === "..") segments.pop();
      else segments.push(part);
    }
  }
  const full = `/${segments.join("/")}`;
  const lower = full.toLowerCase();
  if (lower === BASE_PATH) return "/";
  return lower.startsWith(`${BASE_PATH}/`) ? full.slice(BASE_PATH.length) : full;
}

export interface CloudflareApiOptions {
  /** The value of `CLOUDFLARE_API_TOKEN`. */
  readonly token: string;
  readonly fetch?: typeof fetch;
}

export function createCloudflareApi(options: CloudflareApiOptions): CloudflareApi {
  const doFetch = options.fetch ?? fetch;
  return async (method, path, body) => {
    const headers: Record<string, string> = { authorization: `Bearer ${options.token}` };
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await doFetch(`${API_BASE}${path}`, { method, headers, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) });
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

/**
 * One request whose bodies are bytes, not JSON (DEC-0543): an R2 object's own bytes through the
 * R2 object endpoints of `api.cloudflare.com` (`GET`/`PUT …/r2/buckets/<bucket>/objects/<key>`),
 * used by the production `remove`'s backup. Same token handling as `CloudflareApi`; the answer
 * keeps its bytes and content type. `body` is parsed JSON when the answer is JSON (an error).
 */
export type CloudflareBytesApi = (
  method: "GET" | "PUT",
  path: string,
  body?: { readonly bytes: Uint8Array; readonly contentType?: string },
) => Promise<{ readonly status: number; readonly bytes: Uint8Array; readonly contentType?: string; readonly body: unknown }>;

export function createCloudflareBytesApi(options: CloudflareApiOptions): CloudflareBytesApi {
  const doFetch = options.fetch ?? fetch;
  return async (method, path, body) => {
    const headers: Record<string, string> = { authorization: `Bearer ${options.token}` };
    if (body !== undefined) headers["content-type"] = body.contentType ?? "application/octet-stream";
    let response: Response;
    try {
      response = await doFetch(`${API_BASE}${path}`, { method, headers, ...(body === undefined ? {} : { body: new Blob([body.bytes.slice()]) }) });
    } catch (error) {
      throw new Error(`Cloudflare API request ${method} ${path} got no response: ${error instanceof Error ? error.message : String(error)}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? undefined;
    let parsed: unknown = null;
    if (contentType?.includes("application/json") === true) {
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        // not JSON after all
      }
    }
    return { status: response.status, bytes, ...(contentType === undefined ? {} : { contentType }), body: parsed };
  };
}
