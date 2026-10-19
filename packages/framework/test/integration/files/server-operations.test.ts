/**
 * FILES server operations against local R2 (createTestApp, DEC-0105).
 * FILES-AC-001 (FILES-REQ-001), FILES-AC-002 (FILES-REQ-002), FILES-AC-006 server part
 * (FILES-REQ-006: unreachable storage → FILES.UNAVAILABLE). docs/components/files.md;
 * PAR-230 (1,024 UTF-8 bytes), PAR-231 (default page 100), PAR-232 (max page 1,000).
 */
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CATALOGUE, FrameworkError, type FileInfo, type FilesService } from "../../../src/index.js";
import { tag } from "../../../../../tests/support/tags.js";
import { codePointSort, disposeAll, errorOf, newFilesApp, readAll, sampleBytes, withFiles } from "./support.js";

afterEach(disposeAll);

function expectFrameworkError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(FrameworkError);
  expect((error as FrameworkError).code).toBe(code);
}

async function listAll(files: FilesService, prefix: string, limit: number): Promise<{ pages: FileInfo[][]; cursors: (string | null)[] }> {
  const pages: FileInfo[][] = [];
  const cursors: (string | null)[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const page = await files.list(prefix, cursor === undefined ? { limit } : { limit, cursor });
    pages.push([...page.items]);
    cursors.push(page.nextCursor);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return { pages, cursors };
}

describe("FILES server operations", () => {
  it(tag("FILES-AC-001", "binary round trip with byte-exact content and metadata; default content type"), async () => {
    const app = await newFilesApp();
    const bytes = sampleBytes(300_000, 7);
    const result = await withFiles(app, async (files) => {
      await files.put("photos/a.png", bytes, { contentType: "image/png" });
      await files.put("raw.bin", new Uint8Array([0, 255, 0, 1]));
      const got = await files.get("photos/a.png");
      const head = await files.head("photos/a.png");
      const raw = await files.head("raw.bin");
      return {
        got: got === null ? null : { name: got.name, size: got.size, contentType: got.contentType, body: await readAll(got.body) },
        head,
        raw,
      };
    });
    expect(result.got).not.toBeNull();
    expect(result.got?.name).toBe("photos/a.png");
    expect(result.got?.size).toBe(bytes.byteLength);
    expect(result.got?.contentType).toBe("image/png");
    expect(Buffer.from(result.got?.body ?? new Uint8Array()).equals(Buffer.from(bytes))).toBe(true);
    expect(result.head).toStrictEqual({ name: "photos/a.png", size: bytes.byteLength, contentType: "image/png" });
    expect(result.raw).toStrictEqual({ name: "raw.bin", size: 4, contentType: "application/octet-stream" });
  });

  it(tag("FILES-AC-001", "overwrite replaces the whole file and its metadata"), async () => {
    const app = await newFilesApp();
    const first = sampleBytes(5000, 3);
    const second = sampleBytes(1234, 9);
    const result = await withFiles(app, async (files) => {
      await files.put("doc", first, { contentType: "text/plain" });
      await files.put("doc", second, { contentType: "application/pdf" });
      const got = await files.get("doc");
      return { head: await files.head("doc"), body: got === null ? null : await readAll(got.body) };
    });
    expect(result.head).toStrictEqual({ name: "doc", size: 1234, contentType: "application/pdf" });
    expect(Buffer.from(result.body ?? new Uint8Array()).equals(Buffer.from(second))).toBe(true);
  });

  it(tag("FILES-AC-001", "missing get and head return null; delete of an absent file and repeated delete succeed"), async () => {
    const app = await newFilesApp();
    const result = await withFiles(app, async (files) => {
      const missingGet = await files.get("nope");
      const missingHead = await files.head("nope");
      await files.delete("nope");
      await files.put("gone", new Uint8Array([1, 2, 3]));
      const present = await files.head("gone");
      await files.delete("gone");
      await files.delete("gone");
      return { missingGet, missingHead, present, afterGet: await files.get("gone"), afterHead: await files.head("gone") };
    });
    expect(result.missingGet).toBeNull();
    expect(result.missingHead).toBeNull();
    expect(result.present).toStrictEqual({ name: "gone", size: 3, contentType: "application/octet-stream" });
    expect(result.afterGet).toBeNull();
    expect(result.afterHead).toBeNull();
  });

  it(tag("FILES-AC-001", "list across several pages returns exact names, literal prefix, code point order, each once"), async () => {
    const app = await newFilesApp();
    const inside = ["p/b", "p/a", "p/Z", "p/10", "p/9", "p/_x", "p/ä", "p/€", "p/😀", "p/z.txt", "p/a/b"];
    const outside = ["q/a", "P/a", "p", "pa", "o/p/x"];
    const result = await withFiles(app, async (files) => {
      for (const name of [...inside, ...outside]) await files.put(name, new TextEncoder().encode(name), { contentType: "text/plain" });
      return listAll(files, "p/", 3);
    });
    const names = result.pages.flat().map((i) => i.name);
    expect(names).toStrictEqual(codePointSort(inside));
    expect(result.pages.length).toBe(Math.ceil(inside.length / 3));
    for (const page of result.pages.slice(0, -1)) expect(page).toHaveLength(3);
    expect(result.cursors.at(-1)).toBeNull();
    for (const item of result.pages.flat()) {
      expect(item).toStrictEqual({ name: item.name, size: new TextEncoder().encode(item.name).byteLength, contentType: "text/plain" });
    }
  });

  it(tag("FILES-AC-001", "list pages hold PAR-231 items by default; an empty prefix lists everything"), async () => {
    const app = await newFilesApp();
    const names = Array.from({ length: 101 }, (_, i) => `many/${String(i).padStart(3, "0")}`);
    const result = await withFiles(app, async (files) => {
      for (const name of names) await files.put(name, new Uint8Array([1]));
      const first = await files.list("many/");
      const second = first.nextCursor === null ? null : await files.list("many/", { cursor: first.nextCursor });
      const all = await files.list("", { limit: 1000 });
      return { first, second, all };
    });
    expect(result.first.items).toHaveLength(100);
    expect(result.first.nextCursor).not.toBeNull();
    expect(result.second?.items.map((i) => i.name)).toStrictEqual(["many/100"]);
    expect(result.second?.nextCursor).toBeNull();
    expect(result.all.items.map((i) => i.name)).toStrictEqual(names);
  });

  it(tag("FILES-AC-001", "a malformed cursor, or one issued for another prefix, is rejected with FILES.INVALID_CURSOR"), async () => {
    const app = await newFilesApp();
    const cursor = await withFiles(app, async (files) => {
      for (const n of ["c/1", "c/2", "c/3", "d/1", "d/2", "d/3"]) await files.put(n, new Uint8Array([0]));
      const page = await files.list("c/", { limit: 1 });
      return page.nextCursor;
    });
    expect(cursor).not.toBeNull();
    expectFrameworkError(await errorOf(app, (files) => files.list("c/", { cursor: "%%%not-a-cursor%%%" })), "FILES.INVALID_CURSOR");
    expectFrameworkError(await errorOf(app, (files) => files.list("d/", { cursor: cursor ?? "" })), "FILES.INVALID_CURSOR");
  });
});

describe("FILES names", () => {
  const roundTripNames = [
    "with space.txt",
    " leading and trailing ",
    "100%.bin",
    "%2F%00%",
    "a/b/c.txt",
    "/leading-slash",
    "trailing/",
    "..",
    "../../etc/passwd",
    "a/../b",
    "./x",
    "naïve résumé.pdf",
    "文件/照片.jpg",
    "emoji-😀🎉",
    "é".repeat(512), // exactly PAR-230 bytes
  ];

  it(tag("FILES-AC-002", "names with spaces, %, /, .. and non-ASCII characters round-trip unchanged through put/get/head/list"), async () => {
    const app = await newFilesApp();
    const result = await withFiles(app, async (files) => {
      const out: { name: string; got: string | null; head: string | null; body: string | null }[] = [];
      for (const [i, name] of roundTripNames.entries()) {
        await files.put(name, new TextEncoder().encode(`content-${i}`));
      }
      for (const name of roundTripNames) {
        const got = await files.get(name);
        const head = await files.head(name);
        out.push({
          name,
          got: got?.name ?? null,
          head: head?.name ?? null,
          body: got === null ? null : new TextDecoder().decode(await readAll(got.body)),
        });
      }
      const listed = await files.list("", { limit: 1000 });
      // Not interpreted as paths: "a/../b" and "b" are different files.
      const plainB = await files.head("b");
      return { out, listed: listed.items.map((i) => i.name), plainB };
    });
    for (const [i, row] of result.out.entries()) {
      expect(row.got).toBe(row.name);
      expect(row.head).toBe(row.name);
      expect(row.body).toBe(`content-${i}`);
    }
    expect(result.listed).toStrictEqual(codePointSort(roundTripNames));
    expect(result.plainB).toBeNull();
  });

  const rejected: [string, string][] = [
    ["empty", ""],
    ["oversized ASCII (1,025 bytes)", "a".repeat(1025)],
    ["oversized UTF-8 (1,026 bytes)", "é".repeat(513)],
    ["CR", "bad\rname"],
    ["LF", "bad\nname"],
    ["NUL", "bad\u0000name"],
  ];
  for (const [label, name] of rejected) {
    it(tag("FILES-AC-002", `${label} name is rejected with FILES.INVALID_NAME by every operation that takes a name`), async () => {
      const app = await newFilesApp();
      const ops: ((files: FilesService) => Promise<unknown>)[] = [
        (f) => f.put(name, new Uint8Array([1])),
        (f) => f.get(name),
        (f) => f.head(name),
        (f) => f.delete(name),
        (f) => f.createUploadTicket(name),
        (f) => f.createDownloadTicket(name),
      ];
      for (const op of ops) expectFrameworkError(await errorOf(app, op), "FILES.INVALID_NAME");
      // Nothing was stored.
      const listed = await withFiles(app, (f) => f.list("", { limit: 1000 }));
      expect(listed.items).toStrictEqual([]);
    });
  }
});

describe("FILES unavailable", () => {
  it(tag("FILES-AC-006", "server part: with storage unreachable, every server operation fails with FILES.UNAVAILABLE"), async () => {
    const app = await newFilesApp({ unavailable: ["files"] });
    const ops: ((files: FilesService) => Promise<unknown>)[] = [
      (f) => f.put("x", new Uint8Array([1])),
      (f) => f.get("x"),
      (f) => f.head("x"),
      (f) => f.delete("x"),
      (f) => f.list(""),
      (f) => f.createUploadTicket("x"),
      (f) => f.createDownloadTicket("x"),
    ];
    for (const op of ops) expectFrameworkError(await errorOf(app, op), "FILES.UNAVAILABLE");
  });

  it(tag("FILES-AC-006", "server part: uncaught in a route, FILES.UNAVAILABLE becomes a 503 ErrorResponse"), async () => {
    const app = await newFilesApp({ unavailable: ["files"] });
    const res = await app.request("/api/head-uncaught?name=x");
    expect(res.status).toBe(ERROR_CATALOGUE["FILES.UNAVAILABLE"].status);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("FILES.UNAVAILABLE");
    expect(typeof body.error.requestId).toBe("string");
  });
});
