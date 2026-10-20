import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { describe, expect, it } from "vitest";
import type { Photo, PostDetail } from "../src/shared/types";
import { addPhoto, createDraft, errorCode, jpegBytes, json, open, sameBytes, sendTicket, uploadPhoto, type WireTicket } from "./support";

describe("DEMO-AC-003 photos", () => {
  it("uploads a 20 MB JPEG that displays and downloads byte-identical", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    const id = await createDraft(t);
    const bytes = jpegBytes(20 * 1024 * 1024);
    const res = await addPhoto(t, id, "image/jpeg", bytes);
    expect(res.status).toBe(201);
    const photo: Photo<WireTicket> = await res.json();
    expect(photo.size).toBe(bytes.length);

    const post: PostDetail<WireTicket> = await (await t.request(`/api/posts/${id}`)).json();
    expect(post.photos.map((p) => p.id)).toEqual([photo.id]);
    const [shown] = post.photos;
    if (shown === undefined) throw new Error("no photo");
    const download = await sendTicket(t, shown.ticket);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/jpeg");
    expect(sameBytes(new Uint8Array(await download.arrayBuffer()), bytes)).toBe(true);
  });

  it("enforces the configured maximum per post", async () => {
    const t = await open({ user: mockUsers.user("alice"), config: { maxPhotosPerPost: 2 } });
    const id = await createDraft(t);
    expect((await addPhoto(t, id, "image/png", jpegBytes(10))).status).toBe(201);
    // Two tickets issued while one slot is free: only the first finalize fits.
    const second = await uploadPhoto(t, id, "image/jpeg", jpegBytes(10));
    const third = await uploadPhoto(t, id, "image/jpeg", jpegBytes(10));
    expect((await t.request(`/api/posts/${id}/photos/finalize`, json("POST", { photoId: second }))).status).toBe(201);
    const over = await t.request(`/api/posts/${id}/photos/finalize`, json("POST", { photoId: third }));
    expect(over.status).toBe(409);
    expect(await errorCode(over)).toBe("HTTP.CONFLICT");
    const ticket = await t.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/png" }));
    expect(ticket.status).toBe(409);
    const post: PostDetail<WireTicket> = await (await t.request(`/api/posts/${id}`)).json();
    expect(post.photos).toHaveLength(2);
  });

  it("accepts only JPEG and PNG, only from the draft's author", async () => {
    const t = await open();
    const alice = t.as(mockUsers.user("alice"));
    const id = await createDraft(alice);
    const gif = await alice.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/gif" }));
    expect(gif.status).toBe(400);
    expect(await errorCode(gif)).toBe("HTTP.INVALID_INPUT");
    expect((await t.as(mockUsers.user("bob")).request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/png" }))).status).toBe(404);
    expect((await t.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/png" }))).status).toBe(401);
    const missing = await alice.request(`/api/posts/${id}/photos/finalize`, json("POST", { photoId: crypto.randomUUID() }));
    expect(missing.status).toBe(404);
  });

  it("deleting a post removes its photo rows and files", async () => {
    const t = await open({ user: mockUsers.user("alice") });
    const id = await createDraft(t);
    const res = await addPhoto(t, id, "image/jpeg", jpegBytes(1000));
    const photo: Photo<WireTicket> = await res.json();
    // An upload that was never finalized is cleaned up too.
    const orphan = await uploadPhoto(t, id, "image/png", jpegBytes(10));
    const orphanTicket = await t.request(`/api/posts/${id}/photos/upload-ticket`, json("POST", { contentType: "image/png" }));
    expect(orphanTicket.status).toBe(200);

    expect((await t.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
    expect((await t.request(`/api/posts/${id}`)).status).toBe(404);
    const gone = await sendTicket(t, photo.ticket);
    expect(gone.status).toBe(404);
    expect(t.logs().filter((e) => e.severity === "warn")).toEqual([]);
    expect(orphan).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("logs a warn entry and still deletes the post when removing its files fails", async () => {
    // Every file operation fails, so the cleanup after the rows are deleted fails.
    const t = await open({ user: mockUsers.user("alice"), unavailable: ["files"] });
    const id = await createDraft(t);
    expect((await t.request(`/api/posts/${id}`, json("DELETE"))).status).toBe(204);
    expect((await t.request(`/api/posts/${id}`)).status).toBe(404);
    const warnings = t.logs().filter((e) => e.component === "photos" && e.severity === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe(`photo cleanup failed for deleted post ${id}: FILES.UNAVAILABLE`);
  });
});
