import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../http/client.js";
import { downloadUrl, uploadFile } from "./client.js";
import type { DownloadTicket, UploadTicket } from "./public.js";

/** Minimal XMLHttpRequest stand-in: `script` drives the events once `send` is called. */
class FakeXhr {
  static sent: FakeXhr[] = [];
  static script: (xhr: FakeXhr) => void = (xhr) => xhr.finish(200);
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = "";
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    FakeXhr.sent.push(this);
    queueMicrotask(() => FakeXhr.script(this));
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true });
  }
  finish(status: number, responseText = "") {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }
  fail() {
    this.status = 0;
    this.onerror?.();
  }
}

const uploadTicket = (contentType = "image/png") =>
  ({ url: "/t/upload", method: "PUT", headers: { "Content-Type": contentType }, expiresAt: Date.now() + 60_000 }) as unknown as UploadTicket;

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected the transfer to fail");
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXhr.sent = [];
  FakeXhr.script = (xhr) => xhr.finish(200);
});

describe("downloadUrl (FILES-REQ-003)", () => {
  it("returns the ticket's URL", () => {
    const ticket = { url: "/t/download?x=1", expiresAt: Date.now() + 60_000 } as unknown as DownloadTicket;
    expect(downloadUrl(ticket)).toBe("/t/download?x=1");
  });

  it("anything that is not a download ticket fails with FILES.TRANSFER_FAILED", () => {
    expect(() => downloadUrl(uploadTicket() as unknown as DownloadTicket)).toThrow(ApiError);
    expect(() => downloadUrl({} as DownloadTicket)).toThrowError(expect.objectContaining({ code: "FILES.TRANSFER_FAILED", status: null }));
  });
});

describe("uploadFile (FILES-REQ-003, FILES-REQ-006)", () => {
  it("sends one PUT to the ticket's URL with the ticket's content type and the file as body", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    await uploadFile(uploadTicket(), file);
    expect(FakeXhr.sent).toHaveLength(1);
    const [xhr] = FakeXhr.sent;
    expect({ method: xhr?.method, url: xhr?.url, headers: xhr?.headers, body: xhr?.body }).toEqual({
      method: "PUT",
      url: "/t/upload",
      headers: { "Content-Type": "image/png" },
      body: file,
    });
  });

  it("a Blob without a type is sent with the ticket's content type", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    await uploadFile(uploadTicket("application/pdf"), new Blob(["x"]));
    expect(FakeXhr.sent[0]?.headers).toEqual({ "Content-Type": "application/pdf" });
  });

  it("[FILES-AC-003] a Blob whose non-empty type differs from the ticket's is rejected before sending", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const error = await failure(uploadFile(uploadTicket("image/png"), new Blob(["<svg/>"], { type: "image/svg+xml" })));
    expect({ code: error.code, status: error.status, message: error.message }).toEqual({
      code: "FILES.TRANSFER_FAILED",
      status: null,
      message: "content type does not match ticket",
    });
    expect(FakeXhr.sent).toHaveLength(0);
  });

  it("reports progress as bytes sent of the file's size", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    FakeXhr.script = (xhr) => {
      xhr.progress(4, 10);
      xhr.progress(10, 10);
      xhr.finish(200);
    };
    const seen: unknown[] = [];
    await uploadFile(uploadTicket(), new Blob([new Uint8Array(10)], { type: "image/png" }), { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([
      { loaded: 4, total: 10 },
      { loaded: 10, total: 10 },
    ]);
  });

  it("[FILES-AC-003] a refusal by storage fails with its status and 'rejected by storage (HTTP n)', without storage's body", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    FakeXhr.script = (xhr) => xhr.finish(403, "<Error><Code>ExpiredRequest</Code><Secret>do-not-echo</Secret></Error>");
    const error = await failure(uploadFile(uploadTicket(), new Blob(["x"])));
    expect({ code: error.code, status: error.status, message: error.message, requestId: error.requestId }).toEqual({
      code: "FILES.TRANSFER_FAILED",
      status: 403,
      message: "rejected by storage (HTTP 403)",
      requestId: null,
    });
  });

  it("[FILES-AC-004] no response at all (network or cross-origin blocked) fails with status null", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    FakeXhr.script = (xhr) => xhr.fail();
    const error = await failure(uploadFile(uploadTicket(), new Blob(["x"])));
    expect({ code: error.code, status: error.status, message: error.message }).toEqual({
      code: "FILES.TRANSFER_FAILED",
      status: null,
      message: "no response: network or cross-origin blocked",
    });
  });

  it("[FILES-AC-006] a transfer that stops after some bytes were sent fails with 'interrupted after n bytes'", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    FakeXhr.script = (xhr) => {
      xhr.progress(2048, 8192);
      xhr.progress(4096, 8192);
      xhr.fail();
    };
    const error = await failure(uploadFile(uploadTicket(), new Blob([new Uint8Array(8192)])));
    expect({ code: error.code, status: error.status, message: error.message }).toEqual({
      code: "FILES.TRANSFER_FAILED",
      status: null,
      message: "interrupted after 4096 bytes",
    });
  });

  it.each(["onabort", "ontimeout"] as const)("%s also fails the transfer with FILES.TRANSFER_FAILED", async (event) => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    FakeXhr.script = (xhr) => xhr[event]?.();
    const error = await failure(uploadFile(uploadTicket(), new Blob(["x"])));
    expect(error.code).toBe("FILES.TRANSFER_FAILED");
    expect(error.status).toBeNull();
  });

  it("anything that is not an upload ticket fails with FILES.TRANSFER_FAILED before sending", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const error = await failure(uploadFile({ url: "/x", expiresAt: 1 } as unknown as UploadTicket, new Blob(["x"])));
    expect({ code: error.code, status: error.status, message: error.message }).toEqual({
      code: "FILES.TRANSFER_FAILED",
      status: null,
      message: "rejected before sending: not an upload ticket",
    });
    expect(FakeXhr.sent).toHaveLength(0);
  });

  it("[FILES-AC-003] an expired ticket fails as expired before sending, without contacting storage and with no status (DEC-0534)", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-25T10:00:00Z") });
    try {
      const ticket = { url: "/t/upload", method: "PUT", headers: { "Content-Type": "image/png" }, expiresAt: Date.now() + 1000 } as unknown as UploadTicket;
      // Valid until the last millisecond before expiresAt.
      vi.setSystemTime(Date.now() + 999);
      await uploadFile(ticket, new Blob(["x"], { type: "image/png" }));
      expect(FakeXhr.sent).toHaveLength(1);
      vi.setSystemTime(Date.now() + 1);
      const error = await failure(uploadFile(ticket, new Blob(["x"], { type: "image/png" })));
      expect({ code: error.code, status: error.status, message: error.message, requestId: error.requestId }).toEqual({
        code: "FILES.TRANSFER_FAILED",
        status: null,
        message: "rejected before sending: ticket expired",
        requestId: null,
      });
      expect(FakeXhr.sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
