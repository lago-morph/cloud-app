/**
 * KV key, prefix and value rules (KV-REQ-002). Checked before anything reaches the database.
 */
import { FrameworkError } from "../core/errors.js";

/** PAR-220: maximum key (and prefix) length in UTF-8 bytes. */
export const MAX_KEY_BYTES = 1024;
/** PAR-223: maximum value length in UTF-8 bytes. */
export const MAX_VALUE_BYTES = 4096;

// Code-unit regex (no `u` flag): a high surrogate not followed by a low one, or a low one not
// preceded by a high one. (`String.prototype.isWellFormed` is ES2024; the lib set is ES2023.)
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** UTF-8 length of well-formed text. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function wellFormed(value: unknown): value is string {
  return typeof value === "string" && !LONE_SURROGATE.test(value);
}

/** A key: non-empty, well-formed, at most PAR-220 bytes; else `KV.INVALID_KEY`. */
export function checkKey(key: string): void {
  if (!wellFormed(key)) throw new FrameworkError("KV.INVALID_KEY", "a key must be well-formed Unicode text");
  if (key.length === 0) throw new FrameworkError("KV.INVALID_KEY", "a key must not be empty");
  if (utf8Bytes(key) > MAX_KEY_BYTES) throw new FrameworkError("KV.INVALID_KEY", `a key must be at most ${MAX_KEY_BYTES} UTF-8 bytes (PAR-220)`);
}

/**
 * A list prefix: well-formed, at most PAR-220 bytes (a longer one matches no key); else
 * `KV.INVALID_KEY`. The empty prefix lists every key (DEC-PENDING-B-08-2).
 */
export function checkPrefix(prefix: string): void {
  if (!wellFormed(prefix)) throw new FrameworkError("KV.INVALID_KEY", "a prefix must be well-formed Unicode text");
  if (utf8Bytes(prefix) > MAX_KEY_BYTES) throw new FrameworkError("KV.INVALID_KEY", `a prefix must be at most ${MAX_KEY_BYTES} UTF-8 bytes (PAR-220)`);
}

/**
 * A value: well-formed (else `KV.INVALID_KEY`, as KV-REQ-002 says), at most PAR-223 bytes (else
 * `KV.VALUE_TOO_LARGE`). The empty string is a value (DEC-PENDING-B-08-1).
 */
export function checkValue(value: string): void {
  if (!wellFormed(value)) throw new FrameworkError("KV.INVALID_KEY", "a value must be well-formed Unicode text");
  if (utf8Bytes(value) > MAX_VALUE_BYTES) throw new FrameworkError("KV.VALUE_TOO_LARGE", `a value must be at most ${MAX_VALUE_BYTES} UTF-8 bytes (PAR-223)`);
}
