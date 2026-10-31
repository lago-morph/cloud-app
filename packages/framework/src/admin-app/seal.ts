/**
 * Signed cookie values of the admin app (DEC-0710): `<base64url(JSON {p, x, v})>.<base64url(HMAC-SHA-256)>`,
 * where `p` is the purpose ("session" or "grant"), `x` the expiry in ms and `v` the payload. The
 * admin app has no storage of its own, so its short session and its grant transaction (state, PKCE
 * verifier, nonce) live in these cookies, which the browser cannot change or reuse for the other
 * purpose. The key is the admin client's secret, which only the admin app holds: setting up the
 * clients again (a new secret) ends every session. Values never hold a Cloudflare token.
 */
import { base64urlDecode, base64urlEncode } from "../auth/signing.js";

export type SealPurpose = "session" | "grant";

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret === "") return Promise.reject(new Error("admin app misconfigured: no signing key"));
  let key = keys.get(secret);
  if (key === undefined) {
    // A label keeps this use of the secret apart from its use as the client secret.
    key = crypto.subtle.importKey("raw", new TextEncoder().encode(`prototype-admin-cookie:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    if (keys.size > 4) keys.clear();
    keys.set(secret, key);
  }
  return key;
}

/** The sealed value of `payload` for `purpose`, valid until `expiresAt` (ms). */
export async function seal(secret: string, purpose: SealPurpose, payload: unknown, expiresAt: number): Promise<string> {
  const key = await hmacKey(secret);
  const body = base64urlEncode(new TextEncoder().encode(JSON.stringify({ p: purpose, x: expiresAt, v: payload })));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `${body}.${base64urlEncode(mac)}`;
}

/** The payload of a valid, unexpired value sealed for `purpose`, else null. */
export async function open(secret: string, purpose: SealPurpose, value: string, now: number): Promise<unknown> {
  const key = await hmacKey(secret);
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body = "", macText = ""] = parts;
  const bytes = base64urlDecode(body);
  const mac = base64urlDecode(macText);
  if (bytes === undefined || mac === undefined) return null;
  if (!(await crypto.subtle.verify("HMAC", key, new Uint8Array(mac), new TextEncoder().encode(body)))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  const { p, x, v } = (parsed ?? {}) as { p?: unknown; x?: unknown; v?: unknown };
  if (p !== purpose || typeof x !== "number" || now >= x) return null;
  return v ?? null;
}
