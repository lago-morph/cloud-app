import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Banner, DraftList, PostPage, PostSummary, Preferences, ShareLink, Site } from "../src/shared/types";
import { addPhoto, createDraft, downloadPhoto, errorCode, json, jpegBytes, open, pngBytes, readPost, sameBytes, sendTicket, type StoredPhoto } from "./support";

afterEach(() => {
  vi.useRealTimers();
});

describe("configuration (DEMO-REQ-006, DEMO-AC-006)", () => {
  it("serves the defaults", async () => {
    const t = await open();
    const body: Site = await (await t.request("/api/site")).json();
    expect(body).toEqual({ title: "Photo board", maxPhotosPerPost: 5, banner: null });
  });

  it("serves the site title and photo limit configured for the stage", async () => {
    const t = await open({ config: { siteTitle: "Holiday photos", maxPhotosPerPost: 2 } });
    const body: Site = await (await t.request("/api/site")).json();
    expect(body).toMatchObject({ title: "Holiday photos", maxPhotosPerPost: 2 });
  });
});

describe("posts (DEMO-REQ-001, DEMO-AC-001)", () => {
  it("shows anonymous visitors only published posts, newest first, in pages", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin("boss"));
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const id = await createDraft(alice, `post ${n}`);
      expect((await admin.request(`/api/posts/${id}/publish`, { method: "POST" })).status).toBe(200);
      ids.push(id);
    }
    const draft = await createDraft(alice, "still a draft");

    const first: PostPage = await (await t.request("/api/posts?pageSize=2")).json();
    expect(first.posts.map((p) => p.title)).toEqual(["post 3", "post 2"]);
    expect(first).toMatchObject({ page: 1, pageSize: 2, hasMore: true });
    const second: PostPage = await (await t.request("/api/posts?pageSize=2&page=2")).json();
    expect(second.posts.map((p) => p.title)).toEqual(["post 1"]);
    expect(second.hasMore).toBe(false);
    expect(second.posts.every((p) => p.status === "published")).toBe(true);

    const opened = await readPost(t, ids[0] ?? "");
    expect(opened).toMatchObject({ title: "post 1", body: "text", authorId: "alice", status: "published", photos: [] });
    expect(await errorCode(await t.request(`/api/posts/${draft}`), 404)).toBe("HTTP.NOT_FOUND");
  });

  it("returns a title containing <script> unchanged, as text", async () => {
    const t = await open();
    const title = `<script>alert("x")</script>`;
    const id = await createDraft(t.as(mockUsers.user("alice")), title);
    await t.as(mockUsers.admin()).request(`/api/posts/${id}/publish`, { method: "POST" });
    const page: PostPage = await (await t.request("/api/posts")).json();
    expect(page.posts[0]?.title).toBe(title);
  });

  it("validates titles and page parameters", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    expect(await errorCode(await t.request("/api/posts", json("POST", { title: " ", body: "" })), 400)).toBe("HTTP.INVALID_INPUT");
    expect(await errorCode(await t.request("/api/posts", json("POST", { title: "x".repeat(121), body: "" })), 400)).toBe("HTTP.INVALID_INPUT");
    expect((await t.request("/api/posts", json("POST", { title: "x".repeat(120), body: "" }))).status).toBe(201);
    expect(await errorCode(await t.request("/api/posts?pageSize=0"), 400)).toBe("HTTP.INVALID_INPUT");
    expect(await errorCode(await t.request("/api/posts?page=x"), 400)).toBe("HTTP.INVALID_INPUT");
    expect(await errorCode(await t.request("/api/posts/not-a-uuid"), 404)).toBe("HTTP.NOT_FOUND");
    expect(await errorCode(await t.request(`/api/posts/${crypto.randomUUID()}`), 404)).toBe("HTTP.NOT_FOUND");
  });
});

