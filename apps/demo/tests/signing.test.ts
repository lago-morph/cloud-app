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
