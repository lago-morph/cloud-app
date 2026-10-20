import { connectTestStage, createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import app from "../../src/app";
import type { Created, DraftList, Photo, PostDetail, PostPage, Preferences, ShareLink, Site } from "../../src/shared/types";
import { jpegBytes, sameBytes, sendTicket, type WireTicket } from "../support";

declare module "vitest" {
  interface ProvidedContext {
    /** Set by the `smoke` command: run against the stage it targets instead of in-process. */
    prototypeFrameworkSmoke: boolean;
  }
}

// One file, two ways: in-process during `verify`, against the dev server or a test stage under `smoke`.
// Stage data is kept between runs, so every check uses this run's own users and posts.
const run = crypto.randomUUID();
const userId = `smoke-${run}`;
let base: TestApp;
let user: TestApp;
let other: TestApp;
let admin: TestApp;

function json(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function createDraft(t: TestApp, title: string): Promise<string> {
  const res = await t.request("/api/posts", json("POST", { title, body: `smoke body ${run}` }));
  expect(res.status).toBe(201);
  const created: Created = await res.json();
  return created.id;
}

async function addPhoto(t: TestApp, postId: string, bytes: Uint8Array<ArrayBuffer>): Promise<Response> {
  const res = await t.request(`/api/posts/${postId}/photos/upload-ticket`, json("POST", { contentType: "image/jpeg" }));
  expect(res.status).toBe(200);
  const { photoId, ticket }: { photoId: string; ticket: WireTicket } = await res.json();
  const put = await sendTicket(t, ticket, bytes);
  expect(put.status).toBeLessThan(300);
  return t.request(`/api/posts/${postId}/photos/finalize`, json("POST", { photoId }));
}

beforeAll(async () => {
  base = inject("prototypeFrameworkSmoke") === true
    ? await connectTestStage()
    : await createTestApp(app, { secrets: { shareKey: "smoke-test-share-key-at-least-32-bytes" } });
  user = base.as(mockUsers.user(userId));
  other = base.as(mockUsers.user(`smoke-other-${run}`));
  admin = base.as(mockUsers.admin(`smoke-admin-${run}`));
});

afterAll(async () => {
  for (const t of [admin, other, user]) await t.dispose();
  await base.dispose();
});

it("the app is healthy", async () => {
  expect((await base.request("/api/__framework/health")).status).toBe(204);
});

it("DEMO-REQ-006: anyone can read the configured site settings", async () => {
  const res = await base.request("/api/site");
  expect(res.status).toBe(200);
  const site: Site = await res.json();
  expect(site.title.length).toBeGreaterThan(0);
  expect(site.maxPhotosPerPost).toBeGreaterThan(0);
  expect(site.shareLinkDays).toBeGreaterThan(0);
});

it("DEMO-REQ-001/002/008: drafts are private until an admin publishes; a <script> title stays text", async () => {
  const title = `<script>alert("${run}")</script>`;
  const id = await createDraft(user, title);
  const drafts: DraftList = await (await user.request("/api/drafts")).json();
  expect(drafts.posts.map((p) => p.id)).toEqual([id]);
  expect((await base.request(`/api/posts/${id}`)).status).toBe(404);
  expect((await other.request(`/api/posts/${id}`)).status).toBe(404);
  expect((await user.request(`/api/posts/${id}/publish`, json("POST"))).status).toBe(403);
  expect((await base.request("/api/posts", json("POST", { title: "anon", body: "" }))).status).toBe(401);

  expect((await admin.request(`/api/posts/${id}/publish`, json("POST"))).status).toBe(200);
  const post: PostDetail<WireTicket> = await (await base.request(`/api/posts/${id}`)).json();
  expect(post.title).toBe(title);
  const page: PostPage = await (await base.request("/api/posts?pageSize=50")).json();
  expect(page.posts.every((p) => p.status === "published")).toBe(true);
  expect(page.posts.map((p) => p.id)).toContain(id);
  const created = page.posts.map((p) => p.createdAt);
  expect([...created].sort((a, b) => b - a)).toEqual(created);

  expect((await user.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(403);
  expect((await admin.request(`/api/posts/${id}/unpublish`, json("POST"))).status).toBe(200);
  expect((await base.request(`/api/posts/${id}`)).status).toBe(404);
  expect((await admin.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
  expect((await user.request(`/api/posts/${id}`)).status).toBe(404);
});

it("DEMO-REQ-003: a 20 MB JPEG round-trips byte-identical, the maximum holds, and deletion removes it", async () => {
  const site: Site = await (await base.request("/api/site")).json();
  const id = await createDraft(user, `photos ${run}`);
  const big = jpegBytes(20 * 1024 * 1024);
  const res = await addPhoto(user, id, big);
  expect(res.status).toBe(201);
  const photo: Photo<WireTicket> = await res.json();
  expect(photo.size).toBe(big.length);
  for (let i = 1; i < site.maxPhotosPerPost; i += 1) expect((await addPhoto(user, id, jpegBytes(100))).status).toBe(201);
  const over = await user.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/jpeg" }));
  expect(over.status).toBe(409);

  const post: PostDetail<WireTicket> = await (await user.request(`/api/posts/${id}`)).json();
  expect(post.photos).toHaveLength(site.maxPhotosPerPost);
  const shown = post.photos.find((p) => p.id === photo.id);
  if (shown === undefined) throw new Error("photo not shown");
  const download = await sendTicket(user, shown.ticket);
  expect(download.status).toBe(200);
  expect(sameBytes(new Uint8Array(await download.arrayBuffer()), big)).toBe(true);

  expect((await user.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
  expect((await user.request(`/api/posts/${id}`)).status).toBe(404);
  expect((await sendTicket(user, shown.ticket)).status).toBeGreaterThanOrEqual(400);
});

it("DEMO-REQ-004: an admin's banner is shown to everyone; a user cannot set it", async () => {
  const banner = `smoke banner ${run}`;
  expect((await user.request("/api/banner", json("PUT", { banner }))).status).toBe(403);
  expect((await admin.request("/api/banner", json("PUT", { banner }))).status).toBe(200);
  const site: Site = await (await base.request("/api/site")).json();
  expect(site.banner).toBe(banner);
  expect((await admin.request("/api/banner", json("PUT", { banner: null }))).status).toBe(200);
});

it("DEMO-REQ-005: the posts-per-page choice survives logout and login", async () => {
  expect((await user.request("/api/preferences", json("PUT", { pageSize: 3 }))).status).toBe(200);
  const again = base.as(mockUsers.user(userId));
  try {
    const prefs: Preferences = await (await again.request("/api/preferences")).json();
    expect(prefs.pageSize).toBe(3);
    const page: PostPage = await (await again.request("/api/posts")).json();
    expect(page.pageSize).toBe(3);
  } finally {
    if (inject("prototypeFrameworkSmoke") === true) await again.dispose();
  }
});

it("DEMO-REQ-007: a share link shows the draft to anyone; an altered link is refused", async () => {
  const id = await createDraft(user, `shared ${run}`);
  const res = await user.request(`/api/posts/${id}/share`, json("POST"));
  expect(res.status).toBe(201);
  const link: ShareLink = await res.json();
  const shared = await base.request(`/api/shared/${link.token}`);
  expect(shared.status).toBe(200);
  const post: PostDetail<WireTicket> = await shared.json();
  expect(post.id).toBe(id);
  const [subject = "", expires = "", signature = ""] = link.token.split(".");
  const altered = `${subject}.${String(Number(expires) + 1)}.${signature}`;
  expect((await base.request(`/api/shared/${altered}`)).status).toBe(404);
  expect((await user.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
});

it("DEMO-REQ-009: /api/auth/me reports the user ID the account page shows", async () => {
  const me: { level: string; id: string } = await (await user.request("/api/auth/me")).json();
  expect(me).toMatchObject({ level: "user", id: userId });
});
