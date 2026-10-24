import { describe, expect, it } from "vitest";
import { fakeStore } from "../fake-store.test-support.js";
import { createFilesService, type FilesStore, type TicketIssuer } from "../service.js";
import { cloudflareFilesStore } from "./keys.js";

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
