import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftList, PostDetail, PostPage } from "../src/shared/types";
import { createDraft, errorCode, json, open } from "./support";

afterEach(() => {
  vi.useRealTimers();
});

describe("DEMO-AC-001 published posts", () => {
  it("shows anonymous visitors only published posts, newest first, a page at a time", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin("root"));
    const ids: string[] = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 1; i <= 5; i += 1) {
      ids.push(await createDraft(alice, `post ${i}`));
      vi.advanceTimersByTime(1000);
    }
    await createDraft(alice, "still a draft");
    for (const id of ids) expect((await admin.request(`/api/posts/${id}/publish`, json("POST"))).status).toBe(200);

    const first: PostPage = await (await t.request("/api/posts?pageSize=2")).json();
    expect(first.posts.map((p) => p.title)).toEqual(["post 5", "post 4"]);
    expect(first.hasMore).toBe(true);
    const third: PostPage = await (await t.request("/api/posts?pageSize=2&page=3")).json();
    expect(third.posts.map((p) => p.title)).toEqual(["post 1"]);
    expect(third.hasMore).toBe(false);
    const all: PostPage = await (await t.request("/api/posts")).json();
    expect(all.pageSize).toBe(10);
    expect(all.posts.every((p) => p.status === "published")).toBe(true);
    expect(all.posts).toHaveLength(5);
  });

  it("returns a title with <script> as plain text data", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const title = `<script>alert("x")</script>`;
    const id = await createDraft(alice, title, "<b>bold?</b>");
    await t.as(mockUsers.admin()).request(`/api/posts/${id}/publish`, json("POST"));
    const post: PostDetail<unknown> = await (await t.request(`/api/posts/${id}`)).json();
    expect(post.title).toBe(title);
    expect(post.body).toBe("<b>bold?</b>");
  });

  it("validates titles and query parameters", async () => {
    const t = await open({ user: mockUsers.user() });
    for (const title of ["", "   ", "x".repeat(121)]) {
      const res = await t.request("/api/posts", json("POST", { title, body: "" }));
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("HTTP.INVALID_INPUT");
    }
    expect((await t.request("/api/posts", json("POST", { title: "x".repeat(120), body: "" }))).status).toBe(201);
    expect((await t.request("/api/posts?page=0")).status).toBe(400);
    expect((await t.request("/api/posts?pageSize=51")).status).toBe(400);
    const bad = await t.request("/api/posts/not-a-uuid");
    expect(bad.status).toBe(404);
    expect(await errorCode(bad)).toBe("HTTP.NOT_FOUND");
  });
});

