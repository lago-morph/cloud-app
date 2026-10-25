/**
 * Framework error catalogue (SYS-REQ-010, CORE-REQ-004).
 *
 * This file is the single source of truth for error codes. Every failure a framework
 * interface surfaces to app code, to the browser helpers, or over HTTP carries one of
 * these codes. Codes are durable identifiers: never renumbered, renamed, or reused.
 * Messages are informative only and must never be used for control flow.
 *
 * The owning component is the code's prefix. Each entry gives the HTTP status used when
 * the error reaches an HTTP response uncaught, and whether it is retryable.
 * `status: null` means the error never crosses HTTP (browser-side only).
 *
 * `retryable: true` means the same operation may succeed later without any change (for
 * transfers, with a fresh ticket). The framework has already done its own retries; apps
 * need not retry automatically.
 *
 * Retired codes, never reused: FILES.TICKET_EXPIRED (DEC-0077).
 */

export interface ErrorCatalogueEntry {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly meaning: string;
}

export declare const ERROR_CATALOGUE: {
  // CORE
  readonly "CORE.INTERNAL":            { status: 500; retryable: false; meaning: "Unexpected failure. Details are logged, never returned." };
  readonly "CORE.MISCONFIGURED":       { status: 500; retryable: false; meaning: "The deployment's configuration or wiring is invalid." };

  // HTTP
  readonly "HTTP.INVALID_INPUT":       { status: 400; retryable: false; meaning: "Request body, query, or parameters failed validation." };
  readonly "HTTP.NOT_FOUND":           { status: 404; retryable: false; meaning: "No such API route, or the app reported a missing resource." };
  readonly "HTTP.METHOD_NOT_ALLOWED":  { status: 405; retryable: false; meaning: "Route exists but not for this method." };
  readonly "HTTP.PAYLOAD_TOO_LARGE":   { status: 413; retryable: false; meaning: "Request body exceeds the framework limit." };
  readonly "HTTP.CONFLICT":            { status: 409; retryable: false; meaning: "The app refused the request because of the current state or a limit." };
  readonly "HTTP.NETWORK_ERROR":       { status: null; retryable: true;  meaning: "The browser helper could not reach the API or did not receive a framework response." };

  // SQL
  readonly "SQL.CONFLICT":             { status: 409; retryable: false; meaning: "A uniqueness or reference constraint was violated." };
  readonly "SQL.INVALID_VALUE":        { status: 400; retryable: false; meaning: "A value does not satisfy its portable column type." };
  readonly "SQL.UNAVAILABLE":          { status: 503; retryable: true;  meaning: "The database could not be reached in time." };
  readonly "SQL.RESULT_TOO_LARGE":     { status: 500; retryable: false; meaning: "A query result exceeds the portable result size limit; paginate." };

  // KV
  readonly "KV.INVALID_KEY":           { status: 400; retryable: false; meaning: "Key or prefix is empty, malformed, or too long." };
  readonly "KV.INVALID_CURSOR":        { status: 400; retryable: false; meaning: "List cursor is malformed or belongs to another prefix." };
  readonly "KV.VALUE_TOO_LARGE":       { status: 413; retryable: false; meaning: "Value exceeds the KV value size limit." };
  readonly "KV.UNAVAILABLE":           { status: 503; retryable: true;  meaning: "Key-value storage could not be used in time." };

  // FILES
  readonly "FILES.INVALID_NAME":       { status: 400; retryable: false; meaning: "File name or prefix is empty, malformed, or too long." };
  readonly "FILES.INVALID_CURSOR":     { status: 400; retryable: false; meaning: "List cursor is malformed or belongs to another prefix." };
  readonly "FILES.NOT_FOUND":          { status: 404; retryable: false; meaning: "A download was requested for a file that does not exist." };
  readonly "FILES.UNAVAILABLE":        { status: 503; retryable: true;  meaning: "File storage could not be reached in time." };
  readonly "FILES.TRANSFER_FAILED":    { status: null; retryable: true;  meaning: "Browser transfer did not complete; request a new ticket and retry." };

  // CFG
  readonly "CFG.UNDECLARED_KEY":       { status: 500; retryable: false; meaning: "App read a configuration key it did not declare." };

  // SEC
  readonly "SEC.UNDECLARED":           { status: 500; retryable: false; meaning: "App read a secret name it did not declare." };
  readonly "SEC.MISSING":              { status: 500; retryable: false; meaning: "A declared secret has no value in this stage." };
  readonly "SEC.UNAVAILABLE":          { status: 503; retryable: true;  meaning: "The secret store could not be reached in time." };

  // AUTH
  readonly "AUTH.UNAUTHENTICATED":     { status: 401; retryable: false; meaning: "The route requires a logged-in user." };
  readonly "AUTH.FORBIDDEN":           { status: 403; retryable: false; meaning: "The user's access level is insufficient, or the user may see the resource but not change it." };
  readonly "AUTH.REQUEST_FORGERY":     { status: 403; retryable: false; meaning: "A state-changing request with a session came from another origin." };
  readonly "AUTH.LOGIN_FAILED":        { status: 400; retryable: false; meaning: "Login could not be completed." };
  readonly "AUTH.NOT_VERIFIED":        { status: 403; retryable: false; meaning: "The account has not been verified yet." };
  readonly "AUTH.RATE_LIMITED":        { status: 429; retryable: true;  meaning: "Too many attempts from this client; try again later." };
};

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

/** Thrown by server-side framework interfaces. App code may also throw it, only with the codes CORE-REQ-007 allows. */
export declare class FrameworkError extends Error {
  constructor(code: ErrorCode, message?: string);
  readonly code: ErrorCode;
}

/** HTTP error response body (see contracts/http/framework.openapi.yaml, ErrorResponse). */
export interface ErrorResponseBody {
  error: { code: ErrorCode; message: string; requestId: string };
}
