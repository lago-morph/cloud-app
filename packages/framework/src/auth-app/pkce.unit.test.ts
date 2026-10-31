/** PKCE S256, state and nonce for the auth app's Cloudflare sign-in (plan §4.1 step 2, §7 "state and PKCE"). */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPkce, randomToken, s256Challenge } from "./pkce.js";

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B example", async () => {
    await expect(s256Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes a 43-character base64url verifier whose challenge is its SHA-256", async () => {
    const { verifier, challenge, method } = await createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(method).toBe("S256");
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("never repeats a verifier", async () => {
    const a = await createPkce();
    const b = await createPkce();
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe("randomToken", () => {
  it("is base64url of the requested number of random bytes", () => {
    expect(randomToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(32)).not.toBe(randomToken(32));
  });
});
