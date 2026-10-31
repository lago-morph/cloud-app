/** Signed cookie values of the admin app (DEC-0710): tamper-proof, purpose-bound, expiring. */
import { describe, expect, it } from "vitest";
import { open, seal } from "./seal.js";

const KEY = "admin-client-secret-0123456789abcdef";
const NOW = 1_800_000_000_000;

describe("seal / open", () => {
  it("round-trips a payload for its purpose until it expires", async () => {
    const v = await seal(KEY, "session", { sub: "s1" }, NOW + 1000);
    expect(await open(KEY, "session", v, NOW)).toEqual({ sub: "s1" });
    expect(await open(KEY, "session", v, NOW + 999)).toEqual({ sub: "s1" });
  });

  it("refuses at and after expiry", async () => {
    const v = await seal(KEY, "session", { sub: "s1" }, NOW + 1000);
    expect(await open(KEY, "session", v, NOW + 1000)).toBeNull();
    expect(await open(KEY, "session", v, NOW + 5000)).toBeNull();
  });

  it("refuses a value sealed for another purpose", async () => {
    const v = await seal(KEY, "grant", { sub: "s1" }, NOW + 1000);
    expect(await open(KEY, "session", v, NOW)).toBeNull();
  });

  it("refuses another key, a changed payload or MAC, and malformed values", async () => {
    const v = await seal(KEY, "session", { sub: "s1" }, NOW + 1000);
    expect(await open(`${KEY}x`, "session", v, NOW)).toBeNull();
    const [body, mac] = v.split(".") as [string, string];
    const other = await seal(KEY, "session", { sub: "admin" }, NOW + 1000);
    expect(await open(KEY, "session", `${other.split(".")[0]!}.${mac}`, NOW)).toBeNull();
    expect(await open(KEY, "session", `${body}.${mac.slice(0, -2)}AA`, NOW)).toBeNull();
    for (const bad of ["", ".", "a.b.c", "!!!.???", body, `${body}.`]) expect(await open(KEY, "session", bad, NOW)).toBeNull();
  });

  it("an empty key is refused at seal and open", async () => {
    await expect(seal("", "session", {}, NOW + 1)).rejects.toThrow("admin app misconfigured");
    await expect(open("", "session", "a.b", NOW)).rejects.toThrow("admin app misconfigured");
  });
});
