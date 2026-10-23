import { connectTestStage, createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import app from "../../src/app";
import type { Banner, Created, DraftList, PhotoUpload, Post, PostPage, PostSummary, Preferences, ShareLink, Site, StoredPhoto } from "../../src/shared/types";

declare module "vitest" {
  interface ProvidedContext {
    /** Set by the `smoke` command: run against the stage it targets instead of in-process. */
    prototypeFrameworkSmoke: boolean;
  }
}

/** A ticket's wire form: the same JSON on every target; only `url` differs (files.md "Testing"). */
interface WireTicket {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** A path on the app goes through the test app; an absolute storage URL through plain fetch, with no cookie. */
function sendTicket(t: TestApp, ticket: WireTicket, body?: Uint8Array<ArrayBuffer>): Promise<Response> {
  const init: RequestInit = { method: ticket.method ?? "GET" };
  if (ticket.headers !== undefined) init.headers = ticket.headers;
  if (body !== undefined) init.body = body;
  return /^\/(?![/\\])/.test(ticket.url) ? t.request(ticket.url, init) : fetch(ticket.url, init);
}

async function code(res: Response): Promise<string> {
  const body: { error: { code: string } } = await res.json();
  return body.error.code;
}

// One file, two ways: in-process during `verify`, against the dev server or a test stage under `smoke`.
const run = crypto.randomUUID();
const userId = `smoke-${run}`;
let base: TestApp;
let user: TestApp;
let other: TestApp;
let admin: TestApp;

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

async function createDraft(title: string): Promise<string> {
  const res = await user.request("/api/posts", json("POST", { title, body: `smoke run ${run}` }));
  expect(res.status).toBe(201);
  const body: Created = await res.json();
  return body.id;
}

async function uploadPhoto(postId: string, contentType: string, bytes: Uint8Array<ArrayBuffer>, name: string): Promise<Response> {
  const res = await user.request(`/api/posts/${postId}/photos/upload-ticket`, json("POST", { contentType }));
  expect(res.status).toBe(200);
  const { photoId, ticket }: PhotoUpload<WireTicket> = await res.json();
  const put = await sendTicket(user, ticket, bytes);
  expect(put.status).toBeLessThan(300);
  return user.request(`/api/posts/${postId}/photos/finalize`, json("POST", { photoId, name }));
}

it("the app is healthy and serves its configuration (DEMO-REQ-006)", async () => {
  expect((await base.request("/api/__framework/health")).status).toBe(204);
  const res = await base.request("/api/site");
  expect(res.status).toBe(200);
  const site: Site = await res.json();
  expect(typeof site.title).toBe("string");
  expect(site.maxPhotosPerPost).toBeGreaterThan(0);
});

it("the account's ID is the one /api/auth/me reports (DEMO-REQ-009)", async () => {
  const me: { level: string; id: string } = await (await user.request("/api/auth/me")).json();
  expect(me).toMatchObject({ level: "user", id: userId });
});

it("posts: drafts are private, only admins publish, anyone reads published posts newest first (DEMO-REQ-001, -002, -008)", async () => {
  const title = `<script>alert(1)</script> smoke ${run}`;
  const older = await createDraft(`older ${run}`);
  const id = await createDraft(title);

  // Drafts: visible to the author only; anonymous and other users get nothing.
  const drafts: DraftList = await (await user.request("/api/my/drafts")).json();
  expect(drafts.posts.map((p) => p.id)).toEqual(expect.arrayContaining([id, older]));
  expect(await code(await base.request(`/api/posts/${id}`))).toBe("HTTP.NOT_FOUND");
  expect(await code(await other.request(`/api/posts/${id}`, json("PATCH", { title: "taken" })))).toBe("HTTP.NOT_FOUND");
  expect(await code(await base.request("/api/posts", json("POST", { title: "anon", body: "" })))).toBe("AUTH.UNAUTHENTICATED");

  // The author edits an own draft; a user cannot publish.
  expect((await user.request(`/api/posts/${id}`, json("PATCH", { body: "edited" }))).status).toBe(200);
  expect(await code(await user.request(`/api/posts/${id}/publish`, { method: "POST" }))).toBe("AUTH.FORBIDDEN");

  for (const postId of [older, id]) {
    const res = await admin.request(`/api/posts/${postId}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    const body: PostSummary = await res.json();
    expect(body.status).toBe("published");
  }
  expect(await code(await user.request(`/api/posts/${id}`, { method: "DELETE" }))).toBe("AUTH.FORBIDDEN");

  const page: PostPage = await (await base.request("/api/posts?pageSize=2")).json();
  expect(page.posts.map((p) => p.id)).toEqual([id, older]);
  expect(page.posts[0]?.title).toBe(title);
  const post: Post<WireTicket> = await (await base.request(`/api/posts/${id}`)).json();
  expect(post).toMatchObject({ title, body: "edited", status: "published" });

  expect((await admin.request(`/api/posts/${id}/unpublish`, { method: "POST" })).status).toBe(200);
  expect(await code(await base.request(`/api/posts/${id}`))).toBe("HTTP.NOT_FOUND");
  for (const postId of [older, id]) {
    expect((await admin.request(`/api/posts/${postId}`, { method: "DELETE" })).status).toBe(204);
  }
});

it("photos: a 20 MB JPEG round-trips, the maximum holds, deleting removes rows and files (DEMO-REQ-003)", async () => {
  const site: Site = await (await base.request("/api/site")).json();
  const id = await createDraft(`photos ${run}`);
  const big = new Uint8Array(20 * 1024 * 1024);
  for (let i = 0; i < big.length; i += 1) big[i] = (i * 7 + (i >> 12)) & 0xff;
  big.set([0xff, 0xd8, 0xff, 0xe0], 0);
  const first = await uploadPhoto(id, "image/jpeg", big, "big.jpg");
  expect(first.status).toBe(201);
  const stored: StoredPhoto = await first.json();
  expect(stored.size).toBe(big.length);
  for (let n = 1; n < site.maxPhotosPerPost; n += 1) {
    expect((await uploadPhoto(id, "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]), `small-${n}.png`)).status).toBe(201);
  }
  const over = await user.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/png" }));
  expect(await code(over)).toBe("HTTP.CONFLICT");

  const post: Post<WireTicket> = await (await user.request(`/api/posts/${id}`)).json();
  expect(post.photos).toHaveLength(site.maxPhotosPerPost);
  const photo = post.photos.find((p) => p.id === stored.id);
  if (photo === undefined) throw new Error("the photo is missing from the post");
  const download = await sendTicket(user, photo.ticket);
  expect(download.status).toBe(200);
  const got = new Uint8Array(await download.arrayBuffer());
  expect(got.length).toBe(big.length);
  expect(got.every((b, i) => b === big[i])).toBe(true);

  expect((await user.request(`/api/posts/${id}`, { method: "DELETE" })).status).toBe(204);
  expect(await code(await user.request(`/api/posts/${id}`))).toBe("HTTP.NOT_FOUND");
  expect((await sendTicket(user, photo.ticket)).ok).toBe(false);
});

it("the banner set by an admin reaches anonymous visitors; users cannot set it (DEMO-REQ-004)", async () => {
  const message = `smoke banner ${run}`;
  expect(await code(await user.request("/api/banner", json("PUT", { message: "nope" })))).toBe("AUTH.FORBIDDEN");
  expect((await admin.request("/api/banner", json("PUT", { message }))).status).toBe(200);
  const site: Site = await (await base.request("/api/site")).json();
  expect(site.banner).toBe(message);
  expect((await admin.request("/api/banner", json("PUT", { message: null }))).status).toBe(200);
  const cleared: Banner = await (await base.request("/api/banner")).json();
  expect(cleared.message).toBeNull();
});

it("the posts-per-page choice survives a new login (DEMO-REQ-005)", async () => {
  expect((await user.request("/api/preferences", json("PUT", { pageSize: 7 }))).status).toBe(200);
  const again = base.as(mockUsers.user(userId));
  const prefs: Preferences = await (await again.request("/api/preferences")).json();
  expect(prefs.pageSize).toBe(7);
  const page: PostPage = await (await again.request("/api/posts")).json();
  expect(page.pageSize).toBe(7);
});

it("a share link shows a draft to an anonymous visitor; an altered link is refused (DEMO-REQ-007)", async () => {
  const id = await createDraft(`shared ${run}`);
  const res = await user.request(`/api/posts/${id}/share`, { method: "POST" });
  expect(res.status).toBe(201);
  const { token }: ShareLink = await res.json();
  const shown = await base.request(`/api/shared?token=${encodeURIComponent(token)}`);
  expect(shown.status).toBe(200);
  const post: Post<WireTicket> = await shown.json();
  expect(post).toMatchObject({ id, status: "draft" });
  const [, expires = "", signature = ""] = token.split(".");
  const altered = `${crypto.randomUUID()}.${expires}.${signature}`;
  expect(await code(await base.request(`/api/shared?token=${encodeURIComponent(altered)}`))).toBe("HTTP.NOT_FOUND");
  expect((await user.request(`/api/posts/${id}`, { method: "DELETE" })).status).toBe(204);
});
