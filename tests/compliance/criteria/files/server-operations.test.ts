/**
 * FILES-AC-001 and FILES-AC-002 against the reference app on the run's target
 * (docs/components/files.md FILES-REQ-001, FILES-REQ-002; ROUTES.md "Files").
 */
import { afterAll, describe, expect, it } from "vitest";
import { client, tag, type ComplianceClient } from "../../harness/index.js";
import { getFile, head, listAll, listPage, put, remove, removeAll, uniquePrefix } from "./support.js";

const prefixes: string[] = [];
let userClient: ComplianceClient | undefined;

async function user(): Promise<ComplianceClient> {
  userClient ??= await client().as("user", { id: "c-t3-files-user" });
  return userClient;
}

function prefix(label: string): string {
  const p = uniquePrefix(label);
  prefixes.push(p);
  return p;
}

afterAll(async () => {
  if (userClient === undefined) return;
  for (const p of prefixes) await removeAll(userClient, p);
});

/** Every byte value, then a few more, so no byte is altered by a text encoding on the way. */
function allBytes(): Uint8Array {
  const out = new Uint8Array(300);
  for (let i = 0; i < out.length; i += 1) out[i] = i % 256;
  return out;
}

describe("FILES-AC-001 server operations", () => {
  it(tag("FILES-AC-001", "binary round trip is byte-exact with metadata; default content type is application/octet-stream"), async () => {
    const u = await user();
    const p = prefix("ac001-roundtrip");
    const bytes = allBytes();
    await put(u, `${p}typed.bin`, bytes, "image/png");
    expect(await head(u, `${p}typed.bin`)).toStrictEqual({ name: `${p}typed.bin`, size: bytes.byteLength, contentType: "image/png" });
    const got = await getFile(u, `${p}typed.bin`);
    expect(got).not.toBeNull();
    expect(got?.name).toBe(`${p}typed.bin`);
    expect(got?.size).toBe(bytes.byteLength);
    expect(got?.contentType).toBe("image/png");
    expect(Array.from(got?.bytes ?? [])).toStrictEqual(Array.from(bytes));

    await put(u, `${p}untyped.bin`, new Uint8Array([0, 255, 1]));
    expect(await head(u, `${p}untyped.bin`)).toStrictEqual({ name: `${p}untyped.bin`, size: 3, contentType: "application/octet-stream" });
  });

  it(tag("FILES-AC-001", "put replaces the whole file, content and metadata"), async () => {
    const u = await user();
    const p = prefix("ac001-overwrite");
    await put(u, `${p}f`, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "text/plain");
    await put(u, `${p}f`, new Uint8Array([9, 9]), "application/json");
    expect(await head(u, `${p}f`)).toStrictEqual({ name: `${p}f`, size: 2, contentType: "application/json" });
    expect(Array.from((await getFile(u, `${p}f`))?.bytes ?? [])).toStrictEqual([9, 9]);
    expect(await listAll(u, p)).toStrictEqual([{ name: `${p}f`, size: 2, contentType: "application/json" }]);
  });

  it(tag("FILES-AC-001", "get and head of a missing file return null; deleting it, and deleting it again, succeeds"), async () => {
    const u = await user();
    const p = prefix("ac001-missing");
    expect(await head(u, `${p}never`)).toBeNull();
    expect(await getFile(u, `${p}never`)).toBeNull();
    await remove(u, `${p}never`);
    await put(u, `${p}once`, new Uint8Array([7]));
    await remove(u, `${p}once`);
    expect(await head(u, `${p}once`)).toBeNull();
    expect(await getFile(u, `${p}once`)).toBeNull();
    await remove(u, `${p}once`);
    await remove(u, `${p}once`);
  });

  it(tag("FILES-AC-001", "list returns exactly the prefix's names in code point order across several pages"), async () => {
    const u = await user();
    const p = prefix("ac001-list");
    // Seven files (code point order differs from insertion order and from locale order), plus
    // two outside the prefix that must not appear: a sibling and a name that only shares a prefix
    // up to the last character.
    const names = ["b", "a", "B", "a/b", "é", "a b", "Z"].map((n) => `${p}${n}`);
    for (const n of names) await put(u, n, new Uint8Array([1]));
    const outsider = `${p.slice(0, -1)}-outside/x`;
    prefixes.push(`${p.slice(0, -1)}-outside/`);
    await put(u, outsider, new Uint8Array([1]));

    const expected = [...names].sort((x, y) => {
      const a = Array.from(x, (ch) => ch.codePointAt(0) ?? 0);
      const b = Array.from(y, (ch) => ch.codePointAt(0) ?? 0);
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
      return a.length - b.length;
    });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await listPage(u, p, 3, cursor);
      pages += 1;
      expect(page.items.length).toBeLessThanOrEqual(3);
      for (const item of page.items) expect(item).toStrictEqual({ name: item.name, size: 1, contentType: "application/octet-stream" });
      seen.push(...page.items.map((i) => i.name));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
      expect(pages).toBeLessThan(10);
    }
    expect(seen).toStrictEqual(expected);
    expect(pages).toBeGreaterThanOrEqual(3);
  });
});

