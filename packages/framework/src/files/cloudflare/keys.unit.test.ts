import { describe, expect, it } from "vitest";
import { fakeStore } from "../fake-store.test-support.js";
import { createFilesService, type FilesStore, type TicketIssuer } from "../service.js";
import { cloudflareFilesStore, nameOfKey, storedKey } from "./keys.js";

const noTickets: TicketIssuer = {
  upload: async () => ({}),
  download: async () => ({}),
};

function codePointSort(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
    const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
    return x.length - y.length;
  });
}

async function listAll(store: FilesStore, prefix: string, limit: number): Promise<string[][]> {
  const files = createFilesService({ store, tickets: noTickets });
  const pages: string[][] = [];
  let cursor: string | undefined;
  do {
    const page = await files.list(prefix, { limit, ...(cursor === undefined ? {} : { cursor }) });
    pages.push(page.items.map((i) => i.name));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined && pages.length < 50);
  return pages;
}

const keysOf = async (store: FilesStore, options: Parameters<FilesStore["list"]>[0]): Promise<string[]> => (await store.list(options)).objects.map((o) => o.key);

describe("the fake's r2 order reproduces the live probe (2026-10-24)", () => {
  async function probeStore() {
    const store = fakeStore({ order: "r2" });
    for (const k of ["q/a", "q/a b", "q/a!", "q/a/b", "q/a0", "q/aa", "q/aé", "q/b"]) await store.put(k, new Uint8Array([1]));
    return store;
  }

  it("L1: the end of a key ranks between 0x30 and 0x61", async () => {
    expect(await keysOf(await probeStore(), { prefix: "q/" })).toEqual(["q/a b", "q/a!", "q/a/b", "q/a0", "q/a", "q/aa", "q/aé", "q/b"]);
  });

  it("L3, L4: startAfter does not follow the listing order", async () => {
    const store = await probeStore();
    expect(await keysOf(store, { prefix: "q/", startAfter: "q/a" })).toEqual(["q/a b", "q/a!", "q/a/b", "q/a0", "q/aa", "q/aé", "q/b"]);
    expect(await keysOf(store, { prefix: "q/", startAfter: "q/a b" })).toEqual(["q/a!", "q/a/b", "q/a0", "q/a", "q/aa", "q/aé", "q/b"]);
  });

  it("L8: U+0001-terminated keys list in byte order; a key over 1,024 bytes is refused", async () => {
    const store = fakeStore({ order: "r2" });
    for (const k of ["t/a/b\u0001", "t/a\u0001", "t/a b\u0001"]) await store.put(k, new Uint8Array([1]));
    expect(await keysOf(store, { prefix: "t/" })).toEqual(["t/a\u0001", "t/a b\u0001", "t/a/b\u0001"]);
    await expect(store.head("k".repeat(1025))).rejects.toThrow("10020");
  });
});

describe("[FILES-AC-001] Cloudflare: list is in code point order over R2's real order (FILES-REQ-001)", () => {
  const extensions = ["p/a/b", "p/a/c", "p/a/d", "p/a/e", "p/a/f"];
  const names = ["p/b", "p/a", "p/B", "p/a b", "p/a!", "p/a0", ...extensions, "p/é", "p/Z", "p/aa"];

  it.each([undefined, 1])("limit 3 (short store pages: %s), more than a page of p/a/… names: each name once, in code point order", async (shortPages) => {
    const fake = fakeStore({ order: "r2" });
    const store = cloudflareFilesStore(fake);
    const files = createFilesService({ store, tickets: noTickets });
    for (const name of [...names, "p-outside/x"]) await files.put(name, new Uint8Array([1]));
    fake.shortPages = shortPages;
    const pages = await listAll(store, "p/", 3);
    expect(pages.every((p) => p.length <= 3)).toBe(true);
    expect(pages.flat()).toStrictEqual(codePointSort(names));
  });
});

