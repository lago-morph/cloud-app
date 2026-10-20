import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostDetail, PostList, PostPage, PostSummary, ShareLink } from "../src/shared/types";
import { createDraft, errorCode, json, open, type WireTicket } from "./support";

afterEach(() => {
  vi.useRealTimers();
});

describe("posts: listing (DEMO-AC-001)", () => {
  it("shows anonymous visitors only published posts, newest first, in pages", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin("boss"));
    const ids: string[] = [];
    for (const title of ["one", "two", "three"]) {
      const id = await createDraft(alice, title);
      ids.push(id);
      expect((await admin.request(`/api/posts/${id}/publish`, json("POST"))).status).toBe(200);
    }
    await createDraft(alice, "still a draft");

    const anon = t.as(mockUsers.anonymous);
    const first: PostPage = await (await anon.request("/api/posts?perPage=2")).json();
    expect(first.posts.map((p) => p.title)).toEqual(["three", "two"]);
    expect(first.hasMore).toBe(true);
    const second: PostPage = await (await anon.request("/api/posts?perPage=2&page=2")).json();
    expect(second.posts.map((p) => p.title)).toEqual(["one"]);
    expect(second.hasMore).toBe(false);
    expect(second.posts.every((p) => p.status === "published")).toBe(true);
  });

  it("keeps a <script> title as plain text", async () => {
    const t = await open();
    const title = "<script>alert(1)</script>";
    const id = await createDraft(t.as(mockUsers.user("alice")), title);
    await t.as(mockUsers.admin()).request(`/api/posts/${id}/publish`, json("POST"));
    const detail: PostDetail<WireTicket> = await (await t.request(`/api/posts/${id}`)).json();
    expect(detail.post.title).toBe(title);
  });

  it("validates titles and the page query", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    for (const title of ["", "   ", "x".repeat(121)]) {
      const res = await t.request("/api/posts", json("POST", { title, body: "" }));
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("HTTP.INVALID_INPUT");
    }
    expect((await t.request("/api/posts", json("POST", { title: "x".repeat(120), body: "" }))).status).toBe(201);
    expect((await t.request("/api/posts?page=0")).status).toBe(400);
    expect((await t.request("/api/posts?perPage=51")).status).toBe(400);
  });

  it("answers 404 for an unknown or malformed post ID", async () => {
    const t = await open();
    for (const id of [crypto.randomUUID(), "not-a-uuid"]) {
      const res = await t.request(`/api/posts/${id}`);
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe("HTTP.NOT_FOUND");
    }
  });
});

