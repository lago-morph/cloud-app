/**
 * Framework error catalogue (SYS-REQ-010, CORE-REQ-004).
 *
 * This file is the single source of truth for error codes. Every failure a framework
 * interface surfaces to app code, to the browser helpers, or over HTTP carries one of
 * these codes. Codes are durable identifiers: never renumbered, renamed, or reused.
 * Messages are informative only and must never be used for control flow.
 *
 * Each entry gives the owning component, the HTTP status used when the error reaches
 * an HTTP response uncaught, and whether retrying the same operation later may succeed.
 * `status: null` means the error never crosses HTTP (browser-side only).
 */

export interface ErrorCatalogueEntry {
  readonly component: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly meaning: string;
}

export declare const ERROR_CATALOGUE: {
  // CORE
  readonly "CORE.INTERNAL":            { component: "CORE";  status: 500; retryable: false; meaning: "Unexpected failure. Details are logged, never returned." };
  readonly "CORE.MISCONFIGURED":       { component: "CORE";  status: 500; retryable: false; meaning: "The deployment's configuration or wiring is invalid." };

  // HTTP
  readonly "HTTP.INVALID_INPUT":       { component: "HTTP";  status: 400; retryable: false; meaning: "Request body, query, or parameters failed validation." };
  readonly "HTTP.NOT_FOUND":           { component: "HTTP";  status: 404; retryable: false; meaning: "No such API route, or the app reported a missing resource." };
  readonly "HTTP.METHOD_NOT_ALLOWED":  { component: "HTTP";  status: 405; retryable: false; meaning: "Route exists but not for this method." };
  readonly "HTTP.PAYLOAD_TOO_LARGE":   { component: "HTTP";  status: 413; retryable: false; meaning: "Request body exceeds the framework limit." };
  readonly "HTTP.NETWORK_ERROR":       { component: "HTTP";  status: null; retryable: true;  meaning: "Browser helper could not reach the API." };

  // SQL
  readonly "SQL.CONFLICT":             { component: "SQL";   status: 409; retryable: false; meaning: "A uniqueness or reference constraint was violated." };
  readonly "SQL.INVALID_VALUE":        { component: "SQL";   status: 400; retryable: false; meaning: "A value does not satisfy its portable column type." };
  readonly "SQL.UNAVAILABLE":          { component: "SQL";   status: 503; retryable: true;  meaning: "The database could not be reached in time." };
  readonly "SQL.SCHEMA_NOT_READY":     { component: "SQL";   status: 503; retryable: true;  meaning: "The database schema is older than this build expects." };

  // KV
  readonly "KV.INVALID_KEY":           { component: "KV";    status: 400; retryable: false; meaning: "Key or prefix is empty, malformed, or too long." };
  readonly "KV.INVALID_CURSOR":        { component: "KV";    status: 400; retryable: false; meaning: "List cursor is malformed or belongs to another prefix." };

  // FILES
  readonly "FILES.INVALID_NAME":       { component: "FILES"; status: 400; retryable: false; meaning: "File name or prefix is empty, malformed, or too long." };
  readonly "FILES.INVALID_CURSOR":     { component: "FILES"; status: 400; retryable: false; meaning: "List cursor is malformed or belongs to another prefix." };
  readonly "FILES.NOT_FOUND":          { component: "FILES"; status: 404; retryable: false; meaning: "A download was requested for a file that does not exist." };
  readonly "FILES.UNAVAILABLE":        { component: "FILES"; status: 503; retryable: true;  meaning: "File storage could not be reached in time." };
  readonly "FILES.TRANSFER_FAILED":    { component: "FILES"; status: null; retryable: true;  meaning: "Browser upload or download did not complete." };
  readonly "FILES.TICKET_EXPIRED":     { component: "FILES"; status: null; retryable: false; meaning: "Transfer ticket expired before use; request a new one." };

  // CFG
  readonly "CFG.UNDECLARED_KEY":       { component: "CFG";   status: 500; retryable: false; meaning: "App read a configuration key it did not declare." };

  // SEC
  readonly "SEC.UNDECLARED":           { component: "SEC";   status: 500; retryable: false; meaning: "App read a secret name it did not declare." };
  readonly "SEC.MISSING":              { component: "SEC";   status: 500; retryable: false; meaning: "A declared secret has no value in this stage." };
  readonly "SEC.UNAVAILABLE":          { component: "SEC";   status: 503; retryable: true;  meaning: "The secret store could not be reached in time." };

  // AUTH
  readonly "AUTH.UNAUTHENTICATED":     { component: "AUTH";  status: 401; retryable: false; meaning: "The route requires a logged-in user." };
  readonly "AUTH.FORBIDDEN":           { component: "AUTH";  status: 403; retryable: false; meaning: "The user's access level is insufficient." };
  readonly "AUTH.REQUEST_FORGERY":     { component: "AUTH";  status: 403; retryable: false; meaning: "A state-changing request failed origin or forgery-token checks." };
  readonly "AUTH.LOGIN_FAILED":        { component: "AUTH";  status: 400; retryable: false; meaning: "Login could not be completed." };
};

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

/** Thrown by server-side framework interfaces. App code may also throw it with any code. */
export declare class FrameworkError extends Error {
  constructor(code: ErrorCode, message?: string);
  readonly code: ErrorCode;
}

/** HTTP error response body (see contracts/http/framework.openapi.yaml, ErrorResponse). */
export interface ErrorResponseBody {
  error: { code: ErrorCode; message: string; requestId: string };
}
