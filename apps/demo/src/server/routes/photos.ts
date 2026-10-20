import { FrameworkError, jsonBody, newId, now, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Photo } from "../../shared/types";
import type { Env } from "../env";
import { ownDraft, photoCount, photoName, type Ticket } from "../posts";
import { photos } from "../schema";

const ACCEPTED_TYPES = ["image/jpeg", "image/png"] as const;

const ticketRequest = z.object({ contentType: z.enum(ACCEPTED_TYPES) });
const finalizeRequest = z.object({ photoId: z.uuid() });

/**
 * Photos (FILES, DEMO-REQ-003): the author of a draft asks for an upload ticket, the browser sends the
 * file straight to storage, and a finalize route checks it before its row makes it visible. No size limit
 * of our own: files go to storage directly, so any size the framework supports works.
 */
export function photoRoutes(api: Hono<Env>): void {
  api.post("/posts/:id/photos/upload-ticket", requireUser(), jsonBody(ticketRequest), async (c) => {
    const post = await ownDraft(c.var.sql, c.var.user, c.req.param("id"));
    const max = c.var.config.get("maxPhotosPerPost");
    if ((await photoCount(c.var.sql, post.id)) >= max) throw new FrameworkError("HTTP.CONFLICT", `a post has at most ${max} photos`);
    const photoId = newId();
    const ticket = await c.var.files.createUploadTicket(photoName(post.id, photoId), { contentType: c.req.valid("json").contentType });
    return c.json({ photoId, ticket });
  });

  api.post("/posts/:id/photos/finalize", requireUser(), jsonBody(finalizeRequest), async (c) => {
    const post = await ownDraft(c.var.sql, c.var.user, c.req.param("id"));
    const { photoId } = c.req.valid("json");
    const file = await c.var.files.head(photoName(post.id, photoId));
    if (file === null) throw new FrameworkError("HTTP.NOT_FOUND", "no such upload");
    const accepted: readonly string[] = ACCEPTED_TYPES;
    if (!accepted.includes(file.contentType)) {
      await c.var.files.delete(file.name);
      throw new FrameworkError("HTTP.CONFLICT", `photos must be one of: ${ACCEPTED_TYPES.join(", ")}`);
    }
    const max = c.var.config.get("maxPhotosPerPost");
    if ((await photoCount(c.var.sql, post.id)) >= max) {
      await c.var.files.delete(file.name);
      throw new FrameworkError("HTTP.CONFLICT", `a post has at most ${max} photos`);
    }
    await c.var.sql.insert(photos).values({ id: photoId, postId: post.id, contentType: file.contentType, size: file.size, createdAt: now() });
    const ticket = await c.var.files.createDownloadTicket(file.name);
    const result: Photo<Ticket> = { id: photoId, contentType: file.contentType, size: file.size, ticket };
    return c.json(result, 201);
  });
}
