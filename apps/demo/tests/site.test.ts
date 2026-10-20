import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { describe, expect, it } from "vitest";
import type { PostPage, Preferences, Site } from "../src/shared/types";
import { createDraft, errorCode, json, open } from "./support";

describe("DEMO-AC-004 site banner", () => {
  it("an admin's banner appears for anonymous visitors; users cannot set it; an admin can clear it", async () => {
    const t = await open();
    const before: Site = await (await t.request("/api/site")).json();
    expect(before.banner).toBeNull();

    const refused = await t.as(mockUsers.user("alice")).request("/api/banner", json("PUT", { banner: "user banner" }));
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe("AUTH.FORBIDDEN");

    const admin = t.as(mockUsers.admin());
    expect((await admin.request("/api/banner", json("PUT", { banner: "Maintenance <b>tonight</b>" }))).status).toBe(200);
    const shown: Site = await (await t.request("/api/site")).json();
    expect(shown.banner).toBe("Maintenance <b>tonight</b>");

    expect((await admin.request("/api/banner", json("PUT", { banner: null }))).status).toBe(200);
    const cleared: Site = await (await t.request("/api/site")).json();
    expect(cleared.banner).toBeNull();

    const tooLong = await admin.request("/api/banner", json("PUT", { banner: "x".repeat(501) }));
    expect(tooLong.status).toBe(400);
  });
});

describe("DEMO-AC-005 posts per page", () => {
  it("a user's choice is kept per user ID, so a new session after logout and login sees it", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    expect((await alice.request("/api/preferences", json("PUT", { pageSize: 2 }))).status).toBe(200);
    // A new session for the same user ID (as after logout and login) sees the same choice.
    const again = t.as(mockUsers.user("alice"));
    const saved: Preferences = await (await again.request("/api/preferences")).json();
    expect(saved.pageSize).toBe(2);
    const admin = t.as(mockUsers.admin());
    for (let i = 0; i < 3; i += 1) {
      const id = await createDraft(admin, `p${i}`);
      await admin.request(`/api/posts/${id}/publish`, json("POST"));
    }
    const page: PostPage = await (await again.request("/api/posts")).json();
    expect(page.pageSize).toBe(2);
    expect(page.posts).toHaveLength(2);
    const bob: Preferences = await (await t.as(mockUsers.user("bob")).request("/api/preferences")).json();
    expect(bob.pageSize).toBe(10);
  });

  it("refuses anonymous callers and out-of-range values", async () => {
    const t = await open();
    expect((await t.request("/api/preferences")).status).toBe(401);
    const alice = t.as(mockUsers.user("alice"));
    for (const pageSize of [0, 51, 2.5]) {
      const res = await alice.request("/api/preferences", json("PUT", { pageSize }));
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("HTTP.INVALID_INPUT");
    }
  });
});

describe("DEMO-AC-006 configuration", () => {
  it("serves the default site settings", async () => {
    const t = await open();
    const site: Site = await (await t.request("/api/site")).json();
    expect(site).toEqual({ title: "Photo board", banner: null, maxPhotosPerPost: 3, shareLinkDays: 7 });
  });

  it("serves the title, photo maximum and share-link lifetime configured for the stage", async () => {
    const t = await open({ config: { siteTitle: "Holiday photos", maxPhotosPerPost: 5, shareLinkDays: 2 } });
    const site: Site = await (await t.request("/api/site")).json();
    expect(site).toEqual({ title: "Holiday photos", banner: null, maxPhotosPerPost: 5, shareLinkDays: 2 });
  });
});

describe("DEMO-AC-009 account", () => {
  it("/api/auth/me reports the logged-in user's ID, which the account page shows", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    const me: { level: string; id: string } = await (await t.request("/api/auth/me")).json();
    expect(me).toMatchObject({ level: "user", id: "alice" });
  });
});
