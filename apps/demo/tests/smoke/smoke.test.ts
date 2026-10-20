import { connectTestStage, createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import app from "../../src/app";
import type { PostDetail, PostPage, PostSummary, Preferences, ShareLink, SiteInfo, StoredPhoto } from "../../src/shared/types";
import { SHARE_KEY, attachPhoto, createDraft, jpegBytes, json, sendTicket, sha256, type WireTicket } from "../support";

declare module "vitest" {
  interface ProvidedContext {
    /** Set by the `smoke` command: run against the stage it targets instead of in-process. */
    prototypeFrameworkSmoke: boolean;
  }
}

// One file, two ways: in-process during `verify`, against the dev server or a test stage under `smoke`.
// Stage data is kept between runs, so every run uses fresh mock users and asserts only on its own posts.
let base: TestApp;
let anon: TestApp;
let user: TestApp;
let other: TestApp;
let admin: TestApp;
const sessions: TestApp[] = [];
const run = crypto.randomUUID();
const userId = `smoke-${run}`;

beforeAll(async () => {
  base = inject("prototypeFrameworkSmoke") === true ? await connectTestStage() : await createTestApp(app, { secrets: { shareKey: SHARE_KEY } });
  anon = base.as(mockUsers.anonymous);
  user = base.as(mockUsers.user(userId));
  other = base.as(mockUsers.user(`smoke-other-${run}`));
  admin = base.as(mockUsers.admin(`smoke-admin-${run}`));
});

afterAll(async () => {
  for (const t of [...sessions, other, admin, user, anon]) await t.dispose();
  await base.dispose();
});

async function publish(id: string): Promise<void> {
  expect((await admin.request(`/api/posts/${id}/publish`, json("POST"))).status).toBe(200);
}

it("the app is healthy and serves its configured site settings (DEMO-REQ-006)", async () => {
  expect((await base.request("/api/__framework/health")).status).toBe(204);
  const site: SiteInfo = await (await anon.request("/api/site")).json();
  expect(typeof site.title).toBe("string");
  expect(site.maxPhotosPerPost).toBeGreaterThanOrEqual(1);
});

it("anonymous visitors see published posts newest first, with a <script> title as text (DEMO-AC-001)", async () => {
  const older = await createDraft(user, `smoke older ${run}`);
  const title = `<script>smoke ${run}</script>`;
  const newer = await createDraft(user, title);
  const draft = await createDraft(user, `smoke draft ${run}`);
  await publish(older);
  await publish(newer);
  const page: PostPage = await (await anon.request("/api/posts?perPage=50")).json();
  const ids = page.posts.map((p) => p.id);
  expect(ids).toContain(newer);
  expect(ids).not.toContain(draft);
  expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
  expect(page.posts.every((p) => p.status === "published")).toBe(true);
  const one: PostPage = await (await anon.request("/api/posts?perPage=1")).json();
  expect(one.posts).toHaveLength(1);
  expect(one.hasMore).toBe(true);
  const detail: PostDetail<WireTicket> = await (await anon.request(`/api/posts/${newer}`)).json();
  expect(detail.post.title).toBe(title);
  expect((await anon.request(`/api/posts/${draft}`)).status).toBe(404);
});

it("each permission is granted or refused by level (DEMO-AC-002)", async () => {
  const mine = await createDraft(user, `smoke perms ${run}`);
  // Anonymous: no drafts, no writes.
  expect((await anon.request("/api/posts", json("POST", { title: "x", body: "" }))).status).toBe(401);
  expect((await anon.request("/api/posts/mine")).status).toBe(401);
  // User: own drafts only.
  expect((await user.request(`/api/posts/${mine}`, json("PUT", { title: `smoke edited ${run}`, body: "" }))).status).toBe(200);
  const list: { posts: readonly PostSummary[] } = await (await user.request("/api/posts/mine")).json();
  expect(list.posts.map((p) => p.id)).toContain(mine);
  expect((await other.request(`/api/posts/${mine}`)).status).toBe(404);
  expect((await other.request(`/api/posts/${mine}`, json("DELETE"))).status).toBe(404);
  expect((await user.request(`/api/posts/${mine}/publish`, json("POST"))).status).toBe(403);
  expect((await user.request("/api/banner", json("PUT", { banner: "x" }))).status).toBe(403);
  // Admin: publish, unpublish and delete any post.
  await publish(mine);
  expect((await user.request(`/api/posts/${mine}`, json("DELETE"))).status).toBe(403);
  expect((await admin.request(`/api/posts/${mine}/unpublish`, json("POST"))).status).toBe(200);
  expect((await anon.request(`/api/posts/${mine}`)).status).toBe(404);
  expect((await admin.request(`/api/posts/${mine}`, json("DELETE"))).status).toBe(204);
  const gone = await createDraft(user, `smoke own delete ${run}`);
  expect((await user.request(`/api/posts/${gone}`, json("DELETE"))).status).toBe(204);
  expect((await user.request(`/api/posts/${gone}`)).status).toBe(404);
});

it("a 20 MB JPEG uploads, displays and downloads byte-identical; the maximum holds; delete removes it (DEMO-AC-003)", async () => {
  const site: SiteInfo = await (await anon.request("/api/site")).json();
  const post = await createDraft(user, `smoke photos ${run}`);
  const big = jpegBytes(20 * 1024 * 1024);
  const res = await attachPhoto(user, post, big);
  expect(res.status).toBe(201);
  const stored: StoredPhoto = await res.json();
  expect(stored.size).toBe(big.byteLength);

  const detail: PostDetail<WireTicket> = await (await user.request(`/api/posts/${post}`)).json();
  const photo = detail.photos.find((p) => p.id === stored.id);
  if (photo === undefined) throw new Error("photo missing from the post");
  const download = await sendTicket(user, photo.ticket);
  expect(download.status).toBe(200);
  expect(await sha256(await download.arrayBuffer())).toBe(await sha256(big));

  for (let i = 1; i < site.maxPhotosPerPost; i += 1) expect((await attachPhoto(user, post, jpegBytes(64))).status).toBe(201);
  const over = await user.request(`/api/posts/${post}/photos/upload-ticket`, json("POST", { contentType: "image/png" }));
  expect(over.status).toBe(409);

  expect((await user.request(`/api/posts/${post}`, json("DELETE"))).status).toBe(204);
  expect((await user.request(`/api/posts/${post}`)).status).toBe(404);
  expect((await sendTicket(user, photo.ticket)).status).toBeGreaterThanOrEqual(400);
});

it("an admin's banner is shown to anonymous visitors (DEMO-AC-004)", async () => {
  const before: SiteInfo = await (await anon.request("/api/site")).json();
  const banner = `smoke banner ${run}`;
  expect((await admin.request("/api/banner", json("PUT", { banner }))).status).toBe(200);
  const site: SiteInfo = await (await anon.request("/api/site")).json();
  expect(site.banner).toBe(banner);
  expect((await admin.request("/api/banner", json("PUT", { banner: before.banner ?? "" }))).status).toBe(200);
});

it("the posts-per-page choice survives logout and login (DEMO-AC-005)", async () => {
  expect((await user.request("/api/preferences", json("PUT", { perPage: 7 }))).status).toBe(200);
  // A new session for the same user; it is disposed (logged out) with the others in afterAll.
  const session = base.as(mockUsers.user(userId));
  sessions.push(session);
  const prefs: Preferences = await (await session.request("/api/preferences")).json();
  expect(prefs).toEqual({ perPage: 7 });
  const page: PostPage = await (await session.request("/api/posts")).json();
  expect(page.perPage).toBe(7);
});

it("a share link shows the draft to anyone; an altered link is refused (DEMO-AC-007)", async () => {
  const draft = await createDraft(user, `smoke shared ${run}`);
  const made = await user.request(`/api/posts/${draft}/share`, json("POST"));
  expect(made.status).toBe(201);
  const link: ShareLink = await made.json();
  const shared = await anon.request(`/api/shared/${link.token}`);
  expect(shared.status).toBe(200);
  const detail: PostDetail<WireTicket> = await shared.json();
  expect(detail.post.id).toBe(draft);
  const [subject = "", expires = "", signature = ""] = link.token.split(".");
  expect((await anon.request(`/api/shared/${subject}.${String(Number(expires) + 1000)}.${signature}`)).status).toBe(404);
  expect((await anon.request(`/api/shared/${crypto.randomUUID()}.${expires}.${signature}`)).status).toBe(404);
});

it("the account's ID is the one /api/auth/me reports (DEMO-AC-009)", async () => {
  const me: { level: string; id?: string } = await (await user.request("/api/auth/me")).json();
  expect(me).toMatchObject({ level: "user", id: userId });
});
