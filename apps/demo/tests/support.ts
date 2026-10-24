import { createTestApp, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterEach, expect } from "vitest";
import app from "../src/app";
import type { Created, PhotoUpload, Post, StoredPhoto } from "../src/shared/types";

/** A JSON request init. */
export function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

let opened: TestApp[] = [];

/** Opens an in-process demo app, disposed after the test. */
export async function open(options?: Parameters<typeof createTestApp>[1]): Promise<TestApp> {
  const t = await createTestApp(app, { secrets: { shareKey: "test-share-key-at-least-32-bytes-long!" }, ...options });
  opened.push(t);
  return t;
}

afterEach(async () => {
  await Promise.all(opened.map((t) => t.dispose()));
  opened = [];
});

/** The error body of a framework error response. */
export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}

/** The error code of a response, checking its status. */
export async function errorCode(res: Response, status: number): Promise<string> {
  expect(res.status).toBe(status);
  const body: ErrorBody = await res.json();
  return body.error.code;
}

/** A ticket's wire form (files.md "Testing"): the same JSON on every target; only `url` differs. */
export interface WireTicket {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly expiresAt: number;
}

/** Sends a ticket's request: a path on the app through the test app, an absolute storage URL with plain fetch (testing.md). */
export function sendTicket(t: TestApp, ticket: WireTicket, body?: Uint8Array<ArrayBuffer>): Promise<Response> {
  const init: RequestInit = { method: ticket.method ?? "GET" };
  if (ticket.headers !== undefined) init.headers = ticket.headers;
  if (body !== undefined) init.body = body;
  return /^\/(?![/\\])/.test(ticket.url) ? t.request(ticket.url, init) : fetch(ticket.url, init);
}

/** Bytes that start like a JPEG file, `size` long, with a varying pattern. */
export function jpegBytes(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + (i >> 10)) & 0xff;
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

/** Bytes that start like a PNG file. */
export function pngBytes(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

/** Creates a draft as `t`'s user and returns its ID. */
export async function createDraft(t: TestApp, title: string, body = "text"): Promise<string> {
  const res = await t.request("/api/posts", json("POST", { title, body }));
  expect(res.status).toBe(201);
  const created: Created = await res.json();
  return created.id;
}

/** Uploads and finalizes one photo on a draft; returns the finalize response. */
export async function addPhoto(t: TestApp, postId: string, contentType: string, bytes: Uint8Array<ArrayBuffer>, name = "photo.jpg"): Promise<Response> {
  const res = await t.request(`/api/posts/${postId}/photos/upload-ticket`, json("POST", { contentType }));
  expect(res.status).toBe(200);
  const { photoId, ticket }: PhotoUpload<WireTicket> = await res.json();
  const put = await sendTicket(t, ticket, bytes);
  expect(put.status).toBeLessThan(300);
  return t.request(`/api/posts/${postId}/photos/finalize`, json("POST", { photoId, name }));
}

/** Reads a post as `t`'s user. */
export async function readPost(t: TestApp, postId: string): Promise<Post<WireTicket>> {
  const res = await t.request(`/api/posts/${postId}`);
  expect(res.status).toBe(200);
  const body: Post<WireTicket> = await res.json();
  return body;
}

/** Downloads a photo through its ticket and returns its bytes. */
export async function downloadPhoto(t: TestApp, ticket: WireTicket): Promise<Uint8Array> {
  const res = await sendTicket(t, ticket);
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}

/** Whether two byte arrays are identical. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export type { StoredPhoto };
