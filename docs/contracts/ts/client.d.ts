/**
 * Browser-side helpers (`<package>/client`). The only framework module browser code
 * imports. Owners: HTTP (api, ApiError), AUTH (session helpers), FILES (transfers).
 */
import type { ErrorCode } from "./errors";
import type { CurrentUser } from "./auth";
import type { UploadTicket, DownloadTicket } from "./files";

export type { ErrorCode } from "./errors";
export type { CurrentUser } from "./auth";
export type { UploadTicket, DownloadTicket } from "./files";

/** Error raised by every helper below. `code` comes from the framework error catalogue. */
export declare class ApiError extends Error {
  readonly code: ErrorCode;
  /**
   * HTTP status received (from the API, the platform in front of it, or storage for
   * transfers), or null when no response was received.
   */
  readonly status: number | null;
  /** Null when the response did not come from the app. */
  readonly requestId: string | null;
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
export declare function api<T = unknown>(path: string, options?: ApiRequestOptions): Promise<T>;

/** The current user as the server sees it. */
export declare function getCurrentUser(): Promise<CurrentUser>;
/** Navigates to login; returns to `returnTo` (a same-origin path, default: current page). */
export declare function login(returnTo?: string): void;
/** Ends the session, then resolves. */
export declare function logout(): Promise<void>;

export interface TransferProgress {
  readonly loaded: number;
  readonly total: number;
}

/**
 * Uploads a file using a ticket obtained from the app's API. No size limit is imposed by the
 * framework. Always sends the ticket's content type; a Blob whose non-empty `type` differs is
 * rejected before sending.
 */
export declare function uploadFile(
  ticket: UploadTicket,
  file: Blob,
  options?: { readonly onProgress?: (p: TransferProgress) => void },
): Promise<void>;

/** A URL usable in `<img src>` or links, valid for the ticket's lifetime. */
export declare function downloadUrl(ticket: DownloadTicket): string;
