import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { deriveUserId } from "./user-id.js";

/** Independent reference: u_ + first 26 chars of RFC 4648 base32 of SHA-256(provider:subject). */
function reference(provider: string, subject: string): string {
  const digest = createHash("sha256").update(`${provider}:${subject}`, "utf8").digest();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of digest) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `u_${out.slice(0, 26)}`;
}

describe("user ID derivation (DEC-0067)", () => {
  it(tag("AUTH-AC-002", "matches u_ + base32(SHA-256(provider:subject))[0..26], upper case"), async () => {
    expect(await deriveUserId("stub", "alice")).toBe(reference("stub", "alice"));
    expect(await deriveUserId("google", "1234567890")).toBe(reference("google", "1234567890"));
    expect(await deriveUserId("stub", "älice")).toBe(reference("stub", "älice"));
  });

  it(tag("AUTH-AC-002", "is stable, and differs per subject and per provider"), async () => {
    expect(await deriveUserId("stub", "a")).toBe(await deriveUserId("stub", "a"));
    expect(await deriveUserId("stub", "a")).not.toBe(await deriveUserId("stub", "b"));
    expect(await deriveUserId("stub", "a")).not.toBe(await deriveUserId("google", "a"));
    expect(await deriveUserId("stub", "a")).toMatch(/^u_[A-Z2-7]{26}$/);
  });
});
