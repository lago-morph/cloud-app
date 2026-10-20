import { createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import type { Banner, DraftList, PostDetail, PostPage, Preferences, ShareLink, Site } from "../src/shared/types";
import { addPhoto, createDraft, downloadPhoto, downloadTicket, jpegBytes, json, sameBytes, uploadPhoto, type WireTicket } from "./support";

const SHARE_KEY = "test-share-key-that-is-at-least-32-bytes-long";

let opened: TestApp[] = [];
async function open(options: Parameters<typeof createTestApp>[1] = {}): Promise<TestApp> {
  const t = await createTestApp(app, { secrets: { shareKey: SHARE_KEY }, ...options });
  opened.push(t);
  return t;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(opened.map((t) => t.dispose()));
  opened = [];
});

async function code(res: Response): Promise<string> {
  const body: { error: { code: string } } = await res.json();
  return body.error.code;
}

async function publish(admin: TestApp, id: string): Promise<void> {
  expect((await admin.request(`/api/posts/${id}/publish`, json("POST"))).status).toBe(200);
}

describe("configuration (DEMO-REQ-006, DEMO-AC-006)", () => {
  it("serves the default site settings", async () => {
    const t = await open();
    const site: Site = await (await t.request("/api/site")).json();
    expect(site).toEqual({ title: "Photo board", banner: null, maxPhotosPerPost: 5, shareLinkDays: 7 });
  });

  it("serves the title, photo maximum and link lifetime configured for the stage", async () => {
    const t = await open({ config: { siteTitle: "Holiday photos", maxPhotosPerPost: 3, shareLinkDays: 2 } });
    const site: Site = await (await t.request("/api/site")).json();
    expect(site).toEqual({ title: "Holiday photos", banner: null, maxPhotosPerPost: 3, shareLinkDays: 2 });
  });
});

describe("posts (DEMO-REQ-001, DEMO-AC-001)", () => {
  it("shows anonymous visitors only published posts, newest first, a page at a time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin("root"));
    const ids: string[] = [];
    for (const title of ["one", "two", "three", "four"]) {
      ids.push(await createDraft(alice, title));
      vi.advanceTimersByTime(1000);
    }
    await createDraft(alice, "still a draft");
    for (const id of ids) await publish(admin, id);

    const first: PostPage = await (await t.request("/api/posts?perPage=3")).json();
    expect(first.posts.map((p) => p.title)).toEqual(["four", "three", "two"]);
    expect(first).toMatchObject({ page: 1, perPage: 3, hasMore: true });
    const second: PostPage = await (await t.request("/api/posts?perPage=3&page=2")).json();
    expect(second.posts.map((p) => p.title)).toEqual(["one"]);
    expect(second.hasMore).toBe(false);
    expect(second.posts.every((p) => p.status === "published")).toBe(true);

    const bad = await t.request("/api/posts?perPage=0");
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe("HTTP.INVALID_INPUT");
  });

  it("keeps a title containing <script> as plain text", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const title = "<script>alert('x')</script> & <b>bold</b>";
    const id = await createDraft(alice, title, "<img src=x onerror=alert(1)>");
    await publish(t.as(mockUsers.admin()), id);
    const post: PostDetail = await (await t.request(`/api/posts/${id}`)).json();
    expect(post.title).toBe(title);
    expect(post.body).toBe("<img src=x onerror=alert(1)>");
  });

  it("validates titles: 1 to 120 characters", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    for (const title of ["", "   ", "x".repeat(121)]) {
      const res = await t.request("/api/posts", json("POST", { title, body: "" }));
      expect(res.status).toBe(400);
      expect(await code(res)).toBe("HTTP.INVALID_INPUT");
    }
    expect((await t.request("/api/posts", json("POST", { title: "x".repeat(120), body: "" }))).status).toBe(201);
  });

  it("answers 404 for an unknown post", async () => {
    const t = await open();
    const res = await t.request("/api/posts/no-such-post");
    expect(res.status).toBe(404);
    expect(await code(res)).toBe("HTTP.NOT_FOUND");
  });
});

