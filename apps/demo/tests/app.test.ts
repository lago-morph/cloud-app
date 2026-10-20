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

/** The in-process upload ticket's wire form (files.md §2), so the test can send what `uploadFile` sends. */
interface WireUploadTicket {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
}

async function upload(t: TestApp, contentType: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const res = await t.request("/api/files/upload-ticket", json("POST", { contentType }));
  expect(res.status).toBe(200);
  const { id, ticket }: { id: string; ticket: WireUploadTicket } = await res.json();
  const put = await t.request(ticket.url, { method: ticket.method, headers: ticket.headers, body: bytes });
  expect(put.status).toBeLessThan(300);
  return id;
}

describe("files", () => {
  it("lists an upload only after finalize, and only to its owner", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const bob = t.as(mockUsers.user("bob"));
    const id = await upload(alice, "text/plain", new TextEncoder().encode("hello"));
    const before: FileList = await (await alice.request("/api/files")).json();
    expect(before).toEqual({ files: [] });

    const res = await alice.request("/api/files/finalize", json("POST", { id, name: "a.txt" }));
    expect(res.status).toBe(201);
    const after: FileList = await (await alice.request("/api/files")).json();
    expect(after).toEqual({ files: [{ id, name: "a.txt", size: 5, contentType: "text/plain" }] });

    const bobs: FileList = await (await bob.request("/api/files")).json();
    expect(bobs).toEqual({ files: [] });
    expect((await bob.request("/api/files/finalize", json("POST", { id, name: "a.txt" }))).status).toBe(404);
    const theirs = await bob.request("/api/files/download-ticket", json("POST", { id }));
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toMatchObject({ error: { code: "HTTP.NOT_FOUND" } });
    const mine = await alice.request("/api/files/download-ticket", json("POST", { id }));
    expect(mine.status).toBe(200);
    expect(await mine.json()).toHaveProperty("ticket");
  });

  it("deletes an upload that is too large or of a type it does not accept", async () => {
    const t = await open({ user: mockUsers.user() });
    const big = await upload(t, "text/plain", new Uint8Array(10 * 1024 * 1024 + 1));
    const zip = await upload(t, "application/zip", new Uint8Array(4));
    for (const id of [big, zip]) {
      const res = await t.request("/api/files/finalize", json("POST", { id, name: "x" }));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "HTTP.CONFLICT" } });
      // The upload is gone, so a second finalize finds nothing.
      expect((await t.request("/api/files/finalize", json("POST", { id, name: "x" }))).status).toBe(404);
    }
    const list: FileList = await (await t.request("/api/files")).json();
    expect(list).toEqual({ files: [] });
  });

  it("refuses to finalize a missing upload and a name with a slash", async () => {
    const t = await open({ user: mockUsers.user() });
    const missing = await t.request("/api/files/finalize", json("POST", { id: crypto.randomUUID(), name: "a.txt" }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "HTTP.NOT_FOUND" } });
    const slash = await t.request("/api/files/finalize", json("POST", { id: crypto.randomUUID(), name: "../x" }));
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
