import { expect } from "vitest";
import type { TestApp } from "@lago-morph/prototype-framework/testing";
import type { Created, Photo } from "../src/shared/types";

export const json = (method: string, body?: unknown): RequestInit =>
  body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };

/** The upload ticket's wire form (files.md), so a test can send what `uploadFile` sends. */
export interface WireTicket {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

export async function createDraft(t: TestApp, title: string, body = "text"): Promise<string> {
  const res = await t.request("/api/posts", json("POST", { title, body }));
  expect(res.status).toBe(201);
  const created: Created = await res.json();
  return created.id;
}

/** A JPEG-looking byte pattern of `size` bytes, different at every position modulo 251. */
export function jpegBytes(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7 + 3) % 251;
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

/** Asks for an upload ticket and sends the bytes with it. Returns the photo ID. */
export async function uploadPhoto(t: TestApp, postId: string, contentType: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const res = await t.request(`/api/posts/${postId}/photos/upload-ticket`, json("POST", { contentType }));
  expect(res.status).toBe(200);
  const { id, ticket }: { id: string; ticket: WireTicket } = await res.json();
  const put = await t.request(ticket.url, { method: ticket.method ?? "PUT", headers: ticket.headers ?? {}, body: bytes });
  expect(put.status).toBeLessThan(300);
  return id;
}

/** Uploads and finalizes a photo. */
export async function addPhoto(t: TestApp, postId: string, bytes: Uint8Array<ArrayBuffer>, contentType = "image/jpeg"): Promise<Photo> {
  const id = await uploadPhoto(t, postId, contentType, bytes);
  const res = await t.request(`/api/posts/${postId}/photos/finalize`, json("POST", { id, name: "photo.jpg" }));
  expect(res.status).toBe(201);
  const photo: Photo = await res.json();
  return photo;
}

/** A download ticket for a photo, or the failed response. */
export async function downloadTicket(t: TestApp, photoId: string, share?: string): Promise<Response> {
  return t.request(`/api/photos/${photoId}/download-ticket`, json("POST", share === undefined ? {} : { share }));
}

/** Downloads the photo through a fresh ticket and returns its bytes. */
export async function downloadPhoto(t: TestApp, photoId: string, share?: string): Promise<Uint8Array> {
  const res = await downloadTicket(t, photoId, share);
  expect(res.status).toBe(200);
  const { ticket }: { ticket: WireTicket } = await res.json();
  const got = await t.request(ticket.url, { method: ticket.method ?? "GET", headers: ticket.headers ?? {} });
  expect(got.status).toBe(200);
  return new Uint8Array(await got.arrayBuffer());
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
