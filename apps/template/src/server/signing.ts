import { now } from "@lago-morph/prototype-framework";

/**
 * Signed tokens such as share links: `<subject>.<expiresAt>.<signature>`, signed with HMAC-SHA-256
 * through `crypto.subtle` and encoded as base64url, with Web APIs only (no `Buffer`). Pass a key from
 * a declared secret, for example `await c.var.secrets.get("shareKey")`. The subject must not contain ".".
 */
const encoder = new TextEncoder();

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

/** A token for `subject` that verifies until `expiresAt` (milliseconds since the epoch). */
export async function signToken(secret: string, subject: string, expiresAt: number): Promise<string> {
  const payload = `${subject}.${String(expiresAt)}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64url(new Uint8Array(signature))}`;
}

/** The token's subject if `secret` signed it and it has not expired; otherwise null. Never throws on bad input. */
export async function verifyToken(secret: string, token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [subject = "", expires = "", signatureText = ""] = parts;
  const signature = fromBase64url(signatureText);
  if (subject === "" || !/^\d+$/.test(expires) || signature === null) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, encoder.encode(`${subject}.${expires}`));
  return valid && now() < Number(expires) ? subject : null;
}
