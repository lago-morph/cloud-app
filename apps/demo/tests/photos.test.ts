import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { describe, expect, it } from "vitest";
import type { PhotoUpload, PostDetail, StoredPhoto } from "../src/shared/types";
import { attachPhoto, createDraft, errorCode, jpegBytes, json, open, sendTicket, sha256, type WireTicket } from "./support";

describe("photos (DEMO-AC-003)", () => {
  it("uploads a 20 MB JPEG, shows it in the post and downloads it byte-identical", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const draft = await createDraft(alice);
    const bytes = jpegBytes(20 * 1024 * 1024);
    const res = await attachPhoto(alice, draft, bytes);
    expect(res.status).toBe(201);
    const stored: StoredPhoto = await res.json();
    expect(stored).toMatchObject({ size: bytes.byteLength, contentType: "image/jpeg" });

    const detail: PostDetail<WireTicket> = await (await alice.request(`/api/posts/${draft}`)).json();
    expect(detail.photos.map((p) => p.id)).toEqual([stored.id]);
    const [photo] = detail.photos;
    if (photo === undefined) throw new Error("no photo");
    const download = await sendTicket(alice, photo.ticket);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/jpeg");
    expect(await sha256(await download.arrayBuffer())).toBe(await sha256(bytes));
  });

  it("accepts PNG, refuses other types, and lets only the author attach to their draft", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const draft = await createDraft(alice);
    expect((await attachPhoto(alice, draft, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), "image/png")).status).toBe(201);
    const gif = await alice.request(`/api/posts/${draft}/photos/upload-ticket`, json("POST", { contentType: "image/gif" }));
    expect(gif.status).toBe(400);
    const bob = await t.as(mockUsers.user("bob")).request(`/api/posts/${draft}/photos/upload-ticket`, json("POST", { contentType: "image/png" }));
    expect(bob.status).toBe(404);
    const anon = await t.as(mockUsers.anonymous).request(`/api/posts/${draft}/photos/upload-ticket`, json("POST", { contentType: "image/png" }));
    expect(anon.status).toBe(401);
  });

  it("refuses an empty upload and finalizing a missing one", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    const draft = await createDraft(t);
    const empty = await attachPhoto(t, draft, new Uint8Array(0));
    expect(empty.status).toBe(409);
    expect(await errorCode(empty)).toBe("HTTP.CONFLICT");
    const missing = await t.request(`/api/posts/${draft}/photos`, json("POST", { id: crypto.randomUUID() }));
    expect(missing.status).toBe(404);
  });

  it("enforces the configured maximum per post", async () => {
    const t = await open({ user: mockUsers.user("alice"), config: { maxPhotosPerPost: 2 } });
    const draft = await createDraft(t);
    for (let i = 0; i < 2; i += 1) expect((await attachPhoto(t, draft, jpegBytes(100))).status).toBe(201);
    const third = await t.request(`/api/posts/${draft}/photos/upload-ticket`, json("POST", { contentType: "image/jpeg" }));
    expect(third.status).toBe(409);
    expect(await errorCode(third)).toBe("HTTP.CONFLICT");
  });

  it("refuses finalizing past the maximum and deletes that upload", async () => {
    const t = await open({ user: mockUsers.user("alice"), config: { maxPhotosPerPost: 1 } });
    const draft = await createDraft(t);
    // A ticket taken while the post still had room; another photo is finalized before it.
    const late: PhotoUpload<WireTicket> = await (await t.request(`/api/posts/${draft}/photos/upload-ticket`, json("POST", { contentType: "image/jpeg" }))).json();
    expect((await attachPhoto(t, draft, jpegBytes(10))).status).toBe(201);
    await sendTicket(t, late.ticket, jpegBytes(10));
    const res = await t.request(`/api/posts/${draft}/photos`, json("POST", { id: late.id }));
    expect(res.status).toBe(409);
    expect((await t.request(`/api/posts/${draft}/photos`, json("POST", { id: late.id }))).status).toBe(404);
  });

  it("deleting a post removes its photo records and files", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    const draft = await createDraft(t);
    expect((await attachPhoto(t, draft, jpegBytes(1000))).status).toBe(201);
    const detail: PostDetail<WireTicket> = await (await t.request(`/api/posts/${draft}`)).json();
    const [photo] = detail.photos;
    if (photo === undefined) throw new Error("no photo");
    expect((await sendTicket(t, photo.ticket)).status).toBe(200);

    expect((await t.request(`/api/posts/${draft}`, json("DELETE"))).status).toBe(204);
    expect((await t.request(`/api/posts/${draft}`)).status).toBe(404);
    expect((await sendTicket(t, photo.ticket)).status).toBe(404);
    expect(t.logs().filter((e) => e.severity === "warn")).toEqual([]);
  });

  it("logs a warn entry when deleting the files fails, and still deletes the post", async () => {
    const t = await open({ user: mockUsers.user("alice"), unavailable: ["files"] });
    const draft = await createDraft(t);
    expect((await t.request(`/api/posts/${draft}`, json("DELETE"))).status).toBe(204);
    expect((await t.request(`/api/posts/${draft}`)).status).toBe(404);
    const warnings = t.logs().filter((e) => e.component === "photos" && e.severity === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain(draft);
    expect(t.logs().filter((e) => e.component === "posts" && e.severity === "info")).toHaveLength(1);
  });
});
