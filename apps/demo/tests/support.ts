import { createTestApp, type TestApp, type TestAppOptions } from "@lago-morph/prototype-framework/testing";
import { afterEach, expect } from "vitest";
import app from "../src/app";
import type { Created, PhotoUpload } from "../src/shared/types";

export const SHARE_KEY = "test-share-key-that-is-at-least-32-bytes-long";

/** A JSON request init. */
export function json(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

let opened: TestApp[] = [];

/** Opens an in-process demo app (with the share key set), disposed after the test. */
export async function open(options: TestAppOptions = {}): Promise<TestApp> {
  const t = await createTestApp(app, { secrets: { shareKey: SHARE_KEY }, ...options });
  opened.push(t);
  return t;
}

afterEach(async () => {
  await Promise.all(opened.map((t) => t.dispose()));
  opened = [];
});

/** The error code of a framework error response. */
export async function errorCode(res: Response): Promise<string> {
  const body: { error: { code: string } } = await res.json();
  return body.error.code;
}

/** A ticket's wire form (files.md "Testing"): the same JSON on every target; only `url` differs. */
export interface WireTicket {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

/** Sends a ticket: a path on the app through the test app, an absolute storage URL with plain `fetch`. */
export function sendTicket(t: TestApp, ticket: WireTicket, body?: Uint8Array<ArrayBuffer>): Promise<Response> {
  const init: RequestInit = { method: ticket.method ?? "GET", headers: ticket.headers ?? {} };
  if (body !== undefined) init.body = body;
  return /^\/(?![/\\])/.test(ticket.url) ? t.request(ticket.url, init) : fetch(ticket.url, init);
}

/** Creates a draft as `t` and returns its ID. */
export async function createDraft(t: TestApp, title = "A draft", body = "Some text"): Promise<string> {
  const res = await t.request("/api/posts", json("POST", { title, body }));
  expect(res.status).toBe(201);
  const created: Created = await res.json();
  return created.id;
}

/** JPEG-looking bytes of the given size (starts with the JPEG markers, then a repeating pattern). */
export function jpegBytes(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

/** Uploads and finalizes a photo on a draft; returns the finalize response. */
export async function attachPhoto(t: TestApp, postId: string, bytes: Uint8Array<ArrayBuffer>, contentType = "image/jpeg"): Promise<Response> {
  const res = await t.request(`/api/posts/${postId}/photos/upload-ticket`, json("POST", { contentType }));
  expect(res.status).toBe(200);
  const upload: PhotoUpload<WireTicket> = await res.json();
  const put = await sendTicket(t, upload.ticket, bytes);
  expect(put.status).toBeLessThan(300);
  return t.request(`/api/posts/${postId}/photos`, json("POST", { id: upload.id }));
}

export async function sha256(bytes: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
