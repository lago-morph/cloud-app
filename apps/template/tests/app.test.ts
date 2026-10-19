import { createTestApp, mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { afterEach, describe, expect, it } from "vitest";
import app from "../src/app";
import type { FileList, Greeting, NoteList, SecretCheck, Status } from "../src/shared/types";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

let opened: TestApp[] = [];
async function open(options?: Parameters<typeof createTestApp>[1]): Promise<TestApp> {
  const t = await createTestApp(app, options);
  opened.push(t);
  return t;
}

afterEach(async () => {
  await Promise.all(opened.map((t) => t.dispose()));
  opened = [];
});

describe("configuration", () => {
  it("serves the default greeting", async () => {
    const t = await open();
    const body: Greeting = await (await t.request("/api/hello")).json();
    expect(body).toEqual({ greeting: "Hello" });
  });

  it("serves the greeting configured for the stage", async () => {
    const t = await open({ config: { greeting: "Hi there" } });
    const body: Greeting = await (await t.request("/api/hello")).json();
    expect(body).toEqual({ greeting: "Hi there" });
  });
});

describe("notes (SQL, log)", () => {
  it("refuses anonymous requests", async () => {
    const t = await open();
    const res = await t.request("/api/notes");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "AUTH.UNAUTHENTICATED" } });
  });

  it("lists only the user's own notes, newest first, and logs each creation", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const bob = t.as(mockUsers.user("bob"));
    expect((await alice.request("/api/notes", json("POST", { text: "first" }))).status).toBe(201);
    expect((await alice.request("/api/notes", json("POST", { text: "second" }))).status).toBe(201);
    expect((await bob.request("/api/notes", json("POST", { text: "bob's" }))).status).toBe(201);

    const body: NoteList = await (await alice.request("/api/notes")).json();
    expect(body.notes.map((n) => n.text)).toEqual(["second", "first"]);
    expect(t.logs().filter((e) => e.component === "notes" && e.severity === "info")).toHaveLength(3);
  });

  it("rejects an empty note", async () => {
    const t = await open({ user: mockUsers.user() });
    const res = await t.request("/api/notes", json("POST", { text: "  " }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "HTTP.INVALID_INPUT" } });
  });
});

describe("status (KV)", () => {
  it("is null until set, then reads back per user", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const before: Status = await (await alice.request("/api/status")).json();
    expect(before).toEqual({ status: null });
    expect((await alice.request("/api/status", json("PUT", { status: "busy" }))).status).toBe(200);
    const after: Status = await (await alice.request("/api/status")).json();
    expect(after).toEqual({ status: "busy" });
    const bob: Status = await (await t.as(mockUsers.user("bob")).request("/api/status")).json();
    expect(bob).toEqual({ status: null });
  });
});

describe("files", () => {
  it("lists no files at first and issues an upload ticket", async () => {
    const t = await open({ user: mockUsers.user() });
    const list: FileList = await (await t.request("/api/files")).json();
    expect(list).toEqual({ files: [] });
    const res = await t.request("/api/files/upload-ticket", json("POST", { name: "a.txt", contentType: "text/plain" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("ticket");
  });

  it("refuses a download ticket for a missing file and a name with a slash", async () => {
    const t = await open({ user: mockUsers.user() });
    const missing = await t.request("/api/files/download-ticket", json("POST", { name: "nope.txt" }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "FILES.NOT_FOUND" } });
    const slash = await t.request("/api/files/upload-ticket", json("POST", { name: "../x", contentType: "text/plain" }));
    expect(slash.status).toBe(400);
  });
});

describe("admin (secrets, access levels)", () => {
  it("refuses a user and lets an admin check the secret", async () => {
    const t = await open({ secrets: { apiKey: "test-api-key" } });
    expect((await t.as(mockUsers.user()).request("/api/admin/secret")).status).toBe(403);
    const res = await t.as(mockUsers.admin()).request("/api/admin/secret");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("test-api-key");
    const body: SecretCheck = JSON.parse(text);
    expect(body).toEqual({ configured: true });
  });

  it("reports a missing secret without revealing anything", async () => {
    const t = await open({ user: mockUsers.admin() });
    const res = await t.request("/api/admin/secret");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "SEC.MISSING" } });
  });
});
