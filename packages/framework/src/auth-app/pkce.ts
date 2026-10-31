/**
 * PKCE S256 (RFC 7636) and random tokens for the auth app's Cloudflare sign-in (plan §4.1 step 2).
 * Only S256 is ever sent; `plain` is never used although Cloudflare offers it (§2.1). WebCrypto
 * only, so it runs in workerd and Node alike.
 */
import { base64urlEncode } from "../auth/signing.js";

/** base64url (unpadded) of `bytes` cryptographically random bytes. */
export function randomToken(bytes: number): string {
  return base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The S256 code challenge of a verifier: base64url(SHA-256(ASCII(verifier))). */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64urlEncode(new Uint8Array(digest));
}

/** A fresh verifier (32 random bytes, 43 characters) and its S256 challenge. */
export async function createPkce(): Promise<{ verifier: string; challenge: string; method: "S256" }> {
  const verifier = randomToken(32);
  return { verifier, challenge: await s256Challenge(verifier), method: "S256" };
}
