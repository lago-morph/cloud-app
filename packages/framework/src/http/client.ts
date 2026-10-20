/**
 * HTTP browser helpers (contract: docs/contracts/ts/client.d.ts: `api`, `ApiError`;
 * HTTP-REQ-006). Browser code: Web APIs only.
 */
import { ERROR_CATALOGUE, type ErrorCode } from "../core/errors.js";

/** Error raised by every browser helper. `code` comes from the framework error catalogue. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  /** HTTP status received, or null when no response was received. */
  readonly status: number | null;
  /** Null when the response did not come from the app. */
  readonly requestId: string | null;

  /**
   * `init` fields default to the "no response" values. The type is inlined (not a named
   * interface) so the public signature uses only names `./client` exports (CORE-AC-001).
   */
  constructor(
    message?: string,
    init: ErrorOptions & {
      readonly code?: ErrorCode;
      readonly status?: number | null;
      readonly requestId?: string | null;
    } = {},
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiError";
    this.code = init.code ?? "HTTP.NETWORK_ERROR";
    this.status = init.status ?? null;
    this.requestId = init.requestId ?? null;
  }
}

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialized as JSON. */
  readonly body?: unknown;
  readonly query?: Record<string, string>;
}

/**
 * Calls the app's own API. `path` is relative to `/api` (e.g. "/notes"). Parses JSON
 * responses and throws ApiError for error responses.
 */
export async function api<T = unknown>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const query = options.query === undefined ? "" : `?${new URLSearchParams(options.query).toString()}`;
  const init: RequestInit = { method: options.method ?? "GET", credentials: "same-origin", headers: { Accept: "application/json" } };
  if (options.body !== undefined) {
    init.headers = { Accept: "application/json", "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  let res: Response;
  let text: string;
  try {
    res = await fetch(`/api${path}${query}`, init);
    text = await res.text();
  } catch (cause) {
    throw new ApiError("could not reach the API", { cause });
  }
  const notFromApp = () =>
    new ApiError(`response did not come from the app (status ${res.status})`, { status: res.status });
  if (res.ok && text === "") return undefined as T;
  const json = isJson(res) ? parseJson(text) : NOT_JSON;
  if (json === NOT_JSON) throw notFromApp();
  if (res.ok) return json as T;
  const error = errorResponse(json);
  if (error === undefined) throw notFromApp();
  throw new ApiError(error.message, { code: error.code, status: res.status, requestId: error.requestId });
}

const NOT_JSON = Symbol("not JSON");

function isJson(res: Response): boolean {
  return /^application\/(?:[\w.+-]*\+)?json\b/i.test(res.headers.get("Content-Type") ?? "");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

/**
 * The `error` of a valid `ErrorResponse` (framework.openapi.yaml): exactly `{ error: { code,
 * message, requestId } }`, strings only, with a catalogue code; undefined for anything else.
 */
function errorResponse(json: unknown): { code: ErrorCode; message: string; requestId: string } | undefined {
  if (!isRecord(json) || !sameKeys(json, ["error"])) return undefined;
  const error = json["error"];
  if (!isRecord(error) || !sameKeys(error, ["code", "message", "requestId"])) return undefined;
  const { code, message, requestId } = error;
  if (typeof code !== "string" || !Object.hasOwn(ERROR_CATALOGUE, code)) return undefined;
  if (typeof message !== "string" || typeof requestId !== "string") return undefined;
  return { code: code as ErrorCode, message, requestId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}