describe("permissions (DEMO-REQ-002, DEMO-AC-002)", () => {
  it("refuses every write to anonymous visitors", async () => {
    const t = await open();
    const id = await createDraft(t.as(mockUsers.user("alice")), "a draft");
    const refused: [string, RequestInit][] = [
      ["/api/posts", json("POST", { title: "x", body: "" })],
      [`/api/posts/${id}`, json("PATCH", { title: "y" })],
      [`/api/posts/${id}`, { method: "DELETE" }],
      [`/api/posts/${id}/publish`, { method: "POST" }],
      [`/api/posts/${id}/unpublish`, { method: "POST" }],
      [`/api/posts/${id}/share`, { method: "POST" }],
      [`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/png" })],
      ["/api/banner", json("PUT", { message: "hi" })],
      ["/api/my/drafts", {}],
      ["/api/preferences", {}],
    ];
    for (const [path, init] of refused) {
      expect(await errorCode(await t.request(path, init), 401)).toBe("AUTH.UNAUTHENTICATED");
    }
  });

  it("lets a user create, view, edit and delete only their own drafts", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const bob = t.as(mockUsers.user("bob"));
    const id = await createDraft(alice, "alice's draft");

    const mine: DraftList = await (await alice.request("/api/my/drafts")).json();
    expect(mine.posts.map((p) => p.id)).toEqual([id]);
    const bobs: DraftList = await (await bob.request("/api/my/drafts")).json();
    expect(bobs.posts).toEqual([]);
    expect((await readPost(alice, id)).status).toBe("draft");

    // Bob cannot see Alice's draft, so it looks missing to him.
    expect(await errorCode(await bob.request(`/api/posts/${id}`), 404)).toBe("HTTP.NOT_FOUND");
    expect(await errorCode(await bob.request(`/api/posts/${id}`, json("PATCH", { title: "mine now" })), 404)).toBe("HTTP.NOT_FOUND");
    expect(await errorCode(await bob.request(`/api/posts/${id}`, { method: "DELETE" }), 404)).toBe("HTTP.NOT_FOUND");

    const edited = await alice.request(`/api/posts/${id}`, json("PATCH", { title: "edited", body: "new text" }));
    expect(edited.status).toBe(200);
    expect(await readPost(alice, id)).toMatchObject({ title: "edited", body: "new text" });

    expect((await alice.request(`/api/posts/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await errorCode(await alice.request(`/api/posts/${id}`), 404)).toBe("HTTP.NOT_FOUND");
    expect(t.logs().filter((e) => e.component === "posts" && e.severity === "info" && e.message.includes(id))).toHaveLength(1);
  });

  it("lets only an admin publish, unpublish and delete any post, and logs each", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin("boss"));
    const id = await createDraft(alice, "to publish");

    expect(await errorCode(await alice.request(`/api/posts/${id}/publish`, { method: "POST" }), 403)).toBe("AUTH.FORBIDDEN");
    const published = await admin.request(`/api/posts/${id}/publish`, { method: "POST" });
    expect(published.status).toBe(200);
    const summary: PostSummary = await published.json();
    expect(summary.status).toBe("published");

    // A published post is visible to its author but no longer editable or deletable by them.
    expect(await errorCode(await alice.request(`/api/posts/${id}`, json("PATCH", { title: "x" })), 403)).toBe("AUTH.FORBIDDEN");
    expect(await errorCode(await alice.request(`/api/posts/${id}`, { method: "DELETE" }), 403)).toBe("AUTH.FORBIDDEN");
    expect(await errorCode(await alice.request(`/api/posts/${id}/unpublish`, { method: "POST" }), 403)).toBe("AUTH.FORBIDDEN");

    expect((await admin.request(`/api/posts/${id}/unpublish`, { method: "POST" })).status).toBe(200);
    expect(await errorCode(await t.request(`/api/posts/${id}`), 404)).toBe("HTTP.NOT_FOUND");
    // An admin sees and deletes another user's draft.
    expect((await readPost(admin, id)).status).toBe("draft");
    expect((await admin.request(`/api/posts/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await errorCode(await alice.request(`/api/posts/${id}`), 404)).toBe("HTTP.NOT_FOUND");

    const info = t.logs().filter((e) => e.component === "posts" && e.severity === "info");
    expect(info.map((e) => e.message)).toEqual([`post ${id} published by boss`, `post ${id} unpublished by boss`, `post ${id} deleted`]);
  });

  it("lets an admin create and edit their own drafts", async () => {
    const t = await open({ user: mockUsers.admin("boss") });
    const id = await createDraft(t, "admin draft");
    expect((await t.request(`/api/posts/${id}`, json("PATCH", { body: "changed" }))).status).toBe(200);
    const mine: DraftList = await (await t.request("/api/my/drafts")).json();
    expect(mine.posts.map((p) => p.id)).toEqual([id]);
  });
});

describe("photos (DEMO-REQ-003, DEMO-AC-003)", () => {
  it("uploads a 20 MB JPEG that downloads byte-identical", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "big photo");
    const bytes = jpegBytes(20 * 1024 * 1024);
    const res = await addPhoto(alice, id, "image/jpeg", bytes, "big.jpg");
    expect(res.status).toBe(201);
    const stored: StoredPhoto = await res.json();
    expect(stored).toMatchObject({ name: "big.jpg", size: bytes.length, contentType: "image/jpeg" });

    const post = await readPost(alice, id);
    expect(post.photos.map((p) => p.id)).toEqual([stored.id]);
    const photo = post.photos[0];
    if (photo === undefined) throw new Error("no photo");
    expect(sameBytes(await downloadPhoto(alice, photo.ticket), bytes)).toBe(true);
  });

  it("enforces the configured maximum per post and the accepted types", async () => {
    const t = await open({ user: mockUsers.user("alice"), config: { maxPhotosPerPost: 2 } });
    const id = await createDraft(t, "photos");
    expect((await addPhoto(t, id, "image/png", pngBytes(64), "a.png")).status).toBe(201);
    expect((await addPhoto(t, id, "image/jpeg", jpegBytes(64), "b.jpg")).status).toBe(201);
    const third = await t.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/png" }));
    expect(await errorCode(third, 409)).toBe("HTTP.CONFLICT");
    expect((await readPost(t, id)).photos).toHaveLength(2);

    const other = await createDraft(t, "types");
    const gif = await t.request(`/api/posts/${other}/photos/upload-ticket`, json("POST", { contentType: "image/gif" }));
    expect(await errorCode(gif, 400)).toBe("HTTP.INVALID_INPUT");
    const missing = await t.request(`/api/posts/${other}/photos/finalize`, json("POST", { photoId: crypto.randomUUID(), name: "x.jpg" }));
    expect(await errorCode(missing, 404)).toBe("HTTP.NOT_FOUND");
    const slash = await t.request(`/api/posts/${other}/photos/finalize`, json("POST", { photoId: crypto.randomUUID(), name: "../x" }));
    expect(await errorCode(slash, 400)).toBe("HTTP.INVALID_INPUT");
  });

  it("refuses photos on another user's draft and on a published post", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "alice's");
    const bob = t.as(mockUsers.user("bob"));
    const theirs = await bob.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/png" }));
    expect(await errorCode(theirs, 404)).toBe("HTTP.NOT_FOUND");
    await t.as(mockUsers.admin()).request(`/api/posts/${id}/publish`, { method: "POST" });
    const published = await alice.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/png" }));
    expect(await errorCode(published, 403)).toBe("AUTH.FORBIDDEN");
  });

  it("deletes a post's photo rows and then its files", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "with photos");
    expect((await addPhoto(alice, id, "image/png", pngBytes(128), "a.png")).status).toBe(201);
    const post = await readPost(alice, id);
    const photo = post.photos[0];
    if (photo === undefined) throw new Error("no photo");

    expect((await alice.request(`/api/posts/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await errorCode(await alice.request(`/api/posts/${id}`), 404)).toBe("HTTP.NOT_FOUND");
    // The ticket is still within its lifetime, but the file is gone.
    expect((await sendTicket(alice, photo.ticket)).status).toBe(404);
    expect(t.logs().filter((e) => e.severity === "warn")).toHaveLength(0);
  });

  it("logs a file-deletion failure at warn and still deletes the post", async () => {
    const t = await open({ user: mockUsers.user("alice"), unavailable: ["files"] });
    const id = await createDraft(t, "cleanup fails");
    expect((await t.request(`/api/posts/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(await errorCode(await t.request(`/api/posts/${id}`), 404)).toBe("HTTP.NOT_FOUND");
    const warnings = t.logs().filter((e) => e.component === "photos" && e.severity === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain(id);
  });
});

describe("site banner (DEMO-REQ-004, DEMO-AC-004)", () => {
  it("is set and cleared by an admin and shown to anonymous visitors", async () => {
    const t = await open();
    const admin = t.as(mockUsers.admin());
    expect(await errorCode(await t.as(mockUsers.user()).request("/api/banner", json("PUT", { message: "users cannot" })), 403)).toBe("AUTH.FORBIDDEN");
    expect((await admin.request("/api/banner", json("PUT", { message: "Welcome!" }))).status).toBe(200);
    const site: Site = await (await t.request("/api/site")).json();
    expect(site.banner).toBe("Welcome!");
    const banner: Banner = await (await t.request("/api/banner")).json();
    expect(banner).toEqual({ message: "Welcome!" });
    expect((await admin.request("/api/banner", json("PUT", { message: null }))).status).toBe(200);
    const cleared: Banner = await (await t.request("/api/banner")).json();
    expect(cleared).toEqual({ message: null });
    expect(await errorCode(await admin.request("/api/banner", json("PUT", { message: "x".repeat(201) })), 400)).toBe("HTTP.INVALID_INPUT");
  });
});

describe("posts-per-page preference (DEMO-REQ-005, DEMO-AC-005)", () => {
  it("is kept per user and used as the default page size", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin());
    for (const n of [1, 2, 3]) {
      const id = await createDraft(alice, `post ${n}`);
      await admin.request(`/api/posts/${id}/publish`, { method: "POST" });
    }
    const before: Preferences = await (await alice.request("/api/preferences")).json();
    expect(before).toEqual({ pageSize: 10 });
    expect((await alice.request("/api/preferences", json("PUT", { pageSize: 2 }))).status).toBe(200);
    expect(await errorCode(await alice.request("/api/preferences", json("PUT", { pageSize: 0 })), 400)).toBe("HTTP.INVALID_INPUT");

    // A new session for the same user (log in again) sees the same choice.
    const again = t.as(mockUsers.user("alice"));
    const after: Preferences = await (await again.request("/api/preferences")).json();
    expect(after).toEqual({ pageSize: 2 });
    const page: PostPage = await (await again.request("/api/posts")).json();
    expect(page).toMatchObject({ pageSize: 2, hasMore: true });
    expect(page.posts).toHaveLength(2);

    const bobs: Preferences = await (await t.as(mockUsers.user("bob")).request("/api/preferences")).json();
    expect(bobs).toEqual({ pageSize: 10 });
    const anonymous: PostPage = await (await t.request("/api/posts")).json();
    expect(anonymous.pageSize).toBe(10);
  });
});

describe("share links (DEMO-REQ-007, DEMO-AC-007)", () => {
  it("show a draft to anyone with the link and refuse an altered link", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "shared draft");
    expect(await errorCode(await t.as(mockUsers.user("bob")).request(`/api/posts/${id}/share`, { method: "POST" }), 404)).toBe("HTTP.NOT_FOUND");
    const res = await alice.request(`/api/posts/${id}/share`, { method: "POST" });
    expect(res.status).toBe(201);
    const link: ShareLink = await res.json();
    const text = JSON.stringify(link);
    expect(text).not.toContain("test-share-key");

    const shown = await t.request(`/api/shared?token=${encodeURIComponent(link.token)}`);
    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({ id, title: "shared draft", status: "draft" });

    const [subject = "", expires = "", signature = ""] = link.token.split(".");
    const other = crypto.randomUUID();
    for (const altered of [`${other}.${expires}.${signature}`, `${subject}.${String(Number(expires) + 1)}.${signature}`, `${link.token}x`, "garbage"]) {
      expect(await errorCode(await t.request(`/api/shared?token=${encodeURIComponent(altered)}`), 404)).toBe("HTTP.NOT_FOUND");
    }
  });

  it("expire after the configured number of days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    const t = await open({ config: { shareLinkDays: 2 } });
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "expiring");
    const link: ShareLink = await (await alice.request(`/api/posts/${id}/share`, { method: "POST" })).json();
    expect(link.expiresAt).toBe(Date.parse("2026-03-03T00:00:00Z"));
    const path = `/api/shared?token=${encodeURIComponent(link.token)}`;
    vi.setSystemTime(link.expiresAt - 1);
    expect((await t.request(path)).status).toBe(200);
    vi.setSystemTime(link.expiresAt);
    expect(await errorCode(await t.request(path), 404)).toBe("HTTP.NOT_FOUND");
  });

  it("need the share secret to be set", async () => {
    const t = await open({ user: mockUsers.user("alice"), secrets: {} });
    const id = await createDraft(t, "no key");
    expect(await errorCode(await t.request(`/api/posts/${id}/share`, { method: "POST" }), 500)).toBe("SEC.MISSING");
  });
});

interface Me {
  readonly level: string;
  readonly id?: string;
  readonly unlistedId?: string;
}

describe("account (DEMO-REQ-009, DEMO-AC-009)", () => {
  it("/api/auth/me reports the logged-in user's ID", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    const me: Me = await (await t.request("/api/auth/me")).json();
    expect(me).toMatchObject({ level: "user", id: "alice" });
  });
});

describe("users list (DEMO-REQ-011, DEMO-AC-011)", () => {
  async function derivedId(name: string): Promise<string> {
    const probe = await open({ stubLoginProvider: true, config: { framework: { users: [] } } });
    await probe.loginWithStub(name);
    const me: Me = await (await probe.request("/api/auth/me")).json();
    expect(me.level).toBe("anonymous");
    if (me.unlistedId === undefined) throw new Error("no unlistedId");
    return me.unlistedId;
  }

  it("lets a listed login create a draft and treats an unlisted login as anonymous", async () => {
    const aliceId = await derivedId("alice");
    const bossId = await derivedId("boss");
    const options = { stubLoginProvider: true, config: { framework: { users: [aliceId], admins: [bossId] } } } as const;

    // One app, so every login sees the same posts.
    const t = await open(options);
    await t.loginWithStub("boss");
    const published = await createDraft(t, "published post");
    expect((await t.request(`/api/posts/${published}/publish`, { method: "POST" })).status).toBe(200);

    await t.loginWithStub("alice");
    const me: Me = await (await t.request("/api/auth/me")).json();
    expect(me).toMatchObject({ level: "user", id: aliceId });
    const draft = await createDraft(t, "listed user's draft");

    await t.loginWithStub("mallory");
    const malloryMe: Me = await (await t.request("/api/auth/me")).json();
    expect(malloryMe.level).toBe("anonymous");
    expect(await errorCode(await t.request("/api/posts", json("POST", { title: "unlisted", body: "" })), 401)).toBe("AUTH.UNAUTHENTICATED");
    const page: PostPage = await (await t.request("/api/posts")).json();
    expect(page.posts.map((p) => p.id)).toEqual([published]);
    expect(await errorCode(await t.request(`/api/posts/${draft}`), 404)).toBe("HTTP.NOT_FOUND");
  });
});
