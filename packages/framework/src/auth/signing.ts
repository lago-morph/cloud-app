/**
 * Signed browser tokens for the session and transaction cookies (auth.md §2 "Session cookie",
 * "Login"): `<base64url(JSON payload)>.<base64url(HMAC-SHA-256)>`. The MAC covers the purpose
 * and the payload, so a token made for one cookie is never accepted as the other. The key is
 * the framework-internal session key (SEC), at least PAR-253 bytes. Workers-compatible.
 */
import { FrameworkError } from "../core/errors.js";

/** PAR-253: minimum session signing key length, in bytes. */
export const MIN_SESSION_KEY_BYTES = 32;

export type TokenPurpose = "session" | "login";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict decode: only canonical unpadded base64url is accepted. */
export function base64urlDecode(text: string): Uint8Array | undefined {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return undefined;
  let binary: string;
  try {
    binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return undefined;
  }
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return base64urlEncode(bytes) === text ? bytes : undefined;
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret);
  if (raw.byteLength < MIN_SESSION_KEY_BYTES) {
    throw new FrameworkError(
      "CORE.MISCONFIGURED",
      `the session signing key is shorter than ${MIN_SESSION_KEY_BYTES} bytes (PAR-253)`,
    );
  }
  let key = keys.get(secret);
  if (key === undefined) {
    key = crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    // One stage has one key; the cache stays tiny.
    if (keys.size > 8) keys.clear();
    keys.set(secret, key);
  }
  return key;
}

function signedData(purpose: TokenPurpose, payload: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${purpose}.${payload}`);
}

export async function signToken(secret: string, purpose: TokenPurpose, payload: unknown): Promise<string> {
  const key = await hmacKey(secret);
  const body = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, signedData(purpose, body)));
  return `${body}.${base64urlEncode(mac)}`;
}

/** The payload of a valid token for `purpose`, or undefined for anything else. */
export async function verifyToken(secret: string, purpose: TokenPurpose, token: string): Promise<unknown> {
  const key = await hmacKey(secret);
  const parts = token.split(".");
  if (parts.length !== 2) return undefined;
  const [body = "", macText = ""] = parts;
  const payload = base64urlDecode(body);
  const mac = base64urlDecode(macText);
  if (payload === undefined || mac === undefined) return undefined;
  const ok = await crypto.subtle.verify("HMAC", key, new Uint8Array(mac), signedData(purpose, body));
  if (!ok) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as unknown;
  } catch {
    return undefined;
  }
}