describe("DEMO-AC-002 permissions table", () => {
  it("anonymous: may view published posts; every other action is refused", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const draft = await createDraft(alice);
    const published = await createDraft(alice, "public");
    await t.as(mockUsers.admin()).request(`/api/posts/${published}/publish`, json("POST"));

    expect((await t.request(`/api/posts/${published}`)).status).toBe(200);
    expect((await t.request(`/api/posts/${draft}`)).status).toBe(404);
    const refusals = [
      await t.request("/api/posts", json("POST", { title: "x", body: "" })),
      await t.request("/api/drafts"),
      await t.request(`/api/posts/${draft}`, json("PATCH", { title: "y" })),
      await t.request(`/api/posts/${draft}`, json("DELETE")),
      await t.request(`/api/posts/${draft}/publish`, json("POST")),
      await t.request(`/api/posts/${published}/unpublish`, json("POST")),
      await t.request("/api/banner", json("PUT", { banner: "hi" })),
    ];
    for (const res of refusals) {
      expect(res.status).toBe(401);
      expect(await errorCode(res)).toBe("AUTH.UNAUTHENTICATED");
    }
  });

  it("user: creates, views, edits and deletes own drafts only; may not publish, delete others' posts or set the banner", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const bob = t.as(mockUsers.user("bob"));
    const mine = await createDraft(alice, "mine");
    const bobs = await createDraft(bob, "bob's");

    const drafts: DraftList = await (await alice.request("/api/drafts")).json();
    expect(drafts.posts.map((p) => p.title)).toEqual(["mine"]);
    expect((await alice.request(`/api/posts/${mine}`)).status).toBe(200);
    const edited = await alice.request(`/api/posts/${mine}`, json("PATCH", { title: "mine, edited" }));
    expect(edited.status).toBe(200);
    const after: PostDetail<unknown> = await (await alice.request(`/api/posts/${mine}`)).json();
    expect(after.title).toBe("mine, edited");

    // Another user's draft is invisible to Alice.
    for (const res of [
      await alice.request(`/api/posts/${bobs}`),
      await alice.request(`/api/posts/${bobs}`, json("PATCH", { title: "hacked" })),
      await alice.request(`/api/posts/${bobs}`, json("DELETE")),
    ]) {
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe("HTTP.NOT_FOUND");
    }
    // Admin-only actions.
    for (const res of [
      await alice.request(`/api/posts/${mine}/publish`, json("POST")),
      await alice.request(`/api/posts/${mine}/unpublish`, json("POST")),
      await alice.request("/api/banner", json("PUT", { banner: "mine now" })),
    ]) {
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("AUTH.FORBIDDEN");
    }
    // Once published, Alice may see her post but neither edit nor delete it.
    await t.as(mockUsers.admin()).request(`/api/posts/${mine}/publish`, json("POST"));
    const edit = await alice.request(`/api/posts/${mine}`, json("PATCH", { title: "again" }));
    expect(edit.status).toBe(409);
    expect(await errorCode(edit)).toBe("HTTP.CONFLICT");
    const del = await alice.request(`/api/posts/${mine}`, json("DELETE"));
    expect(del.status).toBe(403);
    expect(await errorCode(del)).toBe("AUTH.FORBIDDEN");
    // A published post of someone else is visible but not Bob's to change.
    const bobEdit = await bob.request(`/api/posts/${mine}`, json("PATCH", { title: "bob" }));
    expect(bobEdit.status).toBe(403);

    expect((await alice.request(`/api/posts/${bobs}`)).status).toBe(404);
    expect((await bob.request(`/api/posts/${bobs}`, json("DELETE"))).status).toBe(204);
    expect((await bob.request(`/api/posts/${bobs}`)).status).toBe(404);
  });

  it("admin: creates own drafts, views any draft, publishes, unpublishes and deletes any post", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin("root"));
    const own = await createDraft(admin, "admin's own");
    expect((await admin.request(`/api/posts/${own}`, json("PATCH", { body: "edited" }))).status).toBe(200);
    const drafts: DraftList = await (await admin.request("/api/drafts")).json();
    expect(drafts.posts.map((p) => p.id)).toEqual([own]);

    const theirs = await createDraft(alice, "alice's");
    expect((await admin.request(`/api/posts/${theirs}`)).status).toBe(200);
    // An admin may not rewrite someone else's draft: that is the author's.
    expect((await admin.request(`/api/posts/${theirs}`, json("PATCH", { title: "x" }))).status).toBe(403);
    expect((await admin.request(`/api/posts/${theirs}/publish`, json("POST"))).status).toBe(200);
    expect((await t.request(`/api/posts/${theirs}`)).status).toBe(200);
    expect((await admin.request(`/api/posts/${theirs}/unpublish`, json("POST"))).status).toBe(200);
    expect((await t.request(`/api/posts/${theirs}`)).status).toBe(404);
    await admin.request(`/api/posts/${theirs}/publish`, json("POST"));
    expect((await admin.request(`/api/posts/${theirs}`, json("DELETE"))).status).toBe(204);
    expect((await t.request(`/api/posts/${theirs}`)).status).toBe(404);
    expect((await admin.request(`/api/posts/${crypto.randomUUID()}/publish`, json("POST"))).status).toBe(404);
    expect((await admin.request("/api/banner", json("PUT", { banner: "hello" }))).status).toBe(200);
  });
});

describe("DEMO-AC-008 log", () => {
  it("logs publish, unpublish and delete at info", async () => {
    const t = await open();
    const admin = t.as(mockUsers.admin("root"));
    const id = await createDraft(t.as(mockUsers.user("alice")));
    await admin.request(`/api/posts/${id}/publish`, json("POST"));
    await admin.request(`/api/posts/${id}/unpublish`, json("POST"));
    await admin.request(`/api/posts/${id}`, json("DELETE"));
    const entries = t.logs().filter((e) => e.component === "posts" && e.severity === "info");
    expect(entries.map((e) => e.message)).toEqual([
      `post ${id} published by root`,
      `post ${id} unpublished by root`,
      `post ${id} deleted by root`,
    ]);
  });
});