describe("FILES-AC-002 names", () => {
  it(tag("FILES-AC-002", "names with spaces, %, /, .. and non-ASCII characters round-trip unchanged"), async () => {
    const u = await user();
    const p = prefix("ac002-names");
    const names = ["with space.txt", "100%.txt", "%2F%41", "a/b/c.txt", "../up.txt", "x/../y", "./dot", "a//b", "ünïcødé-日本語-😀.txt"].map((n) => `${p}${n}`);
    for (const [i, n] of names.entries()) await put(u, n, new Uint8Array([i]), "text/plain");
    for (const [i, n] of names.entries()) {
      expect(await head(u, n)).toStrictEqual({ name: n, size: 1, contentType: "text/plain" });
      const got = await getFile(u, n);
      expect(got?.name).toBe(n);
      expect(Array.from(got?.bytes ?? [])).toStrictEqual([i]);
    }
    const listed = (await listAll(u, p)).map((f) => f.name);
    expect([...listed].sort()).toStrictEqual([...names].sort());
    // Not interpreted as paths: "x/../y" did not become "y", and "../up.txt" stayed under the prefix.
    expect(await head(u, `${p}y`)).toBeNull();
    for (const n of names) await remove(u, n);
    expect(await listAll(u, p)).toStrictEqual([]);
  });

  it(tag("FILES-AC-002", "empty and oversized names, the names . and .., and names containing CR, LF or NUL, are rejected with FILES.INVALID_NAME"), async () => {
    const u = await user();
    const p = prefix("ac002-invalid");
    // PAR-230: at most 1,024 UTF-8 bytes. One name one byte over (multi-byte characters, so a
    // character count would not catch it).
    const oversized = `${p}${"é".repeat(Math.ceil((1025 - Buffer.byteLength(p)) / 2))}`;
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(1024);
    const invalid = ["", ".", "..", oversized, `${p}cr\rx`, `${p}lf\nx`, `${p}nul\u0000x`];
    for (const name of invalid) {
      const q = encodeURIComponent(name);
      u.expectError(await u.request("PUT", "/api/files/content", { json: { name, base64: "AQ==" } }), 400, "FILES.INVALID_NAME");
      u.expectError(await u.get(`/api/files/head?name=${q}`), 400, "FILES.INVALID_NAME");
      u.expectError(await u.get(`/api/files/content?name=${q}`), 400, "FILES.INVALID_NAME");
      u.expectError(await u.request("DELETE", `/api/files/content?name=${q}`), 400, "FILES.INVALID_NAME");
      u.expectError(await u.post("/api/files/upload-ticket", { name }), 400, "FILES.INVALID_NAME");
      u.expectError(await u.post("/api/files/download-ticket", { name }), 400, "FILES.INVALID_NAME");
    }
    expect(await listAll(u, p)).toStrictEqual([]);
  });
});
