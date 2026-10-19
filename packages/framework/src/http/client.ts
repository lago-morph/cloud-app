/**
 * HTTP browser helpers (contract: docs/contracts/ts/client.d.ts: `api`, `ApiError`).
 * Stub written by B-01; implemented by B-03.
 */
import type { ErrorCode } from "../core/errors.js";

/** Error raised by every browser helper. `code` comes from the framework error catalogue. */
export class ApiError extends Error {
  declare readonly code: ErrorCode;
  /** HTTP status received, or null when no response was received. */
  declare readonly status: number | null;
  /** Null when the response did not come from the app. */
  declare readonly requestId: string | null;
}

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Serialized as JSON. */
  readonly body?: unknown;
  readonly query?: Record<string, string>;
}

/** Calls the app's own API. `path` is relative to `/api`. */
export function api<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T> {
  throw new Error("not implemented: api");
}
