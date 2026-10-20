import { describe, expect, it } from "vitest";
import prod from "../config/cloudflare/prod.json";
import type { PostPage } from "../src/shared/types";
import { createDraft, errorCode, json, open } from "./support";

interface Me {
  readonly level: string;
  readonly id?: string;
  readonly unlistedId?: string;
}

/** The ID the real login code derives for a stub login. */
async function derivedId(name: string): Promise<string> {
  const probe = await open({ stubLoginProvider: true });
  await probe.loginWithStub(name);
  const me: Me = await (await probe.request("/api/auth/me")).json();
  const id = me.id ?? me.unlistedId;
  if (id === undefined) throw new Error("no ID from /api/auth/me");
  return id;
}

describe("only listed people can post (DEMO-AC-011)", () => {
  it("every committed production values file sets framework.users", () => {
    // The demo's only production stage is cloudflare/prod (AWS is not built yet).
    expect(Array.isArray(prod.framework.users)).toBe(true);
  });

  it("lets a listed login create a draft and treats an unlisted login as anonymous", async () => {
    const aliceId = await derivedId("alice");
    const bossId = await derivedId("boss");
    const t = await open({ stubLoginProvider: true, config: { framework: { users: [aliceId], admins: [bossId] } } });

    await t.loginWithStub("boss");
    const publishedId = await createDraft(t, "published post");
    expect((await t.request(`/api/posts/${publishedId}/publish`, json("POST"))).status).toBe(200);

    await t.loginWithStub("alice");
    const me: Me = await (await t.request("/api/auth/me")).json();
    expect(me).toMatchObject({ level: "user", id: aliceId });
    const draftId = await createDraft(t, "alice's draft");

    await t.loginWithStub("mallory");
    const stranger: Me = await (await t.request("/api/auth/me")).json();
    expect(stranger.level).toBe("anonymous");
    const refused = await t.request("/api/posts", json("POST", { title: "x", body: "" }));
    expect(refused.status).toBe(401);
    expect(await errorCode(refused)).toBe("AUTH.UNAUTHENTICATED");
    const list: PostPage = await (await t.request("/api/posts")).json();
    expect(list.posts.map((p) => p.id)).toEqual([publishedId]);
    expect((await t.request(`/api/posts/${draftId}`)).status).toBe(404);
  });
});
