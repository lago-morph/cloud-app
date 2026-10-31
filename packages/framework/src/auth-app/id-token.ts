/**
 * ID-token check against the issuer's JWKS (plan §4.1 step 3.2). Cloudflare signs with RS256
 * (§2.1), so only RS256 is accepted: `none`, HMAC and other algorithms are refused before any key
 * is used. Checks, in order: shape, alg, key, signature, `iss`, `aud`, `nonce`, `exp` (with
 * PAR-417 leeway), `sub`. Each refusal is a SignInError with one fixed reason.
 */
import { base64urlDecode } from "../auth/signing.js";
import { SignInError } from "./errors.js";
import { ID_TOKEN_LEEWAY_S } from "./params.js";

export interface IdTokenIdentity {
  readonly sub: string;
  /** `email` from the token, or null when absent (then the caller reads `/user`, plan §10). */
  readonly email: string | null;
  readonly emailVerified: boolean | null;
}

export interface IdTokenCheck {
  readonly keys: readonly JsonWebKey[];
  readonly issuer: string;
  readonly clientId: string;
  readonly nonce: string;
  readonly nowSeconds: number;
}

const refuse = (what: string): never => {
  throw new SignInError(`id token: ${what}`);
};

function decodeJson(part: string): Record<string, unknown> {
  const bytes = base64urlDecode(part);
  if (bytes === undefined) return refuse("malformed");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return refuse("malformed");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse("malformed");
  return value as Record<string, unknown>;
}

function chooseKey(keys: readonly JsonWebKey[], kid: unknown): JsonWebKey {
  const rsa = keys.filter((k) => k.kty === "RSA");
  const found = kid === undefined && rsa.length === 1 ? rsa[0] : rsa.find((k) => (k as { kid?: unknown }).kid === kid);
  return found ?? refuse("unknown key");
}

export async function verifyIdToken(token: string, check: IdTokenCheck): Promise<IdTokenIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) refuse("malformed");
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson(h);
  const claims = decodeJson(p);
  if (header.alg !== "RS256") refuse("unsupported alg");
  const jwk = chooseKey(check.keys, header.kid);
  const signature = new Uint8Array(base64urlDecode(s) ?? refuse("bad signature"));
  if (typeof jwk.n !== "string" || typeof jwk.e !== "string") refuse("unknown key");
  const publicJwk: JsonWebKey = { kty: "RSA", n: jwk.n as string, e: jwk.e as string, alg: "RS256", ext: true };

  let ok = false;
  try {
    const key = await crypto.subtle.importKey("jwk", publicJwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${h}.${p}`));
  } catch {
    ok = false;
  }
  if (!ok) refuse("bad signature");

  if (claims.iss !== check.issuer) refuse("wrong iss");
  const aud = claims.aud;
  const audOk = typeof aud === "string" ? aud === check.clientId : Array.isArray(aud) && aud.includes(check.clientId);
  if (!audOk) refuse("wrong aud");
  if (typeof claims.nonce !== "string" || claims.nonce !== check.nonce) refuse("wrong nonce");
  if (typeof claims.exp !== "number" || check.nowSeconds > claims.exp + ID_TOKEN_LEEWAY_S) refuse("expired");
  if (typeof claims.sub !== "string" || claims.sub === "") refuse("no sub");

  return {
    sub: claims.sub as string,
    email: typeof claims.email === "string" && claims.email !== "" ? claims.email : null,
    emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : null,
  };
}
