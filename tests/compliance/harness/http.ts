/**
 * Base-URL HTTP client for compliance tests (compliance.md "Two layers of tests").
 * - explicit User-Agent (DEC-0089: Cloudflare refuses some default ones);
 * - Node `fetch` reaches cloud stages through the proxy only with `NODE_USE_ENV_PROXY=1`
 *   (DEC-0085); the driver sets it for cloud targets;
 * - a cookie jar per client, `Origin` on state-changing requests (forgery check), no automatic
 *   redirects, and a bounded timeout per request (PAR-270);
 * - failed checks throw `HttpCheckError`, whose message names the method, path, status, error
 *   code and requestId, which the driver copies into the evidence `detail` (COMPL-REQ-003).
 */
import { CLOUD_WAITS } from "./wait.js";

export const USER_AGENT = "prototype-framework-compliance/0.1.0";

export type Level = "anonymous" | "user" | "admin";

export interface HttpResponse {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  /** The ErrorResponse `error.code`, when the body is one. */
  readonly errorCode: string | undefined;
  /** The ErrorResponse `error.requestId`, when the body is one. */
  readonly requestId: string | undefined;
  /** The body parsed as JSON; throws when it is not JSON. */
  json<T = unknown>(): T;
}

export interface RequestOptions {
  /** Sent as a JSON body with `Content-Type: application/json`. */
  readonly json?: unknown;
  readonly body?: string | Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
  /** `Origin` header: default the base URL's origin on state-changing methods; `false` omits it. */
  readonly origin?: string | false;
}

export interface ClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly userAgent?: string;
  readonly timeoutMs?: number;
}

export class HttpCheckError extends Error {
  constructor(response: HttpResponse, expectation: string) {
    super(
      `HTTP check failed: ${response.method} ${response.path} → status ${String(response.status)}, code ${response.errorCode ?? "none"}, requestId ${response.requestId ?? "none"} (${expectation})`,
    );
    this.name = "HttpCheckError";
  }
}

export interface ComplianceClient {
  readonly baseUrl: string;
  request(method: string, path: string, options?: RequestOptions): Promise<HttpResponse>;
  get(path: string, options?: RequestOptions): Promise<HttpResponse>;
  post(path: string, json?: unknown, options?: RequestOptions): Promise<HttpResponse>;
  /** Returns the response when its status is one of `expected`; else throws HttpCheckError. */
  expectStatus(response: HttpResponse, expected: number | readonly number[]): HttpResponse;
  /** Returns the response when it is an ErrorResponse with this status and code; else throws HttpCheckError. */
  expectError(response: HttpResponse, status: number, code: string): HttpResponse;
  /** Logs this client in through `/api/auth/mock-login` (test stages and local only). */
  loginAs(level: Level, options?: { readonly id?: string; readonly displayName?: string | null }): Promise<void>;
  /** A new client with its own cookie jar, logged in as `level`. */
  as(level: Level, options?: { readonly id?: string; readonly displayName?: string | null }): Promise<ComplianceClient>;
  cookies(): Record<string, string>;
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function errorFields(text: string): { code: string | undefined; requestId: string | undefined } {
  try {
    const body = JSON.parse(text) as { error?: { code?: unknown; requestId?: unknown } };
    const code = typeof body.error?.code === "string" ? body.error.code : undefined;
    const requestId = typeof body.error?.requestId === "string" ? body.error.requestId : undefined;
    return { code, requestId };
  } catch {
    return { code: undefined, requestId: undefined };
  }
}

export function createClient(options: ClientOptions): ComplianceClient {
  const base = new URL(options.baseUrl);
  const origin = base.origin;
  const doFetch = options.fetch ?? fetch;
  const jar = new Map<string, string>();

  function remember(headers: Headers): void {
    for (const cookie of headers.getSetCookie()) {
      const [pair = "", ...attributes] = cookie.split(";");
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const cleared = attributes.some((a) => /^\s*max-age\s*=\s*(0|-\d+)\s*$/i.test(a)) || value === "";
      if (cleared) jar.delete(name);
      else jar.set(name, value);
    }
  }

  const client: ComplianceClient = {
    baseUrl: origin,
    async request(method, path, opts = {}) {
      const upper = method.toUpperCase();
      const headers = new Headers(opts.headers);
      headers.set("user-agent", options.userAgent ?? USER_AGENT);
      const originHeader = opts.origin ?? (SAFE.has(upper) ? false : origin);
      if (originHeader !== false) headers.set("origin", originHeader);
      if (jar.size > 0) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      let body: string | Uint8Array | undefined = opts.body;
      if (opts.json !== undefined) {
        body = JSON.stringify(opts.json);
        if (!headers.has("content-type")) headers.set("content-type", "application/json");
      }
      const response = await doFetch(new URL(path, base).toString(), {
        method: upper,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? CLOUD_WAITS.requestMs),
      });
      remember(response.headers);
      const text = await response.text();
      const { code, requestId } = errorFields(text);
      return {
        method: upper,
        path,
        status: response.status,
        headers: response.headers,
        text,
        errorCode: code,
        requestId,
        json<T>(): T {
          try {
            return JSON.parse(text) as T;
          } catch {
            throw new Error(`${upper} ${path}: the response body is not JSON (status ${String(response.status)})`);
          }
        },
      };
    },
    get: (path, opts) => client.request("GET", path, opts),
    post: (path, json, opts) => client.request("POST", path, { ...opts, ...(json === undefined ? {} : { json }) }),
    expectStatus(response, expected) {
      const list = typeof expected === "number" ? [expected] : expected;
      if (!list.includes(response.status)) throw new HttpCheckError(response, `expected status ${list.join(" or ")}`);
      return response;
    },
    expectError(response, status, code) {
      if (response.status !== status || response.errorCode !== code) throw new HttpCheckError(response, `expected status ${String(status)} with code ${code}`);
      return response;
    },
    async loginAs(level, opts = {}) {
      const json: Record<string, unknown> = { level };
      if (opts.id !== undefined) json.id = opts.id;
      if (opts.displayName !== undefined) json.displayName = opts.displayName;
      client.expectStatus(await client.post("/api/auth/mock-login", json), 204);
    },
    async as(level, opts) {
      const other = createClient(options);
      await other.loginAs(level, opts);
      return other;
    },
    cookies: () => Object.fromEntries(jar),
  };
  return client;
}
