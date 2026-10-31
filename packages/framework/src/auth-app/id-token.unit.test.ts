/**
 * ID-token checks against the JWKS (plan §4.1 step 3.2: iss, aud, nonce, exp; RS256, §2.1;
 * §7 "wrong aud, wrong nonce, expired"). Real RS256 signatures from a key made in the test.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { base64urlEncode } from "../auth/signing.js";
import { makeSigningKey, type SignedKey } from "./fake-upstream.test-support.js";
import { ID_TOKEN_LEEWAY_S } from "./params.js";
import { SignInError } from "./errors.js";
import { verifyIdToken } from "./id-token.js";

const ISS = "https://dash.example.test";
const AUD = "signin-client";
const NONCE = "nonce-1";
const NOW = 1_800_000_000;

let key: SignedKey;
let other: SignedKey;
beforeAll(async () => {
  key = await makeSigningKey("k1");
  other = await makeSigningKey("k2");
});

const claims = (over: Record<string, unknown> = {}) => ({ iss: ISS, aud: AUD, sub: "sub-1", nonce: NONCE, iat: NOW - 10, exp: NOW + 3600, email: "a@example.com", email_verified: true, ...over });
const check = (token: string, keys: JsonWebKey[] = [key.jwk]) => verifyIdToken(token, { keys, issuer: ISS, clientId: AUD, nonce: NONCE, nowSeconds: NOW });

async function reason(p: Promise<unknown>): Promise<string> {
  const e = await p.then(() => undefined, (err: unknown) => err);
  expect(e).toBeInstanceOf(SignInError);
  return (e as SignInError).reason;
}

describe("verifyIdToken", () => {
  it("returns sub, email and email_verified of a valid token", async () => {
    await expect(check(await key.sign(claims()))).resolves.toEqual({ sub: "sub-1", email: "a@example.com", emailVerified: true });
  });

  it("accepts aud as an array that holds the client ID, with azp naming it when there are several", async () => {
    await expect(check(await key.sign(claims({ aud: [AUD] })))).resolves.toMatchObject({ sub: "sub-1" });
    await expect(check(await key.sign(claims({ aud: ["x", AUD], azp: AUD })))).resolves.toMatchObject({ sub: "sub-1" });
  });

  it("refuses several audiences without azp, and any azp that is not the client (OIDC Core 3.1.3.7)", async () => {
    expect(await reason(check(await key.sign(claims({ aud: ["x", AUD] }))))).toBe("id token: wrong aud");
    expect(await reason(check(await key.sign(claims({ aud: ["x", AUD], azp: "x" }))))).toBe("id token: wrong aud");
    expect(await reason(check(await key.sign(claims({ azp: "x" }))))).toBe("id token: wrong aud");
  });

  it("refuses when the expected nonce is empty, even if the token's is empty too", async () => {
    const token = await key.sign(claims({ nonce: "" }));
    expect(await reason(verifyIdToken(token, { keys: [key.jwk], issuer: ISS, clientId: AUD, nonce: "", nowSeconds: NOW }))).toBe("id token: wrong nonce");
  });

  it("refuses a token with a crit header (RFC 7515 4.1.11)", async () => {
    expect(await reason(check(await key.sign(claims(), { crit: ["exp"] })))).toBe("id token: unsupported header");
  });

  it("verifies with the key named by kid when the JWKS holds several (rotation)", async () => {
    await expect(check(await other.sign(claims()), [key.jwk, other.jwk])).resolves.toMatchObject({ sub: "sub-1" });
  });

  it("refuses a token without kid when the JWKS holds several keys, and a non-string kid", async () => {
    expect(await reason(check(await key.sign(claims(), { kid: undefined }), [key.jwk, other.jwk]))).toBe("id token: unknown key");
    expect(await reason(check(await key.sign(claims(), { kid: 1 })))).toBe("id token: unknown key");
  });

  it("refuses a key meant for encryption or another algorithm, under the right kid", async () => {
    expect(await reason(check(await key.sign(claims()), [{ ...key.jwk, use: "enc" }]))).toBe("id token: unknown key");
    expect(await reason(check(await key.sign(claims()), [{ ...key.jwk, alg: "RS512" }]))).toBe("id token: unknown key");
  });

  it("returns email null when the token carries none (the /user fallback, §10)", async () => {
    await expect(check(await key.sign(claims({ email: undefined, email_verified: undefined })))).resolves.toEqual({ sub: "sub-1", email: null, emailVerified: null });
  });

  it("refuses a wrong aud", async () => {
    expect(await reason(check(await key.sign(claims({ aud: "other-client" }))))).toBe("id token: wrong aud");
    expect(await reason(check(await key.sign(claims({ aud: [] }))))).toBe("id token: wrong aud");
  });

  it("refuses a wrong or missing nonce", async () => {
    expect(await reason(check(await key.sign(claims({ nonce: "nonce-2" }))))).toBe("id token: wrong nonce");
    expect(await reason(check(await key.sign(claims({ nonce: undefined }))))).toBe("id token: wrong nonce");
  });

  it("refuses a wrong issuer", async () => {
    expect(await reason(check(await key.sign(claims({ iss: "https://evil.example" }))))).toBe("id token: wrong iss");
  });

  it("accepts exp exactly at the leeway and refuses one second past it", async () => {
    await expect(check(await key.sign(claims({ exp: NOW - ID_TOKEN_LEEWAY_S })))).resolves.toMatchObject({ sub: "sub-1" });
    expect(await reason(check(await key.sign(claims({ exp: NOW - ID_TOKEN_LEEWAY_S - 1 }))))).toBe("id token: expired");
  });

  it("refuses a missing or non-numeric exp", async () => {
    expect(await reason(check(await key.sign(claims({ exp: undefined }))))).toBe("id token: expired");
    expect(await reason(check(await key.sign(claims({ exp: "9999999999" }))))).toBe("id token: expired");
  });

  it("refuses a missing or empty sub", async () => {
    expect(await reason(check(await key.sign(claims({ sub: "" }))))).toBe("id token: no sub");
    expect(await reason(check(await key.sign(claims({ sub: 12 }))))).toBe("id token: no sub");
  });

  it("refuses a token signed by a key not in the JWKS", async () => {
    expect(await reason(check(await other.sign(claims(), { kid: "k1" })))).toBe("id token: bad signature");
    expect(await reason(check(await other.sign(claims())))).toBe("id token: unknown key");
  });

  it("refuses a tampered payload", async () => {
    const [h, , s] = (await key.sign(claims())).split(".");
    const forged = base64urlEncode(new TextEncoder().encode(JSON.stringify(claims({ sub: "admin" }))));
    expect(await reason(check(`${h}.${forged}.${s}`))).toBe("id token: bad signature");
  });

  it("refuses alg none and HS256, whatever the signature", async () => {
    const body = base64urlEncode(new TextEncoder().encode(JSON.stringify(claims())));
    for (const alg of ["none", "HS256", "RS512"]) {
      const head = base64urlEncode(new TextEncoder().encode(JSON.stringify({ alg, kid: "k1" })));
      expect(await reason(check(`${head}.${body}.`)), alg).toBe("id token: unsupported alg");
    }
  });

  it("refuses malformed tokens", async () => {
    for (const t of ["", "a.b", "a.b.c.d", "!!.@@.##", `${base64urlEncode(new TextEncoder().encode("not json"))}.e30.sig`]) {
      expect(await reason(check(t)), t).toBe("id token: malformed");
    }
  });

  it("uses a key without kid when the JWKS has only one key and the token names none", async () => {
    const { kid: _kid, ...noKid } = key.jwk;
    const header = { kid: undefined };
    await expect(check(await key.sign(claims(), header), [noKid])).resolves.toMatchObject({ sub: "sub-1" });
  });
});
