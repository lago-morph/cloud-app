/**
 * Request validation (HTTP-REQ-003; http.md §2 "Validation").
 */
import type { Env, MiddlewareHandler } from "hono";
import { z } from "zod";
import { FrameworkError } from "../core/errors.js";

/** PAR-200: the largest JSON request body, in bytes. */
export const MAX_JSON_BODY_BYTES = 1_000_000;

function tooLarge(): FrameworkError {
  return new FrameworkError("HTTP.PAYLOAD_TOO_LARGE", `request body exceeds ${MAX_JSON_BODY_BYTES} bytes`);
}

/**
 * The request body as text, refused with `HTTP.PAYLOAD_TOO_LARGE` when `Content-Length` or the
 * bytes actually streamed exceed PAR-200; reading stops at the first byte over the limit.
 */
async function readLimitedText(request: Request): Promise<string> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_JSON_BODY_BYTES) throw tooLarge();
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** `HTTP.INVALID_INPUT` naming each failing field; input values are not repeated. */
function invalid(where: string, error: z.ZodError): FrameworkError {
  const issues = error.issues.map((i) => `${[where, ...i.path.map(String)].join(".")}: ${i.message}`);
  return new FrameworkError("HTTP.INVALID_INPUT", issues.join("; "));
}

/**
 * Validates the JSON request body against `schema` before the handler runs. Rejects with
 * HTTP.INVALID_INPUT or HTTP.PAYLOAD_TOO_LARGE. The parsed value is available via
 * `c.req.valid("json")`.
 */
export function jsonBody<T extends z.ZodType>(
  schema: T,
): MiddlewareHandler<Env, string, { in: { json: z.input<T> }; out: { json: z.output<T> } }> {
  return async (c, next) => {
    const text = await readLimitedText(c.req.raw);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new FrameworkError("HTTP.INVALID_INPUT", "request body is not valid JSON");
    }
    const parsed = await schema.safeParseAsync(value);
    if (!parsed.success) throw invalid("body", parsed.error);
    c.req.addValidatedData("json", parsed.data as object);
    await next();
  };
}

/**
 * Validates query parameters likewise; parsed value via `c.req.valid("query")`. The schema
 * sees one string per name (the first value), as `c.req.query()` gives them.
 */
export function queryParams<T extends z.ZodType>(
  schema: T,
): MiddlewareHandler<Env, string, { in: { query: z.input<T> }; out: { query: z.output<T> } }> {
  return async (c, next) => {
    const parsed = await schema.safeParseAsync(c.req.query());
    if (!parsed.success) throw invalid("query", parsed.error);
    c.req.addValidatedData("query", parsed.data as object);
    await next();
  };
}
