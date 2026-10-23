import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { FrameworkError } from "../core/errors.js";
import { signToken, verifyToken } from "./signing.js";

// Generated dummy key for tests only (32+ bytes).
const KEY = "unit-test-key-0123456789abcdefghijklmnop";

function flip(value: string, at: number): string {
  const i = ((at % value.length) + value.length) % value.length;
  return value.slice(0, i) + (value[i] === "A" ? "B" : "A") + value.slice(i + 1);
}

describe("signed tokens", () => {
  it("round-trips a JSON payload for the same purpose and key", async () => {
    const token = await signToken(KEY, "session", { a: 1, b: "x" });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifyToken(KEY, "session", token)).toStrictEqual({ a: 1, b: "x" });
  });

  it(tag("AUTH-AC-006", "any changed character, another purpose, another key, or garbage is rejected"), async () => {
    const token = await signToken(KEY, "session", { id: "u_X", exp: 1 });
    for (const at of [0, 3, Math.floor(token.length / 2), -2, -5]) {
      expect(await verifyToken(KEY, "session", flip(token, at))).toBeUndefined();
    }
    expect(await verifyToken(KEY, "login", token)).toBeUndefined();
    expect(await verifyToken(`${KEY}-other`, "session", token)).toBeUndefined();
    for (const garbage of ["", "abc", "a.b.c", "not-a-session", ".", `${token}.x`, `${token}=`]) {
      expect(await verifyToken(KEY, "session", garbage)).toBeUndefined();
    }
  });

  it("refuses a key shorter than PAR-253 (32 bytes) with CORE.MISCONFIGURED", async () => {
    const error = await signToken("Qz7x", "session", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FrameworkError);
    expect((error as FrameworkError).code).toBe("CORE.MISCONFIGURED");
    expect((error as FrameworkError).message).not.toContain("Qz7x");
  });
});
