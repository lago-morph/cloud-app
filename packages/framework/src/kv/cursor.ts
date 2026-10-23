/**
 * The list cursor (KV-REQ-003, kv.md §2): base64url (no padding) of the UTF-8 JSON
 * `[prefix, lastKey]`. Opaque to apps; valid only for the prefix it was issued for. Anything
 * that does not decode to exactly that form is `KV.INVALID_CURSOR`.
 */
import { FrameworkError } from "../core/errors.js";
import { checkKey } from "./rules.js";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The cursor continuing a listing of `prefix` after `lastKey`. */
export function encodeCursor(prefix: string, lastKey: string): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify([prefix, lastKey])));
}

/** The last key returned, from a cursor issued for `prefix`; else `KV.INVALID_CURSOR`. */
export function decodeCursor(cursor: string, prefix: string): string {
  const invalid = (why: string) => new FrameworkError("KV.INVALID_CURSOR", `the list cursor ${why}`);
  if (typeof cursor !== "string" || !BASE64URL.test(cursor)) throw invalid("is malformed");
  let decoded: unknown;
  try {
    const bytes = fromBase64Url(cursor);
    if (toBase64Url(bytes) !== cursor) throw new Error("not canonical");
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalid("is malformed");
  }
  if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || typeof decoded[1] !== "string") throw invalid("is malformed");
  const [issuedFor, lastKey] = decoded as [string, string];
  if (issuedFor !== prefix) throw invalid("belongs to another prefix");
  if (!lastKey.startsWith(prefix)) throw invalid("is malformed");
  try {
    checkKey(lastKey);
  } catch {
    throw invalid("is malformed");
  }
  return lastKey;
}
