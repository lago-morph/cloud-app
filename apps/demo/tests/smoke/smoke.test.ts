import { connectTestStage, createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import app from "../../src/app";
import type { Banner, PostDetail, PostPage, Preferences, ShareLink, Site } from "../../src/shared/types";
import { createDraft, jpegBytes, json, sameBytes, type WireTicket } from "../support";

declare module "vitest" {
  interface ProvidedContext {
    /** Set by the `smoke` command: run against the stage it targets instead of in-process. */
    prototypeFrameworkSmoke: boolean;
  }
}

// One file, two ways: in-process during `verify`, against the dev server or a test stage under `smoke`.
// Each run uses fresh mock identities and only asserts on the rows it creates (stage data is kept).
const run = crypto.randomUUID();
let base: TestApp;
let user: TestApp;
let other: TestApp;
let admin: TestApp;

beforeAll(async () => {
  base = inject("prototypeFrameworkSmoke") === true
    ? await connectTestStage()
    : await createTestApp(app, { secrets: { shareKey: "smoke-test-share-key-at-least-32-bytes" } });
  user = base.as(mockUsers.user(`smoke-${run}`));
  other = base.as(mockUsers.user(`smoke-other-${run}`));
  admin = base.as(mockUsers.admin(`smoke-admin-${run}`));
});

afterAll(async () => {
  await Promise.all([user.dispose(), other.dispose(), admin.dispose()]);
  await base.dispose();
});

/** Sends a request to a ticket's URL: same-origin tickets through the test app, others directly to storage. */
function send(t: TestApp, ticket: WireTicket, init: RequestInit): Promise<Response> {
  const request = { ...init, method: ticket.method ?? init.method ?? "GET", headers: ticket.headers ?? {} };
  return /^https?:\/\//.test(ticket.url) ? fetch(ticket.url, request) : t.request(ticket.url, request);
}

async function addPhoto(postId: string, bytes: Uint8Array<ArrayBuffer>): Promise<{ id: string; res: Response }> {
  const ticketRes = await user.request(`/api/posts/${postId}/photos/upload-ticket`, json("POST", { contentType: "image/jpeg" }));
  expect(ticketRes.status).toBe(200);
  const { id, ticket }: { id: string; ticket: WireTicket } = await ticketRes.json();
  const put = await send(user, ticket, { method: "PUT", body: bytes });
  expect(put.status).toBeLessThan(300);
  const res = await user.request(`/api/posts/${postId}/photos/finalize`, json("POST", { id, name: "smoke.jpg" }));
  return { id, res };
}

async function photoTicket(t: TestApp, photoId: string, share?: string): Promise<Response> {
  return t.request(`/api/photos/${photoId}/download-ticket`, json("POST", share === undefined ? {} : { share }));
}

it("the app is healthy", async () => {
  expect((await base.request("/api/__framework/health")).status).toBe(204);
});

it("serves the configured site settings (DEMO-REQ-006)", async () => {
  const res = await base.request("/api/site");
  expect(res.status).toBe(200);
  const site: Site = await res.json();
  expect(typeof site.title).toBe("string");
  expect(site.maxPhotosPerPost).toBeGreaterThan(0);
  expect(site.shareLinkDays).toBeGreaterThan(0);
});

it("shows the account's user ID (DEMO-REQ-009)", async () => {
  const me: { level: string; id: string } = await (await user.request("/api/auth/me")).json();
  expect(me).toMatchObject({ level: "user", id: `smoke-${run}` });
});

it("enforces who may do what, and shows only published posts to visitors (DEMO-REQ-001, DEMO-REQ-002, DEMO-REQ-008)", async () => {
  const title = `<script>alert("${run}")</script>`;
  expect((await base.request("/api/posts", json("POST", { title, body: "" }))).status).toBe(401);
  const id = await createDraft(user, title, "smoke body");

  expect((await base.request(`/api/posts/${id}`)).status).toBe(404);
  expect((await other.request(`/api/posts/${id}`)).status).toBe(404);
  expect((await other.request(`/api/posts/${id}`, json("PATCH", { title: "x" }))).status).toBe(404);
  expect((await user.request(`/api/posts/${id}`, json("PATCH", { body: "edited" }))).status).toBe(200);
  expect((await user.request(`/api/posts/${id}/publish`, json("POST"))).status).toBe(403);

  expect((await admin.request(`/api/posts/${id}/publish`, json("POST"))).status).toBe(200);
  const post: PostDetail = await (await base.request(`/api/posts/${id}`)).json();
  expect(post).toMatchObject({ title, body: "edited", status: "published" });
  const page: PostPage = await (await base.request("/api/posts?perPage=50")).json();
  expect(page.posts.every((p) => p.status === "published")).toBe(true);
  const created = page.posts.map((p) => p.createdAt);
  expect(created).toEqual([...created].sort((a, b) => b - a));
  expect(page.posts.some((p) => p.id === id && p.title === title)).toBe(true);

  expect((await user.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(403);
  expect((await admin.request(`/api/posts/${id}/unpublish`, json("POST"))).status).toBe(200);
  expect((await base.request(`/api/posts/${id}`)).status).toBe(404);
  expect((await admin.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
  expect((await user.request(`/api/posts/${id}`)).status).toBe(404);
});

it("uploads a 20 MB JPEG that downloads byte-identical, enforces the maximum, and deletes photos with the post (DEMO-REQ-003)", async () => {
  const site: Site = await (await base.request("/api/site")).json();
  const id = await createDraft(user, `photos ${run}`);
  const bytes = jpegBytes(20 * 1024 * 1024);
  const big = await addPhoto(id, bytes);
  expect(big.res.status).toBe(201);

  const ticketRes = await photoTicket(user, big.id);
  expect(ticketRes.status).toBe(200);
  const { ticket }: { ticket: WireTicket } = await ticketRes.json();
  const got = await send(user, ticket, { method: "GET" });
  expect(got.status).toBe(200);
  expect(sameBytes(new Uint8Array(await got.arrayBuffer()), bytes)).toBe(true);
  expect((await photoTicket(base, big.id)).status).toBe(404);

  for (let n = 1; n < site.maxPhotosPerPost; n++) expect((await addPhoto(id, jpegBytes(1024))).res.status).toBe(201);
  const over = await user.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/jpeg" }));
  expect(over.status).toBe(409);
  const post: PostDetail = await (await user.request(`/api/posts/${id}`)).json();
  expect(post.photos).toHaveLength(site.maxPhotosPerPost);

  expect((await user.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
  expect((await photoTicket(user, big.id)).status).toBe(404);
  expect((await send(user, ticket, { method: "GET" })).status).toBe(404);
});

it("shows an admin's banner to visitors, and refuses it from users (DEMO-REQ-004)", async () => {
  const text = `smoke banner ${run}`;
  expect((await user.request("/api/banner", json("PUT", { banner: text }))).status).toBe(403);
  const set: Banner = await (await admin.request("/api/banner", json("PUT", { banner: text }))).json();
  expect(set.banner).toBe(text);
  const site: Site = await (await base.request("/api/site")).json();
  expect(site.banner).toBe(text);
  expect((await admin.request("/api/banner", json("PUT", { banner: null }))).status).toBe(200);
});

it("keeps a user's posts-per-page choice across sessions (DEMO-REQ-005)", async () => {
  expect((await user.request("/api/preferences", json("PUT", { perPage: 3 }))).status).toBe(200);
  // A second session of the same login; disposed with `base` (disposing an `as()` view ends the shared app).
  const again = base.as(mockUsers.user(`smoke-${run}`));
  const prefs: Preferences = await (await again.request("/api/preferences")).json();
  expect(prefs).toEqual({ perPage: 3 });
  const page: PostPage = await (await again.request("/api/posts")).json();
  expect(page.perPage).toBe(3);
});

it("shows a draft through its share link and refuses an altered link (DEMO-REQ-007)", async () => {
  const id = await createDraft(user, `shared ${run}`);
  const photo = await addPhoto(id, jpegBytes(2048));
  expect(photo.res.status).toBe(201);
  const res = await user.request(`/api/posts/${id}/share`, json("POST"));
  expect(res.status).toBe(201);
  const link: ShareLink = await res.json();

  const viewed = await base.request(`/api/shared/${encodeURIComponent(link.token)}`);
  expect(viewed.status).toBe(200);
  const post: PostDetail = await viewed.json();
  expect(post).toMatchObject({ id, status: "draft" });
  expect((await photoTicket(base, photo.id, link.token)).status).toBe(200);

  const [subject = "", expiresAt = "", signature = ""] = link.token.split(".");
  const altered = `${subject}.${String(Number(expiresAt) + 1)}.${signature}`;
  expect((await base.request(`/api/shared/${encodeURIComponent(altered)}`)).status).toBe(404);
  expect((await photoTicket(base, photo.id, altered)).status).toBe(404);
  expect((await user.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
});
