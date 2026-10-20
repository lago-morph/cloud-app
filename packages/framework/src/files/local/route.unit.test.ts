import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../../core/assemble.js";
import { fakeStore, type FakeStore } from "../fake-store.test-support.js";
import { createFilesService } from "../service.js";
import { registerLocalTransferRoute } from "./route.js";
import { createLocalTicketIssuer } from "./tickets.js";

/** A generated dummy key, never a real credential. */
const key = `k-${crypto.randomUUID()}`;

function setup(): { app: Hono<RuntimeEnv>; store: FakeStore; files: ReturnType<typeof createFilesService> } {
  const store = fakeStore();
  const files = createFilesService({ store, tickets: createLocalTicketIssuer({ key: async () => key }) });
  const app = new Hono<RuntimeEnv>();
  app.use(async (c, next) => {
    c.set("files", files);
    await next();
  });
  const api = new Hono<RuntimeEnv>();
  registerLocalTransferRoute(api, { key: async () => key });
  app.route("/api", api);
  return { app, store, files };
}

function urlOf(ticket: unknown): string {
  return (ticket as { url: string }).url;
}

function expectSafeHeaders(res: Response): void {
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("local transfer route: uploads (FILES-REQ-003)", () => {
  it("a PUT with a valid upload ticket and its content type stores the body under the ticket's name", async () => {
    const { app, store, files } = setup();
    const url = urlOf(await files.createUploadTicket("a/b c.png", { contentType: "image/png" }));
    const res = await app.request(url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: new Uint8Array([1, 2, 3]) });
    expect(res.status).toBe(200);
    expectSafeHeaders(res);
    expect(Array.from(store.objects.get("a/b c.png")?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(store.objects.get("a/b c.png")?.contentType).toBe("image/png");
  });

  it("the ticket may be used repeatedly until it expires", async () => {
    const { app, store, files } = setup();
    const url = urlOf(await files.createUploadTicket("x", { contentType: "text/plain" }));
    for (const body of ["one", "two"]) {
      const res = await app.request(url, { method: "PUT", headers: { "Content-Type": "text/plain" }, body });
      expect(res.status).toBe(200);
    }
    expect(new TextDecoder().decode(store.objects.get("x")?.bytes)).toBe("two");
  });

  it.each([
    ["a different content type", { "Content-Type": "text/html" }],
    ["no content type", {}],
  ])("an upload with %s is refused with 403 and nothing is stored", async (_label, headers) => {
    const { app, store, files } = setup();
    const url = urlOf(await files.createUploadTicket("x.png", { contentType: "image/png" }));
    const res = await app.request(url, { method: "PUT", headers, body: "<script>alert(1)</script>" });
    expect(res.status).toBe(403);
    expectSafeHeaders(res);
    expect(store.objects.size).toBe(0);
  });

  it("a download ticket cannot upload, a tampered ticket cannot upload, and an expired ticket is refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
    const { app, store, files } = setup();
    await files.put("x", new Uint8Array([9]), { contentType: "text/plain" });
    const download = urlOf(await files.createDownloadTicket("x"));
    const upload = urlOf(await files.createUploadTicket("x", { contentType: "text/plain" }));
    const put = (url: string) => app.request(url, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "new" });
    expect((await put(download)).status).toBe(403);
    expect((await put(`${upload}x`)).status).toBe(403);
    vi.setSystemTime(Date.now() + 15 * 60 * 1000);
    expect((await put(upload)).status).toBe(403);
    expect(Array.from(store.objects.get("x")?.bytes ?? [])).toEqual([9]);
  });
});

describe("local transfer route: downloads (FILES-REQ-003, files.md §2 Local)", () => {
  it("a GET with a valid download ticket returns the bytes with the stored content type", async () => {
    const { app, files } = setup();
    await files.put("p.png", new Uint8Array([137, 80, 78, 71]), { contentType: "image/png" });
    const res = await app.request(urlOf(await files.createDownloadTicket("p.png")));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe("inline; filename*=UTF-8''p.png");
    expectSafeHeaders(res);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([137, 80, 78, 71]);
  });

  it.each(["text/html", "image/svg+xml", "application/octet-stream", "application/pdf"])(
    "content of type %s is served as an attachment named after the file (DEC-0313)",
    async (contentType) => {
      const { app, files } = setup();
      await files.put("f", new TextEncoder().encode("<svg onload=alert(1)>"), { contentType });
      const res = await app.request(urlOf(await files.createDownloadTicket("f")));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''f");
      expectSafeHeaders(res);
    },
  );

  it.each(["image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"])("raster image type %s is served inline, named after the file (DEC-0313)", async (contentType) => {
    const { app, files } = setup();
    await files.put("i", new Uint8Array([1]), { contentType });
    const res = await app.request(urlOf(await files.createDownloadTicket("i")));
    expect(res.headers.get("Content-Disposition")).toBe("inline; filename*=UTF-8''i");
  });

  it("a download is saved under the whole file name, percent-encoded, never the ticket token (DEC-0313)", async () => {
    const { app, files } = setup();
    await files.put("photos/ä b.txt", new Uint8Array([1]), { contentType: "text/plain" });
    const res = await app.request(urlOf(await files.createDownloadTicket("photos/ä b.txt")));
    expect(res.headers.get("Content-Disposition")).toBe("attachment; filename*=UTF-8''photos%2F%C3%A4%20b.txt");
  });

  it("an upload ticket cannot download, a tampered or expired ticket is refused, and a deleted file is 404", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
    const { app, files } = setup();
    await files.put("x", new Uint8Array([1]));
    const download = urlOf(await files.createDownloadTicket("x"));
    const upload = urlOf(await files.createUploadTicket("x"));
    expect((await app.request(upload)).status).toBe(403);
    expect((await app.request(`${download}x`)).status).toBe(403);
    await files.delete("x");
    const missing = await app.request(download);
    expect(missing.status).toBe(404);
    expectSafeHeaders(missing);
    await files.put("x", new Uint8Array([1]));
    vi.setSystemTime(Date.now() + 15 * 60 * 1000);
    const expired = await app.request(download);
    expect(expired.status).toBe(403);
    expectSafeHeaders(expired);
  });
});
