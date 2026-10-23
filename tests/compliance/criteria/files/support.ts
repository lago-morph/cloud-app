/**
 * Shared helpers for the FILES compliance criteria (C-T3). Every test addresses the reference
 * app through its `/api/files/*` routes (apps/reference/ROUTES.md "Files") on the run's target,
 * as a logged-in user, under a prefix unique to the test, and removes what it created.
 */
import { randomBytes } from "node:crypto";
import type { ComplianceClient } from "../../harness/index.js";

export interface StoredFile {
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

export interface FilePage {
  readonly items: readonly StoredFile[];
  readonly nextCursor: string | null;
}

/** A prefix no other test or run uses: `c-t3/<label>/<random>/`. */
export function uniquePrefix(label: string): string {
  return `c-t3/${label}/${randomBytes(6).toString("hex")}/`;
}

export function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function fromB64(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, "base64"));
}

export async function put(user: ComplianceClient, name: string, bytes: Uint8Array, contentType?: string): Promise<void> {
  const body = contentType === undefined ? { name, base64: b64(bytes) } : { name, contentType, base64: b64(bytes) };
  user.expectStatus(await user.request("PUT", "/api/files/content", { json: body }), 204);
}

export async function head(user: ComplianceClient, name: string): Promise<StoredFile | null> {
  const res = user.expectStatus(await user.get(`/api/files/head?name=${encodeURIComponent(name)}`), 200);
  return res.json<{ file: StoredFile | null }>().file;
}

export async function getFile(user: ComplianceClient, name: string): Promise<(StoredFile & { readonly bytes: Uint8Array }) | null> {
  const res = user.expectStatus(await user.get(`/api/files/content?name=${encodeURIComponent(name)}`), 200);
  const file = res.json<{ file: (StoredFile & { base64: string }) | null }>().file;
  if (file === null) return null;
  return { name: file.name, size: file.size, contentType: file.contentType, bytes: fromB64(file.base64) };
}

export async function remove(user: ComplianceClient, name: string): Promise<void> {
  user.expectStatus(await user.request("DELETE", `/api/files/content?name=${encodeURIComponent(name)}`), 204);
}

export async function listPage(user: ComplianceClient, prefix: string, limit?: number, cursor?: string): Promise<FilePage> {
  const query = new URLSearchParams({ prefix });
  if (limit !== undefined) query.set("limit", String(limit));
  if (cursor !== undefined) query.set("cursor", cursor);
  return user.expectStatus(await user.get(`/api/files/list?${query.toString()}`), 200).json<FilePage>();
}

/** Every file under `prefix`, following cursors (bounded: tests store a handful of files). */
export async function listAll(user: ComplianceClient, prefix: string): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const result = await listPage(user, prefix, undefined, cursor);
    out.push(...result.items);
    if (result.nextCursor === null) return out;
    cursor = result.nextCursor;
  }
  throw new Error(`listing ${prefix} did not end within 50 pages`);
}

/** Deletes every file under `prefix` (cleanup; cloud stages are shared by a run's criteria). */
export async function removeAll(user: ComplianceClient, prefix: string): Promise<void> {
  for (const f of await listAll(user, prefix)) await remove(user, f.name);
}
