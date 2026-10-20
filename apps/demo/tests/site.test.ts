import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { describe, expect, it } from "vitest";
import type { Banner, PostPage, Preferences, SiteInfo } from "../src/shared/types";
import { createDraft, errorCode, json, open } from "./support";

describe("configuration (DEMO-AC-006)", () => {
  it("serves the default site settings", async () => {
    const t = await open();
    const site: SiteInfo = await (await t.request("/api/site")).json();
    expect(site).toEqual({ title: "Photo board", banner: null, maxPhotosPerPost: 5, shareLinkDays: 7 });
  });

  it("serves the configured title, maximum and link lifetime", async () => {
    const t = await open({ config: { siteTitle: "Holiday photos", maxPhotosPerPost: 3, shareLinkDays: 1 } });
    const site: SiteInfo = await (await t.request("/api/site")).json();
    expect(site).toMatchObject({ title: "Holiday photos", maxPhotosPerPost: 3, shareLinkDays: 1 });
  });
});

describe("site banner (DEMO-AC-004)", () => {
  it("is set by an admin, shown to anonymous visitors, and cleared", async () => {
    const t = await open();
    const admin = t.as(mockUsers.admin());
    const set = await admin.request("/api/banner", json("PUT", { banner: "Maintenance <b>tonight</b>" }));
    expect(set.status).toBe(200);
    const body: Banner = await set.json();
    expect(body).toEqual({ banner: "Maintenance <b>tonight</b>" });
    const site: SiteInfo = await (await t.as(mockUsers.anonymous).request("/api/site")).json();
    expect(site.banner).toBe("Maintenance <b>tonight</b>");
    expect(t.logs().filter((e) => e.component === "site" && e.severity === "info")).toHaveLength(1);

    await admin.request("/api/banner", json("PUT", { banner: "" }));
    const cleared: SiteInfo = await (await t.request("/api/site")).json();
    expect(cleared.banner).toBeNull();
  });

  it("cannot be set by a user or an anonymous visitor", async () => {
    const t = await open();
    const user = await t.as(mockUsers.user("alice")).request("/api/banner", json("PUT", { banner: "hi" }));
    expect(user.status).toBe(403);
    expect(await errorCode(user)).toBe("AUTH.FORBIDDEN");
    expect((await t.as(mockUsers.anonymous).request("/api/banner", json("PUT", { banner: "hi" }))).status).toBe(401);
    const tooLong = await t.as(mockUsers.admin()).request("/api/banner", json("PUT", { banner: "x".repeat(301) }));
    expect(tooLong.status).toBe(400);
    const site: SiteInfo = await (await t.request("/api/site")).json();
    expect(site.banner).toBeNull();
  });
});

describe("posts-per-page preference (DEMO-AC-005)", () => {
  it("persists per user across sessions and sets the page size", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const admin = t.as(mockUsers.admin());
    for (let i = 0; i < 4; i += 1) {
      const id = await createDraft(alice, `post ${i}`);
      await admin.request(`/api/posts/${id}/publish`, json("POST"));
    }
    const before: Preferences = await (await alice.request("/api/preferences")).json();
    expect(before).toEqual({ perPage: 10 });
    expect((await alice.request("/api/preferences", json("PUT", { perPage: 3 }))).status).toBe(200);

    // A new session for the same user (log out, log in again).
    const again = t.as(mockUsers.user("alice"));
    const after: Preferences = await (await again.request("/api/preferences")).json();
    expect(after).toEqual({ perPage: 3 });
    const page: PostPage = await (await again.request("/api/posts")).json();
    expect(page.perPage).toBe(3);
    expect(page.posts).toHaveLength(3);

    const bob: Preferences = await (await t.as(mockUsers.user("bob")).request("/api/preferences")).json();
    expect(bob).toEqual({ perPage: 10 });
    const anon: PostPage = await (await t.as(mockUsers.anonymous).request("/api/posts")).json();
    expect(anon.perPage).toBe(10);
  });

  it("validates the value and needs a login", async () => {
    const t = await open();
    expect((await t.request("/api/preferences")).status).toBe(401);
    const alice = t.as(mockUsers.user("alice"));
    for (const perPage of [0, 51, 2.5]) {
      expect((await alice.request("/api/preferences", json("PUT", { perPage }))).status).toBe(400);
    }
  });
});
