import { describe, expect, it } from "vitest";
import { FrameworkError } from "../core/errors.js";
import { createDeployment } from "../core/identity.js";
import { logFailure } from "../log/failures.js";
import { createMemorySink } from "../log/memory.js";
import { createLogWriter } from "../log/writer.js";
import { fakeStore, unreachableStore } from "./fake-store.test-support.js";
import { createFilesService, type TicketIssuer } from "./service.js";

const deployment = createDeployment({ app: "notes", stage: "dev", target: "local" });

const noTickets: TicketIssuer = {
  upload: async () => {
    throw new Error("unexpected ticket");
  },
  download: async () => {
    throw new Error("unexpected ticket");
  },
};

function recordingIssuer() {
  const calls: unknown[][] = [];
  const issuer: TicketIssuer = {
    upload: async (name, contentType) => {
      calls.push(["upload", name, contentType]);
      return { opaque: "u" };
    },
    download: async (name) => {
      calls.push(["download", name]);
      return { opaque: "d" };
    },
  };
  return { calls, issuer };
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  return Array.from(new Uint8Array(await new Response(stream).arrayBuffer()));
}

describe("[FILES-AC-001] put, get, head, delete (FILES-REQ-001)", () => {
  it("put stores the bytes and content type; get and head return them with the name", async () => {
    const files = createFilesService({ store: fakeStore(), tickets: noTickets });
    await files.put("photos/a.png", new Uint8Array([137, 80, 0, 255]), { contentType: "image/png" });
    const got = await files.get("photos/a.png");
    expect(got).not.toBeNull();
    expect({ name: got?.name, size: got?.size, contentType: got?.contentType }).toEqual({ name: "photos/a.png", size: 4, contentType: "image/png" });
    expect(await bytesOf(got!.body)).toEqual([137, 80, 0, 255]);
    expect(await files.head("photos/a.png")).toStrictEqual({ name: "photos/a.png", size: 4, contentType: "image/png" });
  });

  it("the content type defaults to application/octet-stream", async () => {
    const store = fakeStore();
    const files = createFilesService({ store, tickets: noTickets });
    await files.put("raw.bin", new Uint8Array([1]));
    expect(store.objects.get("raw.bin")?.contentType).toBe("application/octet-stream");
    // An object stored without a content type reads back with the default too.
    await store.put("legacy", new Uint8Array([2]));
    expect(await files.head("legacy")).toStrictEqual({ name: "legacy", size: 1, contentType: "application/octet-stream" });
  });

  it("get and head return null for an absent file; deleting an absent file succeeds", async () => {
    const files = createFilesService({ store: fakeStore(), tickets: noTickets });
    expect(await files.get("nope")).toBeNull();
    expect(await files.head("nope")).toBeNull();
    await files.put("gone", new Uint8Array([1]));
    await files.delete("gone");
    await files.delete("gone");
    expect(await files.head("gone")).toBeNull();
  });
});

