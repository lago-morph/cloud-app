import { FrameworkError, count, eq, jsonBody, newId, now, requireUser, z, type PortableDb } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Photo } from "../../shared/types";
import { canView, editablePost, findPost, isRowId, photoFileName } from "../access";
import type { Env } from "../env";
import { photos } from "../schema";
import { verifyToken } from "../signing";

export const PHOTO_TYPES = ["image/jpeg", "image/png"] as const;
const ACCEPTED: readonly string[] = PHOTO_TYPES;

const uploadRequest = z.object({ contentType: z.enum(PHOTO_TYPES) });
/** The display name is a record field, never part of the storage name. */
const finalizeRequest = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(200).regex(/^[^/\\]+$/) });
const downloadRequest = z.object({ share: z.string().min(1).max(500).optional() });

async function photoCount(db: PortableDb, postId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(photos).where(eq(photos.postId, postId));
  return row?.n ?? 0;
}

/**
 * Photos (DEMO-REQ-003): the author of a draft uploads JPEG or PNG files straight to storage with a
 * ticket, so any size the framework supports works; a finalize route checks each upload and the
 * per-post maximum before the photo appears. Downloads go through tickets as well.
 */
export function photoRoutes(api: Hono<Env>): void {
  api.post("/posts/:id/photos/upload-ticket", requireUser(), jsonBody(uploadRequest), async (c) => {
    const post = await editablePost(c.var.sql, c.req.param("id"), c.var.user);
    const max = c.var.config.get("maxPhotosPerPost");
    if ((await photoCount(c.var.sql, post.id)) >= max) {
      throw new FrameworkError("HTTP.CONFLICT", `a post can have at most ${String(max)} photos`);
    }
    const id = newId();
    const { contentType } = c.req.valid("json");
    const ticket = await c.var.files.createUploadTicket(photoFileName(post.id, id), { contentType });
    return c.json({ id, ticket });
  });

  // Called by the browser after `uploadFile` resolves. Nothing shows the photo until this creates its row.
  api.post("/posts/:id/photos/finalize", requireUser(), jsonBody(finalizeRequest), async (c) => {
    const post = await editablePost(c.var.sql, c.req.param("id"), c.var.user);
    const { id, name } = c.req.valid("json");
    const file = await c.var.files.head(photoFileName(post.id, id));
    if (file === null) throw new FrameworkError("HTTP.NOT_FOUND", "no such upload");
    if (!ACCEPTED.includes(file.contentType)) {
      await c.var.files.delete(file.name);
      throw new FrameworkError("HTTP.CONFLICT", `photos must be one of: ${ACCEPTED.join(", ")}`);
    }
    const max = c.var.config.get("maxPhotosPerPost");
    if ((await photoCount(c.var.sql, post.id)) >= max) {
      await c.var.files.delete(file.name);
      throw new FrameworkError("HTTP.CONFLICT", `a post can have at most ${String(max)} photos`);
    }
    const row: Photo = { id, name, size: file.size, contentType: file.contentType };
    await c.var.sql.insert(photos).values({ ...row, postId: post.id, createdAt: now() });
    return c.json(row, 201);
  });

  // Anyone who may see the post gets a ticket; so does the holder of a valid share link for it.
  api.post("/photos/:id/download-ticket", jsonBody(downloadRequest), async (c) => {
    if (!isRowId(c.req.param("id"))) throw new FrameworkError("HTTP.NOT_FOUND", "no such photo");
    const [photo] = await c.var.sql
      .select({ id: photos.id, postId: photos.postId })
      .from(photos)
      .where(eq(photos.id, c.req.param("id")))
      .limit(1);
    if (photo === undefined) throw new FrameworkError("HTTP.NOT_FOUND", "no such photo");
    const post = await findPost(c.var.sql, photo.postId);
    if (post === null) throw new FrameworkError("HTTP.NOT_FOUND", "no such photo");
    let allowed = canView(post, c.var.user);
    const { share } = c.req.valid("json");
    if (!allowed && share !== undefined) {
      allowed = (await verifyToken(await c.var.secrets.get("shareKey"), share)) === post.id;
    }
    if (!allowed) throw new FrameworkError("HTTP.NOT_FOUND", "no such photo");
    const ticket = await c.var.files.createDownloadTicket(photoFileName(post.id, photo.id));
    return c.json({ ticket });
  });
}
