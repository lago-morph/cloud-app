import { FrameworkError, count, eq, jsonBody, newId, now, requireUser, z, type PortableDb, type UploadTicket } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { PhotoUpload, StoredPhoto } from "../../shared/types";
import { ownDraft, parseId, photoName } from "../access";
import type { Env } from "../env";
import { photos } from "../schema";

const ACCEPTED_TYPES: readonly string[] = ["image/jpeg", "image/png"];

const ticketRequest = z.object({ contentType: z.enum(["image/jpeg", "image/png"]) });
const finalizeRequest = z.object({ id: z.uuid() });

async function photoCount(db: PortableDb, postId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(photos).where(eq(photos.postId, postId));
  return row?.n ?? 0;
}

/** FILES: the author uploads photos to a draft with tickets; finalize checks each upload before it is shown. */
export function photoRoutes(api: Hono<Env>): void {
  api.post("/posts/:id/photos/upload-ticket", requireUser(), jsonBody(ticketRequest), async (c) => {
    const post = await ownDraft(c.var.sql, c.var.user, parseId(c.req.param("id")));
    const max = c.var.config.get("maxPhotosPerPost");
    if ((await photoCount(c.var.sql, post.id)) >= max) throw new FrameworkError("HTTP.CONFLICT", `a post has at most ${max} photos`);
    const id = newId();
    const ticket = await c.var.files.createUploadTicket(photoName(post.id, id), { contentType: c.req.valid("json").contentType });
    const body: PhotoUpload<UploadTicket> = { id, ticket };
    return c.json(body);
  });

  // Called by the browser after `uploadFile` resolves. Nothing shows the photo until this creates its row.
  api.post("/posts/:id/photos", requireUser(), jsonBody(finalizeRequest), async (c) => {
    const post = await ownDraft(c.var.sql, c.var.user, parseId(c.req.param("id")));
    const { id } = c.req.valid("json");
    const file = await c.var.files.head(photoName(post.id, id));
    if (file === null) throw new FrameworkError("HTTP.NOT_FOUND", "no such upload");
    if (file.size === 0 || !ACCEPTED_TYPES.includes(file.contentType)) {
      await c.var.files.delete(file.name);
      throw new FrameworkError("HTTP.CONFLICT", `photos must be non-empty and one of: ${ACCEPTED_TYPES.join(", ")}`);
    }
    const max = c.var.config.get("maxPhotosPerPost");
    if ((await photoCount(c.var.sql, post.id)) >= max) {
      await c.var.files.delete(file.name);
      throw new FrameworkError("HTTP.CONFLICT", `a post has at most ${max} photos`);
    }
    const row: StoredPhoto = { id, size: file.size, contentType: file.contentType };
    await c.var.sql.insert(photos).values({ ...row, postId: post.id, createdAt: now() });
    return c.json(row, 201);
  });
}
