/** Unpadded base64url (RFC 4648 §5) for bytes and UTF-8 text. Workers-compatible. */

export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Undefined when `text` is not the canonical unpadded base64url of some bytes. `atob` ignores the
 * unused low bits of the last character, so the re-encode check gives each value one spelling, as
 * in `auth/signing.ts` and `kv/cursor.ts` (root cause 2026-10-31-T4-files-base64url-noncanonical).
 */
export function base64urlToBytes(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return bytesToBase64url(bytes) === text ? bytes : undefined;
}

export function textToBase64url(text: string): string {
  return bytesToBase64url(new TextEncoder().encode(text));
}

/** Undefined when `text` is not base64url of well-formed UTF-8. A leading byte order mark is kept in the text, not dropped. */
export function base64urlToText(text: string): string | undefined {
  const bytes = base64urlToBytes(text);
  if (bytes === undefined) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