describe("Cloudflare stored keys (DEC-0430)", () => {
  it("storedKey adds U+0001 below PAR-230 bytes and not at it; nameOfKey strips it", () => {
    expect(storedKey("a/b")).toBe("a/b\u0001");
    expect(storedKey(`${"é".repeat(511)}x`)).toBe(`${"é".repeat(511)}x\u0001`); // 1,023 bytes
    expect(storedKey("é".repeat(512))).toBe("é".repeat(512)); // 1,024 bytes
    expect(nameOfKey("a/b\u0001")).toBe("a/b");
    expect(nameOfKey("é".repeat(512))).toBe("é".repeat(512));
  });

  it("put, get, head and delete address the stored key; the app sees only the name", async () => {
    const fake = fakeStore({ order: "r2" });
    const files = createFilesService({ store: cloudflareFilesStore(fake), tickets: noTickets });
    await files.put("docs/a.txt", new TextEncoder().encode("hi"), { contentType: "text/plain" });
    expect([...fake.objects.keys()]).toEqual(["docs/a.txt\u0001"]);
    expect(await files.head("docs/a.txt")).toEqual({ name: "docs/a.txt", size: 2, contentType: "text/plain" });
    const got = await files.get("docs/a.txt");
    expect(got?.name).toBe("docs/a.txt");
    expect(await new Response(got?.body).text()).toBe("hi");
    expect((await files.list("docs/")).items.map((i) => i.name)).toEqual(["docs/a.txt"]);
    await files.delete("docs/a.txt");
    expect(fake.objects.size).toBe(0);
    expect(await files.head("docs/a.txt")).toBeNull();
  });

  it("names of 1,023 and 1,024 bytes are stored and list in code point order; 1,025 bytes is FILES.INVALID_NAME", async () => {
    const fake = fakeStore({ order: "r2" });
    const store = cloudflareFilesStore(fake);
    const files = createFilesService({ store, tickets: noTickets });
    const n1023 = `n/${"k".repeat(1021)}`;
    const n1024 = `${n1023}k`; // n1023 is a proper prefix of n1024
    const other = `${n1023}!`; // 1,024 bytes, sorts between them
    for (const name of [n1024, other, n1023, "n/k"]) await files.put(name, new Uint8Array([1]));
    expect(fake.objects.has(n1024)).toBe(true);
    expect(fake.objects.has(`${n1023}\u0001`)).toBe(true);
    expect(await files.head(n1024)).toMatchObject({ name: n1024 });
    expect(await files.head(n1023)).toMatchObject({ name: n1023 });
    expect((await listAll(store, "n/", 1)).flat()).toStrictEqual(["n/k", n1023, other, n1024]);
    await expect(files.put(`${n1024}k`, new Uint8Array([1]))).rejects.toMatchObject({ code: "FILES.INVALID_NAME" });
    await files.delete(n1024);
    expect(fake.objects.has(n1024)).toBe(false);
  });

  it.each([".", "..", "x/../y", "a/."])("the dot name %j is stored with the ending and listed back unchanged", async (name) => {
    const fake = fakeStore({ order: "r2" });
    const files = createFilesService({ store: cloudflareFilesStore(fake), tickets: noTickets });
    await files.put(name, new Uint8Array([1]));
    expect([...fake.objects.keys()]).toEqual([`${name}\u0001`]);
    expect((await files.list("")).items.map((i) => i.name)).toEqual([name]);
    expect(await files.head(name)).toMatchObject({ name });
  });

  it("an unterminated key under 1,024 bytes (not written by FILES) is listed, not dropped", async () => {
    const fake = fakeStore({ order: "r2" });
    await fake.put("legacy.txt", new Uint8Array([1]));
    const files = createFilesService({ store: cloudflareFilesStore(fake), tickets: noTickets });
    expect((await files.list("")).items.map((i) => i.name)).toEqual(["legacy.txt"]);
  });
});