describe("who may do what (DEMO-REQ-002, DEMO-AC-002)", () => {
  it("lets everyone view published posts", async () => {
    const t = await open();
    const id = await createDraft(t.as(mockUsers.user("alice")), "public");
    await publish(t.as(mockUsers.admin()), id);
    for (const who of [t, t.as(mockUsers.user("bob")), t.as(mockUsers.admin())]) {
      expect((await who.request(`/api/posts/${id}`)).status).toBe(200);
      const page: PostPage = await (await who.request("/api/posts")).json();
      expect(page.posts.map((p) => p.id)).toEqual([id]);
    }
  });

  it("lets users and admins create drafts, but not anonymous visitors", async () => {
    const t = await open();
    const anon = await t.request("/api/posts", json("POST", { title: "x", body: "" }));
    expect(anon.status).toBe(401);
    expect(await code(anon)).toBe("AUTH.UNAUTHENTICATED");
    await createDraft(t.as(mockUsers.user("alice")), "by a user");
    await createDraft(t.as(mockUsers.admin("root")), "by an admin");
  });

  it("lets only the author view, edit and delete a draft", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const bob = t.as(mockUsers.user("bob"));
    const admin = t.as(mockUsers.admin("root"));
    const id = await createDraft(alice, "draft");

    const own: PostDetail = await (await alice.request(`/api/posts/${id}`)).json();
    expect(own).toMatchObject({ status: "draft", canEdit: true, canDelete: true, canModerate: false });
    const drafts: DraftList = await (await alice.request("/api/my/drafts")).json();
    expect(drafts.posts.map((p) => p.id)).toEqual([id]);
    const bobsDrafts: DraftList = await (await bob.request("/api/my/drafts")).json();
    expect(bobsDrafts.posts).toEqual([]);
    expect((await t.request("/api/my/drafts")).status).toBe(401);

    for (const other of [t, bob]) {
      expect((await other.request(`/api/posts/${id}`)).status).toBe(404);
    }
    expect((await t.request(`/api/posts/${id}`, json("PATCH", { title: "anon" }))).status).toBe(401);
    expect((await bob.request(`/api/posts/${id}`, json("PATCH", { title: "bob" }))).status).toBe(404);
    expect((await bob.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(404);
    expect((await t.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(401);
    const adminEdit = await admin.request(`/api/posts/${id}`, json("PATCH", { title: "admin" }));
    expect(adminEdit.status).toBe(403);
    expect(await code(adminEdit)).toBe("AUTH.FORBIDDEN");

    const edited = await alice.request(`/api/posts/${id}`, json("PATCH", { title: "edited", body: "new body" }));
    expect(edited.status).toBe(200);
    const after: PostDetail = await edited.json();
    expect(after).toMatchObject({ title: "edited", body: "new body" });

    expect((await alice.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
    expect((await alice.request(`/api/posts/${id}`)).status).toBe(404);
  });

  it("lets only admins publish, unpublish and delete any post", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin("root"));
    const id = await createDraft(alice, "post");

    for (const action of ["publish", "unpublish"]) {
      expect((await t.request(`/api/posts/${id}/${action}`, json("POST"))).status).toBe(401);
      const res = await alice.request(`/api/posts/${id}/${action}`, json("POST"));
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("AUTH.FORBIDDEN");
    }

    await publish(admin, id);
    const again = await admin.request(`/api/posts/${id}/publish`, json("POST"));
    expect(again.status).toBe(409);
    expect(await code(again)).toBe("HTTP.CONFLICT");

    // The author may no longer edit or delete the published post.
    expect((await alice.request(`/api/posts/${id}`, json("PATCH", { title: "x" }))).status).toBe(403);
    const authorDelete = await alice.request(`/api/posts/${id}`, json("DELETE"));
    expect(authorDelete.status).toBe(403);
    expect(await code(authorDelete)).toBe("AUTH.FORBIDDEN");

    const unpublished = await admin.request(`/api/posts/${id}/unpublish`, json("POST"));
    expect(unpublished.status).toBe(200);
    const body: PostDetail = await unpublished.json();
    expect(body.status).toBe("draft");
    expect((await t.request(`/api/posts/${id}`)).status).toBe(404);

    await publish(admin, id);
    expect((await admin.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
    expect((await t.request(`/api/posts/${id}`)).status).toBe(404);
    expect((await admin.request("/api/posts/missing/publish", json("POST"))).status).toBe(404);
  });

  it("lets admins delete another user's draft", async () => {
    const t = await open();
    const id = await createDraft(t.as(mockUsers.user("alice")), "draft");
    const admin = t.as(mockUsers.admin("root"));
    const seen: PostDetail = await (await admin.request(`/api/posts/${id}`)).json();
    expect(seen).toMatchObject({ canEdit: false, canDelete: true, canModerate: true });
    expect((await admin.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
  });

  it("lets only admins set the banner", async () => {
    const t = await open();
    const anon = await t.request("/api/banner", json("PUT", { banner: "hi" }));
    expect(anon.status).toBe(401);
    const user = await t.as(mockUsers.user("alice")).request("/api/banner", json("PUT", { banner: "hi" }));
    expect(user.status).toBe(403);
    expect(await code(user)).toBe("AUTH.FORBIDDEN");
    expect((await t.as(mockUsers.admin()).request("/api/banner", json("PUT", { banner: "hi" }))).status).toBe(200);
  });
});

describe("photos (DEMO-REQ-003, DEMO-AC-003)", () => {
  it("uploads a 20 MB JPEG that downloads byte-identical", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "with photo");
    const bytes = jpegBytes(20 * 1024 * 1024);
    const photo = await addPhoto(alice, id, bytes);
    expect(photo).toMatchObject({ size: bytes.length, contentType: "image/jpeg" });

    const post: PostDetail = await (await alice.request(`/api/posts/${id}`)).json();
    expect(post.photos).toEqual([photo]);
    expect(sameBytes(await downloadPhoto(alice, photo.id), bytes)).toBe(true);
  });

  it("accepts PNG, refuses other types, and checks the stored type at finalize", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    const id = await createDraft(t, "types");
    await addPhoto(t, id, jpegBytes(64), "image/png");
    const gif = await t.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/gif" }));
    expect(gif.status).toBe(400);
    expect(await code(gif)).toBe("HTTP.INVALID_INPUT");
    const missing = await t.request(`/api/posts/${id}/photos/finalize`, json("POST", { id: crypto.randomUUID(), name: "a.jpg" }));
    expect(missing.status).toBe(404);
    const slash = await t.request(`/api/posts/${id}/photos/finalize`, json("POST", { id: crypto.randomUUID(), name: "../a.jpg" }));
    expect(slash.status).toBe(400);
  });

  it("enforces the configured maximum per post", async () => {
    const t = await open({ user: mockUsers.user("alice"), config: { maxPhotosPerPost: 2 } });
    const id = await createDraft(t, "max");
    const pending = await uploadPhoto(t, id, "image/jpeg", jpegBytes(16));
    await addPhoto(t, id, jpegBytes(16));
    await addPhoto(t, id, jpegBytes(16));
    const ticket = await t.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/jpeg" }));
    expect(ticket.status).toBe(409);
    expect(await code(ticket)).toBe("HTTP.CONFLICT");
    // An upload begun before the maximum was reached is refused at finalize, and its file removed.
    const late = await t.request(`/api/posts/${id}/photos/finalize`, json("POST", { id: pending, name: "late.jpg" }));
    expect(late.status).toBe(409);
    expect((await t.request(`/api/posts/${id}/photos/finalize`, json("POST", { id: pending, name: "late.jpg" }))).status).toBe(404);
    const post: PostDetail = await (await t.request(`/api/posts/${id}`)).json();
    expect(post.photos).toHaveLength(2);
  });

  it("lets only the author of a draft add photos", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "mine");
    const ticket = json("POST", { contentType: "image/jpeg" });
    expect((await t.request(`/api/posts/${id}/photos/upload-ticket`, ticket)).status).toBe(401);
    expect((await t.as(mockUsers.user("bob")).request(`/api/posts/${id}/photos/upload-ticket`, ticket)).status).toBe(404);
    expect((await t.as(mockUsers.admin()).request(`/api/posts/${id}/photos/upload-ticket`, ticket)).status).toBe(403);
  });

  it("shows photos of published posts to anyone, and of drafts only to those who may see the draft", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "photos");
    const photo = await addPhoto(alice, id, jpegBytes(32));
    expect((await downloadTicket(t, photo.id)).status).toBe(404);
    expect((await downloadTicket(t.as(mockUsers.user("bob")), photo.id)).status).toBe(404);
    expect((await downloadTicket(t.as(mockUsers.admin()), photo.id)).status).toBe(200);
    await publish(t.as(mockUsers.admin()), id);
    expect((await downloadTicket(t, photo.id)).status).toBe(200);
    expect((await downloadTicket(t, "no-such-photo")).status).toBe(404);
  });

  it("deletes the photo records and then the photo files with the post", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "to delete");
    const photo = await addPhoto(alice, id, jpegBytes(1024));
    await uploadPhoto(alice, id, "image/png", jpegBytes(8)); // never finalized: removed with the post too
    const res = await downloadTicket(alice, photo.id);
    const { ticket }: { ticket: WireTicket } = await res.json();

    expect((await alice.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
    expect((await alice.request(`/api/posts/${id}`)).status).toBe(404);
    expect((await downloadTicket(alice, photo.id)).status).toBe(404);
    // The ticket issued before the deletion no longer finds the file.
    const stale = await alice.request(ticket.url, { method: ticket.method ?? "GET", headers: ticket.headers ?? {} });
    expect(stale.status).toBe(404);
    expect(t.logs().filter((e) => e.severity === "warn")).toEqual([]);
  });

  it("logs a failed photo cleanup at warn and still deletes the post", async () => {
    const t = await open({ unavailable: ["files"] });
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "cleanup fails");
    expect((await alice.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
    expect((await alice.request(`/api/posts/${id}`)).status).toBe(404);
    const warnings = t.logs().filter((e) => e.component === "photos" && e.severity === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain(id);
  });
});

describe("site banner (DEMO-REQ-004, DEMO-AC-004)", () => {
  it("shows a banner set by an admin to anonymous visitors, and clears it", async () => {
    const t = await open();
    const admin = t.as(mockUsers.admin());
    const set: Banner = await (await admin.request("/api/banner", json("PUT", { banner: "  Maintenance tonight  " }))).json();
    expect(set).toEqual({ banner: "Maintenance tonight" });
    const site: Site = await (await t.request("/api/site")).json();
    expect(site.banner).toBe("Maintenance tonight");

    expect((await admin.request("/api/banner", json("PUT", { banner: null }))).status).toBe(200);
    const cleared: Site = await (await t.request("/api/site")).json();
    expect(cleared.banner).toBeNull();
    expect((await admin.request("/api/banner", json("PUT", { banner: "x".repeat(501) }))).status).toBe(400);
  });
});

describe("posts-per-page preference (DEMO-REQ-005, DEMO-AC-005)", () => {
  it("persists per user and applies to the post list", async () => {
    const t = await open();
    const admin = t.as(mockUsers.admin());
    for (const title of ["a", "b", "c"]) await publish(admin, await createDraft(admin, title));

    const alice = t.as(mockUsers.user("alice"));
    const initial: Preferences = await (await alice.request("/api/preferences")).json();
    expect(initial).toEqual({ perPage: 10 });
    expect((await alice.request("/api/preferences", json("PUT", { perPage: 2 }))).status).toBe(200);

    // A new session of the same login reads the same choice.
    const again = t.as(mockUsers.user("alice"));
    const after: Preferences = await (await again.request("/api/preferences")).json();
    expect(after).toEqual({ perPage: 2 });
    const page: PostPage = await (await again.request("/api/posts")).json();
    expect(page.perPage).toBe(2);
    expect(page.posts).toHaveLength(2);

    const bob: Preferences = await (await t.as(mockUsers.user("bob")).request("/api/preferences")).json();
    expect(bob).toEqual({ perPage: 10 });
    const anon: PostPage = await (await t.request("/api/posts")).json();
    expect(anon.perPage).toBe(10);
    expect((await t.request("/api/preferences")).status).toBe(401);
    expect((await alice.request("/api/preferences", json("PUT", { perPage: 51 }))).status).toBe(400);
  });
});

describe("share links (DEMO-REQ-007, DEMO-AC-007)", () => {
  it("shows the draft and its photos to anyone holding the link; an altered link is refused", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "shared draft");
    const photo = await addPhoto(alice, id, jpegBytes(256));
    const res = await alice.request(`/api/posts/${id}/share`, json("POST"));
    expect(res.status).toBe(201);
    const link: ShareLink = await res.json();

    const viewed = await t.request(`/api/shared/${encodeURIComponent(link.token)}`);
    expect(viewed.status).toBe(200);
    const post: PostDetail = await viewed.json();
    expect(post).toMatchObject({ id, title: "shared draft", status: "draft", canEdit: false });
    expect(sameBytes(await downloadPhoto(t, photo.id, link.token), jpegBytes(256))).toBe(true);
    expect((await t.request(`/api/posts/${id}`)).status).toBe(404);

    const [subject = "", expiresAt = "", signature = ""] = link.token.split(".");
    const flipped = (signature.startsWith("A") ? "B" : "A") + signature.slice(1);
    const other = await createDraft(alice, "other draft");
    for (const altered of [`${subject}.${expiresAt}.${flipped}`, `${other}.${expiresAt}.${signature}`, `${subject}.${String(Number(expiresAt) + 1)}.${signature}`, "garbage"]) {
      const refused = await t.request(`/api/shared/${encodeURIComponent(altered)}`);
      expect(refused.status).toBe(404);
      expect(await code(refused)).toBe("HTTP.NOT_FOUND");
      expect((await downloadTicket(t, photo.id, altered)).status).toBe(404);
    }
  });

  it("refuses a link once it has expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    const t = await open({ config: { shareLinkDays: 2 } });
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "expiring");
    const link: ShareLink = await (await alice.request(`/api/posts/${id}/share`, json("POST"))).json();
    expect(link.expiresAt).toBe(Date.now() + 2 * 24 * 60 * 60 * 1000);
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000 - 1);
    expect((await t.request(`/api/shared/${encodeURIComponent(link.token)}`)).status).toBe(200);
    vi.advanceTimersByTime(1);
    expect((await t.request(`/api/shared/${encodeURIComponent(link.token)}`)).status).toBe(404);
  });

  it("lets only the author create a link, and only for a draft", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "draft");
    expect((await t.request(`/api/posts/${id}/share`, json("POST"))).status).toBe(401);
    expect((await t.as(mockUsers.user("bob")).request(`/api/posts/${id}/share`, json("POST"))).status).toBe(404);
    expect((await t.as(mockUsers.admin()).request(`/api/posts/${id}/share`, json("POST"))).status).toBe(403);
    await publish(t.as(mockUsers.admin()), id);
    expect((await alice.request(`/api/posts/${id}/share`, json("POST"))).status).toBe(403);
  });

  it("never returns the signing key", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "draft");
    const text = await (await alice.request(`/api/posts/${id}/share`, json("POST"))).text();
    expect(text).not.toContain(SHARE_KEY);
  });

  it("reports a missing signing key as SEC.MISSING", async () => {
    const t = await createTestApp(app, { user: mockUsers.user("alice") });
    opened.push(t);
    const id = await createDraft(t, "draft");
    const res = await t.request(`/api/posts/${id}/share`, json("POST"));
    expect(res.status).toBe(500);
    expect(await code(res)).toBe("SEC.MISSING");
  });
});

describe("log (DEMO-REQ-008, DEMO-AC-008)", () => {
  it("logs publish, unpublish and delete at info", async () => {
    const t = await open();
    const admin = t.as(mockUsers.admin("root"));
    const id = await createDraft(t.as(mockUsers.user("alice")), "logged");
    await publish(admin, id);
    expect((await admin.request(`/api/posts/${id}/unpublish`, json("POST"))).status).toBe(200);
    expect((await admin.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
    const info = t.logs().filter((e) => e.component === "posts" && e.severity === "info");
    expect(info.map((e) => e.message)).toEqual([
      `post ${id} published by root`,
      `post ${id} unpublished by root`,
      `post ${id} deleted by root`,
    ]);
  });
});

describe("account (DEMO-REQ-009, DEMO-AC-009)", () => {
  it("reports the logged-in user's ID", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    const me: { level: string; id: string } = await (await t.request("/api/auth/me")).json();
    expect(me).toMatchObject({ level: "user", id: "alice" });
  });
});
