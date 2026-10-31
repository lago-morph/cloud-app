# Root cause (stub, evidence only): the app template's share-link signatures accept 4 spellings of each signature

Author: item T4, 2026-10-31. Found by the similar-case search (plan §7a.1.8 step 4) of `2026-10-31-T4-files-base64url-noncanonical.md`. It is outside T4's owned paths (plan §1 ownership). The orchestrator schedules the diagnosis, review and fix with item G (the template owner). This stub gives the evidence only. It has no causal chain, no proposed fix and no review.

## Where
- `apps/template/src/server/signing.ts`: `fromBase64url` (lines 20–28), used by `verifyToken` (lines 38–45).
- `apps/demo/src/server/signing.ts`: identical (`diff` of the two files is empty).

## Evidence
- **The decoder.** `fromBase64url` checks the alphabet, pads with `=` and returns `atob(...)`'s bytes. It does not re-encode them and compare. `atob` ignores the unused low bits of the last character, so for a 32-byte HMAC-SHA-256 signature (43 characters, 2 unused bits) four spellings decode to the same bytes. This is the same mechanism as the framework's `files/base64url.ts` before its fix.
- **Reproduction** (Node v22.23.4, `node --experimental-strip-types repro.mts`). The template's `toBase64url`, `fromBase64url` and `verifyToken`'s HMAC check are copied verbatim; only the framework's `now` is left out. The script signs `note-1.<expiry>` with a generated dummy key, then checks the signature and its 3 re-spellings of the last character:

  ```
  template share-link signature spelling Iak verifies: true
  template share-link signature spelling Ial verifies: true
  template share-link signature spelling Iam verifies: true
  template share-link signature spelling Ian verifies: true
  ```
- **No forgery.** Every accepted spelling carries the same signature bytes, which `crypto.subtle.verify` checks against the real key. What is wrong is that a token is malleable: a link has 4 accepted forms. The framework's own copies (`auth/signing.ts`, `kv/cursor.ts`, and `files/base64url.ts` after PR 89) accept one.

## Script

```ts
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
  try {
    return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}
const secret = `evidence-key-${"k".repeat(32)}`; // a dummy key, not a credential
const payload = `note-1.${String(Date.now() + 60_000)}`;
const sig = toBase64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload))));
const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
for (const f of [0, 1, 2, 3]) {
  const s = sig.slice(0, -1) + B[B.indexOf(sig.slice(-1)) ^ f];
  const bytes = fromBase64url(s);
  const ok = bytes !== null && (await crypto.subtle.verify("HMAC", await hmacKey(secret), bytes, encoder.encode(payload)));
  console.log("template share-link signature spelling", s.slice(-3), "verifies:", ok);
}
```
