/**
 * `list` cursors (FILES-REQ-001, paginating like KV-REQ-003). A cursor is opaque to apps; it
 * holds the prefix it was issued for and the last name returned, and the next page starts after
 * that name. Target-neutral: every object store can list "after" a key.
 */
import { FrameworkError } from "../core/errors.js";
import { base64urlToText, textToBase64url } from "./base64url.js";

export function encodeCursor(prefix: string, lastName: string): string {
  return textToBase64url(JSON.stringify({ p: prefix, a: lastName }));
}

/** The last name returned by the previous page, or FILES.INVALID_CURSOR. */
export function decodeCursor(prefix: string, cursor: string): string {
  const invalid = (why: string) => new FrameworkError("FILES.INVALID_CURSOR", `the list cursor ${why}`);
  const json = typeof cursor === "string" && cursor !== "" ? base64urlToText(cursor) : undefined;
  if (json === undefined) throw invalid("is malformed");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalid("is malformed");
  }
  const { p, a } = (typeof parsed === "object" && parsed !== null ? parsed : {}) as { p?: unknown; a?: unknown };
  if (typeof p !== "string" || typeof a !== "string" || !a.startsWith(p)) throw invalid("is malformed");
  if (p !== prefix) throw invalid("was issued for another prefix");
  return a;
}
