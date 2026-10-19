/**
 * User-ID derivation (AUTH-REQ-002, auth.md §2 "User ID", DEC-0067): `u_` followed by the first
 * 26 characters of the RFC 4648 base32 encoding (upper case, no padding) of
 * SHA-256(`<provider id>:<subject>`). Workers-compatible (Web Crypto only).
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ENCODED_LENGTH = 26;

/** RFC 4648 base32, upper case, no padding. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export async function deriveUserId(providerId: string, subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${providerId}:${subject}`));
  return `u_${base32(new Uint8Array(digest)).slice(0, ENCODED_LENGTH)}`;
}
