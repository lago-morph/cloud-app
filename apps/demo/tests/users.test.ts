import { describe, expect, it } from "vitest";
import prod from "../config/cloudflare/prod.json" with { type: "json" };
import type { PostPage } from "../src/shared/types";
import { errorCode, json, open } from "./support";

interface Me {
  readonly level: string;
  readonly id?: string;
  readonly unlistedId?: string;
}

/** The ID the stub login derives for `login`, read from `/api/auth/me` with no users list. */
async function derivedId(login: string): Promise<string> {
  const t = await open({ stubLoginProvider: true });
  await t.loginWithStub(login);
  const me: Me = await (await t.request("/api/auth/me")).json();
  const id = me.id ?? me.unlistedId;
  if (id === undefined) throw new Error("no ID for the stub login");
  return id;
}

describe("DEMO-AC-011 only listed people can post", () => {
  it("every committed production values file sets framework.users", () => {
    expect(Array.isArray(prod.framework.users)).toBe(true);
  });

  it("a login on the users list can create a draft", async () => {
    const aliceId = await derivedId("alice");
    const t = await open({ stubLoginProvider: true, config: { framework: { users: [aliceId] } } });
    await t.loginWithStub("alice");
    const me: Me = await (await t.request("/api/auth/me")).json();
    expect(me).toMatchObject({ level: "user", id: aliceId });
    expect((await t.request("/api/posts", json("POST", { title: "listed", body: "" }))).status).toBe(201);
  });

  it("a login on neither list is anonymous: refused with 401 and sees only published posts", async () => {
    const aliceId = await derivedId("alice");
    const t = await open({ stubLoginProvider: true, config: { framework: { users: [aliceId] } } });
    await t.loginWithStub("mallory");
    const me: Me = await (await t.request("/api/auth/me")).json();
    expect(me.level).toBe("anonymous");
    const res = await t.request("/api/posts", json("POST", { title: "unlisted", body: "" }));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("AUTH.UNAUTHENTICATED");
    expect((await t.request("/api/drafts")).status).toBe(401);
    const page: PostPage = await (await t.request("/api/posts")).json();
    expect(page.posts.every((p) => p.status === "published")).toBe(true);
  });

  it("an empty users list admits no one but admins", async () => {
    const t = await open({ stubLoginProvider: true, config: { framework: { users: [] } } });
    await t.loginWithStub("alice");
    const me: Me = await (await t.request("/api/auth/me")).json();
    expect(me.level).toBe("anonymous");
    expect((await t.request("/api/posts", json("POST", { title: "x", body: "" }))).status).toBe(401);
  });
});