describe("[FILES-AC-001] list (FILES-REQ-001; PAR-231, PAR-232)", () => {
  async function filled(names: readonly string[]) {
    const store = fakeStore();
    const files = createFilesService({ store, tickets: noTickets });
    for (const name of names) await files.put(name, new TextEncoder().encode(name), { contentType: "text/plain" });
    return { store, files };
  }

  async function pages(files: ReturnType<typeof createFilesService>, prefix: string, limit?: number) {
    const out: string[][] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const options = { ...(limit === undefined ? {} : { limit }), ...(cursor === undefined ? {} : { cursor }) };
      const page = await files.list(prefix, options);
      out.push(page.items.map((i) => i.name));
      if (page.nextCursor === null) return out;
      cursor = page.nextCursor;
    }
    throw new Error("too many pages");
  }

  it("returns files under the literal prefix with metadata, page by page, each once, with a null cursor at the end", async () => {
    const { files } = await filled(["p/b", "p/a", "p/😀", "p/€", "q/a", "pa", "p"]);
    expect(await pages(files, "p/", 2)).toEqual([["p/a", "p/b"], ["p/€", "p/😀"]]);
    const first = await files.list("p/", { limit: 1 });
    expect(first.items).toStrictEqual([{ name: "p/a", size: 3, contentType: "text/plain" }]);
  });

  it("fills each page to the limit even when the store returns short truncated pages", async () => {
    const { store, files } = await filled(["a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
    store.shortPages = 2;
    expect(await pages(files, "a", 3)).toEqual([["a1", "a2", "a3"], ["a4", "a5", "a6"], ["a7"]]);
  });

  it("pages hold PAR-231 (100) items by default and at most PAR-232 (1,000)", async () => {
    const names = Array.from({ length: 1001 }, (_, i) => `n/${String(i).padStart(4, "0")}`);
    const { files } = await filled(names);
    expect((await files.list("n/")).items).toHaveLength(100);
    const big = await files.list("n/", { limit: 5000 });
    expect(big.items).toHaveLength(1000);
    expect(big.nextCursor).not.toBeNull();
  });

  it("an empty prefix lists everything; an exactly full last page has a null cursor", async () => {
    const { files } = await filled(["b", "a", "c", "d"]);
    expect(await pages(files, "", 2)).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("a bad cursor or one issued for another prefix is rejected with FILES.INVALID_CURSOR", async () => {
    const { files } = await filled(["c/1", "c/2", "d/1", "d/2"]);
    const page = await files.list("c/", { limit: 1 });
    await expect(files.list("d/", { cursor: page.nextCursor ?? "" })).rejects.toMatchObject({ code: "FILES.INVALID_CURSOR" });
    await expect(files.list("c/", { cursor: "%%%" })).rejects.toMatchObject({ code: "FILES.INVALID_CURSOR" });
  });
});

describe("tickets (FILES-REQ-003)", () => {
  it("createUploadTicket asks the target's issuer for the name and content type (default application/octet-stream)", async () => {
    const { calls, issuer } = recordingIssuer();
    const files = createFilesService({ store: fakeStore(), tickets: issuer });
    expect(await files.createUploadTicket("a.png", { contentType: "image/png" })).toEqual({ opaque: "u" });
    await files.createUploadTicket("b.bin");
    expect(calls).toEqual([["upload", "a.png", "image/png"], ["upload", "b.bin", "application/octet-stream"]]);
  });

  it("createDownloadTicket throws FILES.NOT_FOUND for an absent file and asks the issuer for a present one", async () => {
    const { calls, issuer } = recordingIssuer();
    const files = createFilesService({ store: fakeStore(), tickets: issuer });
    await expect(files.createDownloadTicket("missing")).rejects.toMatchObject({ name: "FrameworkError", code: "FILES.NOT_FOUND" });
    await files.put("here", new Uint8Array([1]));
    expect(await files.createDownloadTicket("here")).toEqual({ opaque: "d" });
    expect(calls).toEqual([["download", "here"]]);
  });
});

describe("[FILES-AC-006] server part: unreachable storage (FILES-REQ-006, LOG-REQ-005)", () => {
  const ops: [string, (files: ReturnType<typeof createFilesService>) => Promise<unknown>][] = [
    ["put", (f) => f.put("x", new Uint8Array([1]))],
    ["get", (f) => f.get("x")],
    ["head", (f) => f.head("x")],
    ["delete", (f) => f.delete("x")],
    ["list", (f) => f.list("")],
    ["createUploadTicket", (f) => f.createUploadTicket("x")],
    ["createDownloadTicket", (f) => f.createDownloadTicket("x")],
  ];

  it.each(ops)("%s fails with FILES.UNAVAILABLE, logged once as a FILES error entry", async (_label, op) => {
    const memory = createMemorySink(() => undefined);
    const log = createLogWriter({ deployment, requestId: "r-1", request: { method: "POST", path: "/api/x" } }, memory.sink);
    const files = createFilesService({ store: unreachableStore(), tickets: recordingIssuer().issuer, log });
    const error = await op(files).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FrameworkError);
    expect((error as FrameworkError).code).toBe("FILES.UNAVAILABLE");
    expect(memory.entries()).toHaveLength(1);
    expect(memory.entries()[0]).toMatchObject({ component: "FILES", severity: "error" });
    expect(memory.entries()[0]?.message).toMatch(/^POST \/api\/x failed with FILES.UNAVAILABLE\n/);
    // The handler logging the same error again adds nothing.
    logFailure(log, error);
    expect(memory.entries()).toHaveLength(1);
  });

  it("a FrameworkError raised inside an operation passes through unchanged", async () => {
    const store = fakeStore();
    store.head = async () => {
      throw new FrameworkError("FILES.INVALID_NAME", "store said so");
    };
    const files = createFilesService({ store, tickets: recordingIssuer().issuer });
    await expect(files.head("x")).rejects.toMatchObject({ code: "FILES.INVALID_NAME", message: "store said so" });
  });
});

describe("[FILES-AC-002] every operation that takes a name checks it (FILES-REQ-002)", () => {
  const ops: [string, (files: ReturnType<typeof createFilesService>, name: string) => Promise<unknown>][] = [
    ["put", (f, n) => f.put(n, new Uint8Array([1]))],
    ["get", (f, n) => f.get(n)],
    ["head", (f, n) => f.head(n)],
    ["delete", (f, n) => f.delete(n)],
    ["createUploadTicket", (f, n) => f.createUploadTicket(n)],
    ["createDownloadTicket", (f, n) => f.createDownloadTicket(n)],
    ["list (prefix)", (f, n) => f.list(n)],
  ];
  it.each(ops)("%s rejects a bad name with FILES.INVALID_NAME and stores nothing", async (_label, op) => {
    const store = fakeStore();
    const files = createFilesService({ store, tickets: noTickets });
    await expect(op(files, "bad\nname")).rejects.toMatchObject({ name: "FrameworkError", code: "FILES.INVALID_NAME" });
    expect(store.objects.size).toBe(0);
  });
});
