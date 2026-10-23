/**
 * Offline Google harness for the GOOGLE integration suite (B-T3), per the governing prompt §4:
 * hand-built tokens, global `fetch` stubbed, nothing contacts Google. The client ID below is an
 * obviously fake test value that exists only in this test file set.
 *
 * The provider is reached only through the framework-internal login-provider contract
 * (docs/contracts/ts/internal/login-provider.d.ts). Its factory name is B-T3 decision 7.
 */
import { createHash } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { vi } from "vitest";
import type { LoginProvider, ProviderContext } from "../../../../../docs/contracts/ts/internal/login-provider.js";

export const FAKE_CLIENT_ID = "fake-test-client-id.invalid";
export const FAKE_CLIENT_SECRET = "fake-test-client-secret-value";
export const CALLBACK_URL = "http://localhost:8787/api/auth/callback";

export const DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
export const ISSUER = "https://accounts.google.com";
export const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
export const KID = "b-t3-test-key";

export type GoogleModule = { createGoogleLoginProvider?: () => LoginProvider };

export async function googleProvider(): Promise<LoginProvider> {
  const mod = (await import("../../../src/google/public.js")) as GoogleModule;
  if (typeof mod.createGoogleLoginProvider !== "function") {
    throw new Error("src/google/public.ts does not export createGoogleLoginProvider() (B-T3 decision 7)");
  }
  return mod.createGoogleLoginProvider();
}

/** Provider context as AUTH would build it; records which secrets and config keys were read. */
export function providerContext(): ProviderContext & { readonly secretsRead: string[] } {
  const secretsRead: string[] = [];
  return {
    callbackUrl: CALLBACK_URL,
    secretsRead,
    getSecret: async (name: string) => {
      secretsRead.push(name);
      // B-T3 decision 7: the Google client secret is the framework-internal secret whose name mentions Google.
      if (/google/i.test(name)) return FAKE_CLIENT_SECRET;
      throw new Error(`unexpected secret ${name}`);
    },
    getConfig: (key: string) => {
      // B-T3 decision 7: accept the dotted key or either enclosing object.
      if (key === "framework.google.clientId" || key === "google.clientId" || key === "clientId") return FAKE_CLIENT_ID;
      if (key === "framework.google" || key === "google") return { clientId: FAKE_CLIENT_ID };
      if (key === "framework") return { google: { clientId: FAKE_CLIENT_ID } };
      return undefined;
    },
  };
}

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string;
}

export interface Keys {
  readonly privateKey: CryptoKey;
  readonly jwk: JWK;
  /** A different key presented under the same `kid` (wrong signature). */
  readonly otherPrivateKey: CryptoKey;
}

export async function makeKeys(): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };
  return { privateKey, jwk, otherPrivateKey: other.privateKey };
}

/**
 * Stubs global `fetch`: discovery, JWKS and token endpoints answer from memory; every other URL
 * answers 599 and is recorded as unexpected. `tokenResponse` builds the token endpoint's reply.
 */
export function stubGoogleFetch(keys: Keys): {
  readonly requests: RecordedRequest[];
  readonly unexpected: string[];
  tokenResponse: (req: RecordedRequest) => Promise<Response>;
} {
  const state = {
    requests: [] as RecordedRequest[],
    unexpected: [] as string[],
    tokenResponse: async (_req: RecordedRequest): Promise<Response> => new Response("{}", { status: 500 }),
  };
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const recorded: RecordedRequest = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: await request.clone().text(),
    };
    state.requests.push(recorded);
    const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
    if (recorded.url === DISCOVERY_URL) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: AUTHORIZATION_ENDPOINT,
        token_endpoint: TOKEN_ENDPOINT,
        jwks_uri: JWKS_URI,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        scopes_supported: ["openid", "email", "profile"],
        code_challenge_methods_supported: ["plain", "S256"],
      });
    }
    if (recorded.url === JWKS_URI) return json({ keys: [keys.jwk] });
    if (recorded.url === TOKEN_ENDPOINT) return state.tokenResponse(recorded);
    state.unexpected.push(recorded.url);
    return new Response("unexpected URL in offline test", { status: 599 });
  };
  vi.stubGlobal("fetch", stub);
  return state;
}

export interface Claims {
  iss?: string;
  aud?: string;
  sub?: string;
  name?: string;
  nonce?: string;
  iat?: number;
  exp?: number;
}

/** A hand-built ID token. `extraHeader` can add token-supplied URLs (jku, x5u) that must never be fetched. */
export async function idToken(key: CryptoKey, claims: Claims, extraHeader: Record<string, string> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: claims.iss ?? ISSUER,
    aud: claims.aud ?? FAKE_CLIENT_ID,
    sub: claims.sub ?? "1234567890-test-subject",
    iat: claims.iat ?? now,
    exp: claims.exp ?? now + 3600,
  };
  if (claims.nonce !== undefined) payload["nonce"] = claims.nonce;
  if (claims.name !== undefined) payload["name"] = claims.name;
  return new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: KID, typ: "JWT", ...extraHeader }).sign(key);
}

export function tokenJson(id_token: string): Response {
  return new Response(
    JSON.stringify({ access_token: "fake-access-token", expires_in: 3599, token_type: "Bearer", scope: "openid profile", id_token }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** base64url(SHA-256(verifier)): the S256 PKCE challenge (RFC 7636). */
export function s256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