describe("permissions (DEMO-AC-002)", () => {
  it("lets anonymous visitors only view published posts", async () => {
    const t = await open();
    const draft = await createDraft(t.as(mockUsers.user("alice")));
    const anon = t.as(mockUsers.anonymous);
    expect((await anon.request(`/api/posts/${draft}`)).status).toBe(404);
    const cases: [string, RequestInit | undefined][] = [
      ["/api/posts", json("POST", { title: "t", body: "" })],
      [`/api/posts/${draft}`, json("PUT", { title: "t", body: "" })],
      [`/api/posts/${draft}`, json("DELETE")],
      ["/api/posts/mine", undefined],
      [`/api/posts/${draft}/publish`, json("POST")],
      [`/api/posts/${draft}/share`, json("POST")],
      ["/api/banner", json("PUT", { banner: "x" })],
    ];
    for (const [path, init] of cases) {
      const res = await anon.request(path, init);
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe("AUTH.UNAUTHENTICATED");
    }
  });

  it("lets a user create, view, edit and delete only their own drafts", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const bob = t.as(mockUsers.user("bob"));
    const draft = await createDraft(alice, "alice's draft");

    const edited = await alice.request(`/api/posts/${draft}`, json("PUT", { title: "edited", body: "new text" }));
    expect(edited.status).toBe(200);
    const mine: PostList = await (await alice.request("/api/posts/mine")).json();
    expect(mine.posts.map((p) => p.title)).toEqual(["edited"]);
    const bobs: PostList = await (await bob.request("/api/posts/mine")).json();
    expect(bobs.posts).toEqual([]);

    // Another user cannot see the draft at all.
    expect((await bob.request(`/api/posts/${draft}`)).status).toBe(404);
    expect((await bob.request(`/api/posts/${draft}`, json("PUT", { title: "x", body: "" }))).status).toBe(404);
    expect((await bob.request(`/api/posts/${draft}`, json("DELETE"))).status).toBe(404);

    expect((await alice.request(`/api/posts/${draft}`, json("DELETE"))).status).toBe(204);
    expect((await alice.request(`/api/posts/${draft}`)).status).toBe(404);
  });

  it("refuses publish, unpublish, banner and deleting a published post to a user", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin("boss"));
    const draft = await createDraft(alice);
    for (const path of [`/api/posts/${draft}/publish`, `/api/posts/${draft}/unpublish`]) {
      const res = await alice.request(path, json("POST"));
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("AUTH.FORBIDDEN");
    }
    expect((await alice.request("/api/admin/drafts")).status).toBe(403);
    expect((await admin.request(`/api/posts/${draft}/publish`, json("POST"))).status).toBe(200);
    // Published: the author may no longer edit or delete it.
    for (const init of [json("PUT", { title: "x", body: "" }), json("DELETE")]) {
      const res = await alice.request(`/api/posts/${draft}`, init);
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("AUTH.FORBIDDEN");
    }
  });

  it("lets an admin create drafts, publish, unpublish and delete any post, and logs it (DEMO-AC-008)", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin("boss"));
    const own = await createDraft(admin, "admin's own");
    const draft = await createDraft(alice);
    const drafts: PostList = await (await admin.request("/api/admin/drafts")).json();
    expect(drafts.posts.map((p) => p.id).sort()).toEqual([own, draft].sort());
    expect((await admin.request(`/api/posts/${draft}`)).status).toBe(200);
    // An admin may not edit someone else's draft.
    expect((await admin.request(`/api/posts/${draft}`, json("PUT", { title: "x", body: "" }))).status).toBe(403);

    const published = await admin.request(`/api/posts/${draft}/publish`, json("POST"));
    const summary: PostSummary = await published.json();
    expect(summary.status).toBe("published");
    const unpublished: PostSummary = await (await admin.request(`/api/posts/${draft}/unpublish`, json("POST"))).json();
    expect(unpublished.status).toBe("draft");
    expect((await t.as(mockUsers.anonymous).request(`/api/posts/${draft}`)).status).toBe(404);
    await admin.request(`/api/posts/${draft}/publish`, json("POST"));
    expect((await admin.request(`/api/posts/${draft}`, json("DELETE"))).status).toBe(204);
    expect((await admin.request(`/api/posts/${draft}`)).status).toBe(404);

    const info = t.logs().filter((e) => e.component === "posts" && e.severity === "info");
    expect(info.map((e) => e.message)).toEqual([
      `post ${draft} published`,
      `post ${draft} unpublished`,
      `post ${draft} published`,
      `post ${draft} deleted`,
    ]);
  });
});

describe("share links (DEMO-AC-007)", () => {
  it("shows the draft to anyone with the link and refuses an altered one", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const draft = await createDraft(alice, "shared draft");
    expect((await t.as(mockUsers.user("bob")).request(`/api/posts/${draft}/share`, json("POST"))).status).toBe(404);
    const res = await alice.request(`/api/posts/${draft}/share`, json("POST"));
    expect(res.status).toBe(201);
    const link: ShareLink = await res.json();
    const text = JSON.stringify(link);
    expect(text).not.toContain("test-share-key");

    const anon = t.as(mockUsers.anonymous);
    const shared = await anon.request(`/api/shared/${link.token}`);
    expect(shared.status).toBe(200);
    const detail: PostDetail<WireTicket> = await shared.json();
    expect(detail.post.title).toBe("shared draft");

    const [subject = "", expires = "", signature = ""] = link.token.split(".");
    const other = crypto.randomUUID();
    for (const altered of [`${other}.${expires}.${signature}`, `${subject}.${String(Number(expires) + 1)}.${signature}`, `${subject}.${expires}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`, "garbage"]) {
      const bad = await anon.request(`/api/shared/${altered}`);
      expect(bad.status).toBe(404);
      expect(await errorCode(bad)).toBe("HTTP.NOT_FOUND");
    }
  });

  it("refuses a link once it has expired (shareLinkDays from configuration)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const t = await open({ config: { shareLinkDays: 2 } });
    const alice = t.as(mockUsers.user("alice"));
    const draft = await createDraft(alice);
    const link: ShareLink = await (await alice.request(`/api/posts/${draft}/share`, json("POST"))).json();
    expect(link.expiresAt).toBe(new Date("2026-01-03T00:00:00Z").getTime());
    vi.setSystemTime(new Date("2026-01-02T23:59:00Z"));
    expect((await t.request(`/api/shared/${link.token}`)).status).toBe(200);
    vi.setSystemTime(new Date("2026-01-03T00:00:01Z"));
    expect((await t.request(`/api/shared/${link.token}`)).status).toBe(404);
  });

  it("cannot be made for a published post or by another user", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const draft = await createDraft(alice);
    await t.as(mockUsers.admin()).request(`/api/posts/${draft}/publish`, json("POST"));
    expect((await alice.request(`/api/posts/${draft}/share`, json("POST"))).status).toBe(403);
  });
});
