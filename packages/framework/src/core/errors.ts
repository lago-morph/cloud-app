/**
 * Framework error catalogue (SYS-REQ-010, CORE-REQ-004).
 *
 * Transcribed from the contract docs/contracts/ts/errors.d.ts, which is the single source of
 * truth for error codes. Every failure a framework interface surfaces to app code, to the
 * browser helpers, or over HTTP carries one of these codes. Codes are durable identifiers:
 * never renumbered, renamed, or reused. Messages are informative only and must never be used
 * for control flow.
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

export const ERROR_CATALOGUE = {
  // CORE
  "CORE.INTERNAL":            { status: 500, retryable: false, meaning: "Unexpected failure. Details are logged, never returned." },
  "CORE.MISCONFIGURED":       { status: 500, retryable: false, meaning: "The deployment's configuration or wiring is invalid." },

  // HTTP
  "HTTP.INVALID_INPUT":       { status: 400, retryable: false, meaning: "Request body, query, or parameters failed validation." },
  "HTTP.NOT_FOUND":           { status: 404, retryable: false, meaning: "No such API route, or the app reported a missing resource." },
  "HTTP.METHOD_NOT_ALLOWED":  { status: 405, retryable: false, meaning: "Route exists but not for this method." },
  "HTTP.PAYLOAD_TOO_LARGE":   { status: 413, retryable: false, meaning: "Request body exceeds the framework limit." },
  "HTTP.CONFLICT":            { status: 409, retryable: false, meaning: "The app refused the request because of the current state or a limit." },
  "HTTP.NETWORK_ERROR":       { status: null, retryable: true,  meaning: "The browser helper could not reach the API or did not receive a framework response." },

  // SQL
  "SQL.CONFLICT":             { status: 409, retryable: false, meaning: "A uniqueness or reference constraint was violated." },
  "SQL.INVALID_VALUE":        { status: 400, retryable: false, meaning: "A value does not satisfy its portable column type." },
  "SQL.UNAVAILABLE":          { status: 503, retryable: true,  meaning: "The database could not be reached in time." },
  "SQL.RESULT_TOO_LARGE":     { status: 500, retryable: false, meaning: "A query result exceeds the portable result size limit; paginate." },

  // KV
  "KV.INVALID_KEY":           { status: 400, retryable: false, meaning: "Key or prefix is empty, malformed, or too long." },
  "KV.INVALID_CURSOR":        { status: 400, retryable: false, meaning: "List cursor is malformed or belongs to another prefix." },
  "KV.VALUE_TOO_LARGE":       { status: 413, retryable: false, meaning: "Value exceeds the KV value size limit." },
  "KV.UNAVAILABLE":           { status: 503, retryable: true,  meaning: "Key-value storage could not be used in time." },

  // FILES
  "FILES.INVALID_NAME":       { status: 400, retryable: false, meaning: "File name or prefix is empty, malformed, or too long." },
  "FILES.INVALID_CURSOR":     { status: 400, retryable: false, meaning: "List cursor is malformed or belongs to another prefix." },
  "FILES.NOT_FOUND":          { status: 404, retryable: false, meaning: "A download was requested for a file that does not exist." },
  "FILES.UNAVAILABLE":        { status: 503, retryable: true,  meaning: "File storage could not be reached in time." },
  "FILES.TRANSFER_FAILED":    { status: null, retryable: true,  meaning: "Browser transfer did not complete; request a new ticket and retry." },

  // CFG
  "CFG.UNDECLARED_KEY":       { status: 500, retryable: false, meaning: "App read a configuration key it did not declare." },

  // SEC
  "SEC.UNDECLARED":           { status: 500, retryable: false, meaning: "App read a secret name it did not declare." },
  "SEC.MISSING":              { status: 500, retryable: false, meaning: "A declared secret has no value in this stage." },
  "SEC.UNAVAILABLE":          { status: 503, retryable: true,  meaning: "The secret store could not be reached in time." },

  // AUTH
  "AUTH.UNAUTHENTICATED":     { status: 401, retryable: false, meaning: "The route requires a logged-in user." },
  "AUTH.FORBIDDEN":           { status: 403, retryable: false, meaning: "The user's access level is insufficient, or the user may see the resource but not change it." },
  "AUTH.REQUEST_FORGERY":     { status: 403, retryable: false, meaning: "A state-changing request with a session came from another origin." },
  "AUTH.LOGIN_FAILED":        { status: 400, retryable: false, meaning: "Login could not be completed." },
} as const satisfies Readonly<Record<string, ErrorCatalogueEntry>>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

/** Thrown by server-side framework interfaces. App code may also throw it, only with the codes CORE-REQ-007 allows. */
export class FrameworkError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message);
    this.name = "FrameworkError";
    this.code = code;
  }
}

/** HTTP error response body (see contracts/http/framework.openapi.yaml, ErrorResponse). */
export interface ErrorResponseBody {
  error: { code: ErrorCode; message: string; requestId: string };
}
