import { createTestApp, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterEach, describe, expect, it } from "vitest";
import prodValues from "../config/cloudflare/prod.json" with { type: "json" };
import app from "../src/app";
import type { PostPage } from "../src/shared/types";
import { createDraft, json } from "./support";

let opened: TestApp[] = [];
async function open(users: readonly string[]): Promise<TestApp> {
  const t = await createTestApp(app, { stubLoginProvider: true, config: { framework: { users: [...users] } } });
  opened.push(t);
  return t;
}

afterEach(async () => {
  await Promise.all(opened.map((t) => t.dispose()));
  opened = [];
});

/** The derived user ID of a stub login: `id`, or `unlistedId` when the users list makes it anonymous. */
async function idOf(name: string): Promise<string> {
  const t = await open([]);
  await t.loginWithStub(name);
  const me: { id?: string; unlistedId?: string } = await (await t.request("/api/auth/me")).json();
  const id = me.id ?? me.unlistedId;
  expect(id).toMatch(/^u_/);
  return id ?? "";
}

describe("only listed people can post (DEMO-REQ-011, DEMO-AC-011)", () => {
  it("the committed production values file sets framework.users", () => {
    expect(Array.isArray(prodValues.framework.users)).toBe(true);
  });

  it("lets a listed login create a draft, and treats an unlisted login as anonymous", async () => {
    const aliceId = await idOf("alice");
    const t = await open([aliceId]);
    await t.loginWithStub("alice");
    const me: { level: string; id: string } = await (await t.request("/api/auth/me")).json();
    expect(me).toMatchObject({ level: "user", id: aliceId });
    const draft = await createDraft(t, "listed");

    const other = await open([aliceId]);
    await other.loginWithStub("mallory");
    const them: { level: string } = await (await other.request("/api/auth/me")).json();
    expect(them.level).toBe("anonymous");
    const refused = await other.request("/api/posts", json("POST", { title: "unlisted", body: "" }));
    expect(refused.status).toBe(401);
    const body: { error: { code: string } } = await refused.json();
    expect(body.error.code).toBe("AUTH.UNAUTHENTICATED");
    const page: PostPage = await (await other.request("/api/posts")).json();
    expect(page.posts.every((p) => p.status === "published")).toBe(true);
    expect((await other.request(`/api/posts/${draft}`)).status).toBe(404);
  });
});
