# Example: declaring and reading a secret, and signing with HMAC

Every file below is copied unchanged from the framework's app template (`apps/template`) or its compliance reference app (`apps/reference`). The framework's CI type-checks and tests those apps (`npm run verify` runs each app's `verify`), so this code compiles and passes as shown. Do not copy code from any other app.

What it shows:

- `env.ts`: the secret name `apiKey` is declared in `secrets`.
- `routes/admin.ts`: `await c.var.secrets.get("apiKey")`; the route reports only whether it is set, never the value.
- `signing.ts`: signed tokens (for example share links) as `<subject>.<expiresAt>.<signature>`: HMAC-SHA-256 with `crypto.subtle.sign` and `crypto.subtle.verify` (constant-time), base64url encoding with `btoa`/`atob` and no `Buffer`, malformed input treated as invalid, and expiry checked with `now()`. The key comes from a declared secret.
- `signing.test.ts`: a valid, a tampered, a wrongly keyed, a malformed and an expired token; expiry uses the test runner's fake timers.
- From the reference app, `encoding.ts`: Web-API-only byte helpers (`crypto.subtle.digest`, `btoa`/`atob`, `TextEncoder`), with no `Buffer`.

## `apps/template/src/server/env.ts`

<!-- example-source: apps/template/src/server/env.ts -->
```ts
import { configString, type AppEnv } from "@lago-morph/prototype-framework";

/** Non-secret configuration keys; values per stage are in `config/`. */
export const config = {
  greeting: configString({ default: "Hello" }),
};

/** Secret names; values are set with `secrets set <name>`, never committed. */
export const secrets = ["apiKey"] as const;

/** The Hono environment every route module takes: `Hono<Env>`. */
export type Env = AppEnv<typeof config, (typeof secrets)[number]>;
```

## `apps/template/src/server/routes/admin.ts`

<!-- example-source: apps/template/src/server/routes/admin.ts -->
```ts
import { requireAdmin } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { SecretCheck } from "../../shared/types";
import type { Env } from "../env";

/** Secrets and access levels: only an admin may check that the secret is set. Never return its value. */
export function adminRoutes(api: Hono<Env>): void {
  api.get("/admin/secret", requireAdmin(), async (c) => {
    const apiKey = await c.var.secrets.get("apiKey");
    const body: SecretCheck = { configured: apiKey.length > 0 };
    return c.json(body);
  });
}
```

## `apps/reference/src/server/encoding.ts`

<!-- example-source: apps/reference/src/server/encoding.ts -->
```ts
/** Byte helpers shared by the routes (Web APIs only). */

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** Lowercase hex SHA-256 of bytes or of a string's UTF-8 encoding. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads a stream to its end. */
export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
```

## `apps/template/src/server/signing.ts`

<!-- example-source: apps/template/src/server/signing.ts -->
```ts
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
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
  // atob ignores the unused low bits of the last character, so accept only the canonical spelling.
  return toBase64url(bytes) === text ? bytes : null;
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
```

## `apps/template/tests/signing.test.ts`

<!-- example-source: apps/template/tests/signing.test.ts -->
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { signToken, verifyToken } from "../src/server/signing";

const key = "test-signing-key-at-least-32-bytes-long";

afterEach(() => {
  vi.useRealTimers();
});

describe("signed tokens (HMAC, base64url)", () => {
  it("returns the subject of a valid token", async () => {
    const token = await signToken(key, "note-1", Date.now() + 60_000);
    expect(token).toMatch(/^note-1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(await verifyToken(key, token)).toBe("note-1");
  });

  it("refuses a tampered token, another key, and malformed input", async () => {
    const token = await signToken(key, "note-1", Date.now() + 60_000);
    const [, expiresAt = "", signature = ""] = token.split(".");
    const flipped = (signature.startsWith("A") ? "B" : "A") + signature.slice(1);
    expect(await verifyToken(key, `note-2.${expiresAt}.${signature}`)).toBeNull();
    expect(await verifyToken(key, `note-1.${String(Number(expiresAt) + 1)}.${signature}`)).toBeNull();
    expect(await verifyToken(key, `note-1.${expiresAt}.${flipped}`)).toBeNull();
    expect(await verifyToken("another-key", token)).toBeNull();
    for (const bad of ["", "note-1", "note-1.x.y", `note-1.${expiresAt}.not base64!`, `${token}.extra`]) {
      expect(await verifyToken(key, bad)).toBeNull();
    }
  });

  // root cause 2026-10-31-G-template-signing-noncanonical: a 32-byte signature is 43 base64url
  // characters, so its last character carries 2 unused bits; only the issued spelling may verify.
  it("accepts only the issued spelling of a signature, not one re-spelled in its last character", async () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const token = await signToken(key, "note-1", Date.now() + 60_000);
    const [subject = "", expiresAt = "", signature = ""] = token.split(".");
    expect(signature).toHaveLength(43);
    const last = alphabet.indexOf(signature.slice(-1));
    expect(last % 4, "the issued spelling leaves the unused low bits at zero").toBe(0);
    for (const flip of [1, 2, 3]) {
      const respelled = signature.slice(0, -1) + (alphabet[last ^ flip] ?? "");
      expect(await verifyToken(key, `${subject}.${expiresAt}.${respelled}`), respelled.slice(-3)).toBeNull();
    }
    expect(await verifyToken(key, token)).toBe("note-1");
  });

  it("refuses a token once it has expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await signToken(key, "note-1", Date.now() + 60_000);
    vi.advanceTimersByTime(59_999);
    expect(await verifyToken(key, token)).toBe("note-1");
    vi.advanceTimersByTime(1);
    expect(await verifyToken(key, token)).toBeNull();
  });
});
```
