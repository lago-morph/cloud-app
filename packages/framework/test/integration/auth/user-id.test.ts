/**
 * AUTH-AC-002: stable opaque user ID, derived as auth.md §2 "User ID" specifies (DEC-0067),
 * through the stub login provider (`createTestApp` with `stubLoginProvider`).
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { deriveUserId, disposeAll, me, newApp } from "./support.js";

afterEach(disposeAll);

/** B-T3 decision 2: the stub login provider's `id` is "stub". */
const STUB_PROVIDER_ID = "stub";

async function idOf(subject: string): Promise<string> {
  const app = await newApp({ stubLoginProvider: true });
  await app.loginWithStub(subject);
  const body = await me(app);
  expect(body["level"]).toBe("user");
  expect(typeof body["id"]).toBe("string");
  return body["id"] as string;
}

describe("AUTH user ID derivation", () => {
  it(tag("AUTH-AC-002", "same provider and subject always yield the same ID, equal to u_ + base32(SHA-256(provider:subject))[0..26]"), async () => {
    const first = await idOf("subject-alice");
    const second = await idOf("subject-alice");
    expect(second).toBe(first);
    // Base32 letter case is not specified (B-T3 decision 2): compare the encoded part case-insensitively.
    expect(first).toMatch(/^u_[A-Za-z2-7]{26}$/);
    expect(first.toUpperCase()).toBe(deriveUserId(STUB_PROVIDER_ID, "subject-alice").toUpperCase());
    // Opaque: the subject does not appear in the ID.
    expect(first.toLowerCase()).not.toContain("alice");
  });

  it(tag("AUTH-AC-002", "two subjects yield different IDs"), async () => {
    const alice = await idOf("subject-alice");
    const bob = await idOf("subject-bob");
    expect(alice).not.toBe(bob);
    expect(bob.toUpperCase()).toBe(deriveUserId(STUB_PROVIDER_ID, "subject-bob").toUpperCase());
  });

  it(tag("AUTH-AC-002", "two providers yield different IDs (provider name is part of the derivation)"), async () => {
    // Only one non-mock provider exists locally (the Google provider cannot complete a login
    // offline through createTestApp), so this checks that the stub's ID is the derivation for
    // its own provider name and differs from the same subject's ID under another provider name.
    const viaStub = await idOf("subject-carol");
    expect(viaStub.toUpperCase()).toBe(deriveUserId(STUB_PROVIDER_ID, "subject-carol").toUpperCase());
    expect(viaStub.toUpperCase()).not.toBe(deriveUserId("google", "subject-carol").toUpperCase());
  });
});
