import { FrameworkError, jsonBody, newId, now, requireUser, z, type UploadTicket } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { PhotoUpload, StoredPhoto } from "../../shared/types";
import type { Env } from "../env";
import { loadOwnDraft, photoCount, photoFileName, postIdParam } from "../posts";
import { photos } from "../schema";

/** Accepted photo types (DEMO-REQ-003). There is no app size limit: files go straight to storage. */
const PHOTO_TYPES = ["image/jpeg", "image/png"] as const;

const uploadRequest = z.object({ contentType: z.enum(PHOTO_TYPES) });
/** The display name is a record field, never part of the storage name. */
const finalizeRequest = z.object({ photoId: z.uuid(), name: z.string().trim().min(1).max(200).regex(/^[^/\\]+$/) });

/** Photos on a draft: an upload ticket, then a finalize check that creates the row (the safe upload pattern). */
export function photoRoutes(api: Hono<Env>): void {
  api.post("/posts/:id/photos/upload-ticket", requireUser(), jsonBody(uploadRequest), async (c) => {
    const post = await loadOwnDraft(c.var.sql, c.var.user, postIdParam(c.req.param("id")));
    const max = c.var.config.get("maxPhotosPerPost");
    if ((await photoCount(c.var.sql, post.id)) >= max) {
      throw new FrameworkError("HTTP.CONFLICT", `a post can have at most ${max} photos`);
    }
    const photoId = newId();
    const { contentType } = c.req.valid("json");
    const ticket = await c.var.files.createUploadTicket(photoFileName(post.id, photoId), { contentType });
    const body: PhotoUpload<UploadTicket> = { photoId, ticket };
    return c.json(body);
  });

  // Called by the browser after `uploadFile` resolves. Nothing shows the photo until this creates its row.
  api.post("/posts/:id/photos/finalize", requireUser(), jsonBody(finalizeRequest), async (c) => {
    const post = await loadOwnDraft(c.var.sql, c.var.user, postIdParam(c.req.param("id")));
    const { photoId, name } = c.req.valid("json");
    const fileName = photoFileName(post.id, photoId);
    const file = await c.var.files.head(fileName);
    if (file === null) throw new FrameworkError("HTTP.NOT_FOUND", "no such upload");
    const accepted: readonly string[] = PHOTO_TYPES;
    if (!accepted.includes(file.contentType)) {
      await c.var.files.delete(fileName);
      throw new FrameworkError("HTTP.CONFLICT", `photos must be one of: ${PHOTO_TYPES.join(", ")}`);
    }
    const max = c.var.config.get("maxPhotosPerPost");
    if ((await photoCount(c.var.sql, post.id)) >= max) {
      await c.var.files.delete(fileName);
      throw new FrameworkError("HTTP.CONFLICT", `a post can have at most ${max} photos`);
    }
    const row: StoredPhoto = { id: photoId, name, size: file.size, contentType: file.contentType };
    await c.var.sql.insert(photos).values({ ...row, postId: post.id, createdAt: now() });
    return c.json(row, 201);
  });
}
