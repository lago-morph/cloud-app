import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostDetail, ShareLink } from "../src/shared/types";
import { createDraft, errorCode, json, open, SHARE_KEY } from "./support";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

describe("DEMO-AC-007 share links", () => {
  it("shows the draft to an anonymous visitor; refuses an altered link", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice, "secret draft");
    const res = await alice.request(`/api/posts/${id}/share`, json("POST"));
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(SHARE_KEY);
    const link: ShareLink = JSON.parse(text);
    expect(link.path).toBe(`/share/${link.token}`);

    expect((await t.request(`/api/posts/${id}`)).status).toBe(404);
    const shared = await t.request(`/api/shared/${link.token}`);
    expect(shared.status).toBe(200);
    const post: PostDetail<unknown> = await shared.json();
    expect(post.title).toBe("secret draft");

    const [subject = "", expires = "", signature = ""] = link.token.split(".");
    const other = await createDraft(alice, "other");
    const altered = [
      `${other}.${expires}.${signature}`,
      `${subject}.${String(Number(expires) + DAY_MS)}.${signature}`,
      `${subject}.${expires}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`,
      "garbage",
    ];
    for (const token of altered) {
      const refused = await t.request(`/api/shared/${encodeURIComponent(token)}`);
      expect(refused.status).toBe(404);
      expect(await errorCode(refused)).toBe("HTTP.NOT_FOUND");
    }
  });

  it("refuses the link once the configured lifetime has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    const t = await open({ config: { shareLinkDays: 2 } });
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice);
    const link: ShareLink = await (await alice.request(`/api/posts/${id}/share`, json("POST"))).json();
    expect(link.expiresAt).toBe(Date.now() + 2 * DAY_MS);
    vi.advanceTimersByTime(2 * DAY_MS - 1);
    expect((await t.request(`/api/shared/${link.token}`)).status).toBe(200);
    vi.advanceTimersByTime(1);
    expect((await t.request(`/api/shared/${link.token}`)).status).toBe(404);
  });

  it("only the author may share their own draft", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice);
    expect((await t.request(`/api/posts/${id}/share`, json("POST"))).status).toBe(401);
    expect((await t.as(mockUsers.user("bob")).request(`/api/posts/${id}/share`, json("POST"))).status).toBe(404);
    expect((await t.as(mockUsers.admin()).request(`/api/posts/${id}/share`, json("POST"))).status).toBe(403);
  });

  it("a link made with another key is refused", async () => {
    const t = await open({ secrets: { shareKey: "another-share-key-at-least-32-bytes" } });
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice);
    const link: ShareLink = await (await alice.request(`/api/posts/${id}/share`, json("POST"))).json();
    const u = await open();
    const draft = await createDraft(u.as(mockUsers.user("alice")));
    const forged = link.token.replace(id, draft);
    expect((await u.request(`/api/shared/${forged}`)).status).toBe(404);
  });
});
