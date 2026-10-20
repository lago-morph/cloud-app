import { createTestApp, type TestApp, type TestAppOptions } from "@lago-morph/prototype-framework/testing";
import { afterEach, expect } from "vitest";
import app from "../src/app";
import type { Created } from "../src/shared/types";

export const SHARE_KEY = "test-share-key-at-least-32-bytes-long";

/** A JSON request init. */
export function json(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

let opened: TestApp[] = [];

/** Opens an in-process demo app with the share key set, disposed after the test. */
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

/** Creates a draft as `t`'s user and returns its ID. */
export async function createDraft(t: TestApp, title = "A draft", body = "Some text"): Promise<string> {
  const res = await t.request("/api/posts", json("POST", { title, body }));
  expect(res.status).toBe(201);
  const created: Created = await res.json();
  return created.id;
}

/** The ticket's wire form (testing.md "The smoke test"): a path on the app locally, a storage URL on a cloud. */
export interface WireTicket {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

/** Sends a ticket request: app paths through the test app, absolute storage URLs with plain fetch and no cookie. */
export function sendTicket(t: TestApp, ticket: WireTicket, body?: Uint8Array<ArrayBuffer>): Promise<Response> {
  const init: RequestInit = { method: ticket.method ?? "GET" };
  if (ticket.headers !== undefined) init.headers = ticket.headers;
  if (body !== undefined) init.body = body;
  return /^\/(?![/\\])/.test(ticket.url) ? t.request(ticket.url, init) : fetch(ticket.url, init);
}

/** Uploads `bytes` as a photo of the draft `postId` without finalizing it; returns the photo ID. */
export async function uploadPhoto(t: TestApp, postId: string, contentType: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const res = await t.request(`/api/posts/${postId}/photos/upload-ticket`, json("POST", { contentType }));
  expect(res.status).toBe(200);
  const { photoId, ticket }: { photoId: string; ticket: WireTicket } = await res.json();
  const put = await sendTicket(t, ticket, bytes);
  expect(put.status).toBeLessThan(300);
  return photoId;
}

/** Uploads and finalizes a photo; returns the finalize response. */
export async function addPhoto(t: TestApp, postId: string, contentType: string, bytes: Uint8Array<ArrayBuffer>): Promise<Response> {
  const photoId = await uploadPhoto(t, postId, contentType, bytes);
  return t.request(`/api/posts/${postId}/photos/finalize`, json("POST", { photoId }));
}

/** Bytes that start like a JPEG file, with a recognisable pattern after the header. */
export function jpegBytes(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) % 251;
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

/** Whether two byte arrays are identical. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
