// Unit tests for the live-pass runner's secret scrubbing (scripts/live-pass/lib/scrub.mjs).
// Written from the brief's rule: records hold every command's output and every API answer, with
// secrets scrubbed; emails, Cloudflare user IDs, account IDs and resource names stay readable.
import { describe, expect, it } from "vitest";
import { createScrubber, MIN_SECRET_LENGTH } from "./lib/scrub.mjs";

const TOKEN = "Zq3vN8xYk2LmP0aB7cD1eF4gH6jK9sTuVwXyZ_-a"; // 40 chars, Cloudflare token shape
const OTHER = "sEcReT-everyday-value-0123456789abcdefXYZ";
const ACCOUNT = "0123456789abcdef0123456789abcdef"; // 32 hex: an account or resource ID
const USER_ID = "7c5dae5552338874e5053f2534d2767a";

describe("known secret values", () => {
  it("replaces every occurrence of a registered value with its name", () => {
    const s = createScrubber([{ name: "LIVE_PASS_ADMIN_TOKEN", value: TOKEN }]);
    expect(s.text(`a ${TOKEN} b ${TOKEN}`)).toBe("a [REDACTED:LIVE_PASS_ADMIN_TOKEN] b [REDACTED:LIVE_PASS_ADMIN_TOKEN]");
  });

  it("replaces the URL-encoded form of a value too", () => {
    const value = "abc+def/ghi=jkl+mno/pqr";
    const s = createScrubber([{ name: "X", value }]);
    expect(s.text(`?t=${encodeURIComponent(value)}`)).not.toContain(encodeURIComponent(value));
  });

  it("takes values added later, and the longer of two overlapping values first", () => {
    const s = createScrubber();
    s.add("SHORT", "prefix-secret-1");
    s.add("LONG", "prefix-secret-1-and-more");
    expect(s.text("x prefix-secret-1-and-more y")).toBe("x [REDACTED:LONG] y");
    expect(s.text("x prefix-secret-1 y")).toBe("x [REDACTED:SHORT] y");
  });

  it(`ignores values shorter than ${String(MIN_SECRET_LENGTH)} characters, empty and undefined values`, () => {
    const s = createScrubber();
    s.add("TINY", "abc");
    s.add("EMPTY", "");
    s.add("UNSET", undefined);
    expect(s.text("abc and more")).toBe("abc and more");
    expect(s.names()).toEqual([]);
  });

  it("counts raw hits of each registered value before scrubbing (the old runbook's grep -c check)", () => {
    const s = createScrubber([{ name: "A", value: TOKEN }, { name: "B", value: OTHER }]);
    expect(s.rawHits(`${TOKEN} x ${TOKEN}`)).toEqual({ A: 2 });
    expect(s.rawHits("nothing here")).toEqual({});
  });
});

describe("patterns, for values the runner never held", () => {
  const s = createScrubber();

  it("redacts bearer credentials", () => {
    expect(s.text("Authorization: Bearer abcdefghijklmnop.qrstuv")).toBe("Authorization: Bearer [REDACTED]");
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXZhbHVl";
    expect(s.text(`id_token ${jwt} end`)).toBe("id_token [REDACTED:jwt] end");
  });

  it("redacts session cookie values but keeps the cookie name and attributes", () => {
    const out = s.text("set-cookie: __Host-session=abc.def-123; Path=/; HttpOnly; Secure");
    expect(out).toBe("set-cookie: __Host-session=[REDACTED]; Path=/; HttpOnly; Secure");
    expect(s.text("cookie: __Host-admin-grant=zzz; __Secure-x=yyy")).toBe("cookie: __Host-admin-grant=[REDACTED]; __Secure-x=[REDACTED]");
  });

  it("redacts OAuth and ticket query parameters and keeps the others", () => {
    const url = "https://prototype-auth.sub.workers.dev/callback?code=abc123&state=st4te&app=livepass-prodcheck&return=https%3A%2F%2Fx";
    expect(s.text(url)).toBe("https://prototype-auth.sub.workers.dev/callback?code=[REDACTED]&state=[REDACTED]&app=livepass-prodcheck&return=https%3A%2F%2Fx");
    expect(s.text("/files?X-Amz-Signature=deadbeef&X-Amz-Credential=AKIA%2Fx&x-id=PutObject")).toBe(
      "/files?X-Amz-Signature=[REDACTED]&X-Amz-Credential=[REDACTED]&x-id=PutObject",
    );
  });

  it("redacts secret-named JSON fields in text", () => {
    expect(s.text('{"client_id":"abc","client_secret":"s3cr3t-value"}')).toBe('{"client_id":"abc","client_secret":"[REDACTED]"}');
  });

  it("redacts a token-shaped 40-character string, but not a 40-hex git SHA", () => {
    expect(s.text(`value ${TOKEN}.`)).toBe("value [REDACTED:token-like].");
    const sha = "3395fc9a1b2c3d4e5f60718293a4b5c6d7e8f901";
    expect(s.text(`commit ${sha}`)).toBe(`commit ${sha}`);
  });

  it("redacts a 64-hex string (the R2 secret access key's shape)", () => {
    const hex = "a".repeat(32) + "b".repeat(32);
    expect(s.text(`key ${hex}`)).toBe("key [REDACTED:hex64]");
  });

  it("keeps what the records may hold: emails, user and account IDs, names and plain URLs", () => {
    const text = `owner@example.com ${USER_ID} ${ACCOUNT} prototype-admin https://prototype-admin.sub.workers.dev/setup Super Administrator - All Privileges`;
    expect(s.text(text)).toBe(text);
  });
});

describe("structured values", () => {
  it("redacts secret-named fields at any depth and keeps the rest", () => {
    const s = createScrubber();
    const out = s.value({ result: { id: "tok1", name: "prototype-framework", value: TOKEN, nested: [{ client_secret: "x-secret-y", client_id: "cid" }] } });
    expect(out).toEqual({ result: { id: "tok1", name: "prototype-framework", value: "[REDACTED:value]", nested: [{ client_secret: "[REDACTED:client_secret]", client_id: "cid" }] } });
  });

  it("keeps a short or spaced `value` field (filters, settings), and scrubs known values inside any string", () => {
    const s = createScrubber([{ name: "T", value: OTHER }]);
    expect(s.value({ value: "prototype-auth", other: `has ${OTHER}` })).toEqual({ value: "prototype-auth", other: "has [REDACTED:T]" });
    expect(s.value({ value: "a phrase with spaces that is long enough" })).toEqual({ value: "a phrase with spaces that is long enough" });
  });

  it("scrubs object keys too, and passes numbers, booleans and null through", () => {
    const s = createScrubber([{ name: "T", value: TOKEN }]);
    expect(s.value({ [TOKEN]: 1, n: 2, b: true, z: null })).toEqual({ "[REDACTED:T]": 1, n: 2, b: true, z: null });
  });

  it("does not modify its input", () => {
    const s = createScrubber();
    const input = { value: TOKEN };
    s.value(input);
    expect(input.value).toBe(TOKEN);
  });
});
