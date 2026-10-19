/**
 * GOOGLE login provider (docs/components/google.md): OIDC authorization-code flow with PKCE,
 * state and nonce; server-side token exchange; ID-token validation with jose.
 * Web APIs only, so it runs in every target runtime.
 */
import { createRemoteJWKSet, customFetch, errors as joseErrors, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import { FrameworkError } from "../core/errors.js";
import type { LoginProvider, ProviderContext } from "./login-provider.js";

export type { BeginLoginResult, LoginProvider, ProviderContext, ProviderIdentity } from "./login-provider.js";

/** Google's fixed well-known discovery URL (GOOGLE §2). */
export const GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
/** Configuration key holding the client ID (stage-config `framework.google.clientId`). */
export const GOOGLE_CLIENT_ID_KEY = "framework.google.clientId";
/** Framework-internal secret holding the client secret (SEC reserved `framework` prefix). */
export const GOOGLE_CLIENT_SECRET_NAME = "frameworkGoogleClientSecret";
/** GOOGLE-REQ-003: only `openid` and `profile`. */
export const GOOGLE_SCOPE = "openid profile";
/** Google's documented ID-token issuer values. */
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
/** PAR-252: clock skew tolerated when validating provider responses. */
export const CLOCK_SKEW_SECONDS = 60;

export interface GoogleProviderOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Injectable clock for token time checks; defaults to the current time. */
  readonly now?: () => Date;
}

interface Discovery {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

/** Provider-private state carried by AUTH's transaction cookie. */
interface Transaction {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url: 43 characters (also a valid PKCE verifier). */
function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function clientId(ctx: ProviderContext): string {
  const value = ctx.getConfig(GOOGLE_CLIENT_ID_KEY);
  if (typeof value !== "string" || value === "") {
    throw new FrameworkError("CORE.MISCONFIGURED", `${GOOGLE_CLIENT_ID_KEY} is not set`);
  }
  return value;
}

function loginFailed(reason: string): FrameworkError {
  return new FrameworkError("AUTH.LOGIN_FAILED", reason);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function readTransaction(raw: string): Transaction {
  let tx: unknown;
  try {
    tx = JSON.parse(raw);
  } catch {
    tx = undefined;
  }
  const t = tx as Partial<Transaction> | undefined;
  if (!t || typeof t.state !== "string" || typeof t.nonce !== "string" || typeof t.verifier !== "string") {
    throw loginFailed("transaction missing or expired");
  }
  return { state: t.state, nonce: t.nonce, verifier: t.verifier };
}

const CLAIM_CHECK: Readonly<Record<string, string>> = {
  iss: "issuer",
  aud: "audience",
  exp: "expiry",
  iat: "issued-at",
  nbf: "issued-at",
  sub: "subject",
  nonce: "nonce",
};

/** jose's failure → the one check AUTH logs (auth.md "Failed login"). */
function checkName(err: unknown): string {
  if (err instanceof joseErrors.JWTClaimValidationFailed || err instanceof joseErrors.JWTExpired) {
    return CLAIM_CHECK[err.claim] ?? err.claim;
  }
  if (err instanceof joseErrors.JOSEError && err.code === "ERR_JWKS_TIMEOUT") return "signing keys unavailable";
  return "signature";
}

/** GOOGLE-REQ-002. Keys come only from the discovery document's `jwks_uri`, never from the token. */
async function verifyIdToken(token: string, keys: ReturnType<typeof createRemoteJWKSet>, audience: string, nonce: string, currentDate?: Date): Promise<JWTPayload> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"],
      issuer: GOOGLE_ISSUERS,
      audience,
      clockTolerance: CLOCK_SKEW_SECONDS,
      requiredClaims: ["sub", "iat", "exp"],
      ...(currentDate ? { currentDate } : {}),
    }));
  } catch (err) {
    throw loginFailed(`token check failed: ${checkName(err)}`);
  }
  const now = Math.floor((currentDate ?? new Date()).getTime() / 1000);
  if (typeof payload.iat !== "number" || payload.iat > now + CLOCK_SKEW_SECONDS) throw loginFailed("token check failed: issued-at");
  if (payload["nonce"] !== nonce) throw loginFailed("token check failed: nonce");
  return payload;
}

export function createGoogleLoginProvider(options: GoogleProviderOptions = {}): LoginProvider {
  // Resolved per call, so a runtime (or test) that replaces global fetch later is honoured.
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

  let discovered: Discovery | undefined;

  /** Fetched from the fixed URL once per instance (isolate); a failure is retried next login. */
  async function discover(): Promise<Discovery> {
    if (discovered) return discovered;
    let res: Response;
    try {
      res = await doFetch(GOOGLE_DISCOVERY_URL, { headers: { accept: "application/json" } });
    } catch {
      throw loginFailed("provider discovery failed (no response)");
    }
    if (!res.ok) throw loginFailed(`provider discovery failed (HTTP ${res.status})`);
    const doc = (await res.json().catch(() => undefined)) as Partial<Discovery> | undefined;
    const fields = [doc?.authorization_endpoint, doc?.token_endpoint, doc?.jwks_uri];
    if (!doc || !fields.every(isHttpsUrl)) throw loginFailed("provider discovery failed (invalid document)");
    discovered = { authorization_endpoint: fields[0] as string, token_endpoint: fields[1] as string, jwks_uri: fields[2] as string };
    return discovered;
  }

  return {
    id: "google",
    async beginLogin(ctx) {
      const id = clientId(ctx);
      const doc = await discover();
      const tx: Transaction = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
      const url = new URL(doc.authorization_endpoint);
      const p = url.searchParams;
      p.set("response_type", "code");
      p.set("client_id", id);
      p.set("redirect_uri", ctx.callbackUrl);
      p.set("scope", GOOGLE_SCOPE);
      p.set("state", tx.state);
      p.set("nonce", tx.nonce);
      p.set("code_challenge", await pkceChallenge(tx.verifier));
      p.set("code_challenge_method", "S256");
      return { redirectUrl: url.href, transactionState: JSON.stringify(tx) };
    },
    async completeLogin(ctx, query, transactionState) {
      const id = clientId(ctx);
      const tx = readTransaction(transactionState);
      if (query.get("state") !== tx.state) throw loginFailed("state mismatch");
      const code = query.get("code");
      if (query.has("error") || !code) throw loginFailed("provider refused");
      const doc = await discover();
      const secret = await ctx.getSecret(GOOGLE_CLIENT_SECRET_NAME);
      let res: Response;
      try {
        res = await doFetch(doc.token_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: ctx.callbackUrl,
            client_id: id,
            client_secret: secret,
            code_verifier: tx.verifier,
          }).toString(),
        });
      } catch {
        throw loginFailed("token exchange rejected (no response)");
      }
      if (!res.ok) throw loginFailed(`token exchange rejected (HTTP ${res.status})`);
      const body = (await res.json().catch(() => ({}))) as { id_token?: unknown };
      if (typeof body.id_token !== "string") throw loginFailed(`token exchange rejected (HTTP ${res.status}, no ID token)`);
      jwks ??= createRemoteJWKSet(new URL(doc.jwks_uri), { [customFetch]: doFetch });
      const payload = await verifyIdToken(body.id_token, jwks, id, tx.nonce, options.now?.());
      return {
        subject: String(payload.sub),
        displayName: typeof payload["name"] === "string" ? payload["name"] : null,
      };
    },
  };
}
