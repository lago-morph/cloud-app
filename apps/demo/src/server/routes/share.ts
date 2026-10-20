import { FrameworkError, eq, now, queryParams, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { ShareLink } from "../../shared/types";
import type { Env } from "../env";
import { loadOwnDraft, postIdParam, summaryColumns, withPhotos } from "../posts";
import { posts } from "../schema";
import { signToken, verifyToken } from "../signing";

const DAY_MS = 24 * 60 * 60 * 1000;

const sharedQuery = z.object({ token: z.string().min(1).max(500) });

/** Share links for drafts, signed with the `shareKey` secret (DEMO-REQ-007). */
export function shareRoutes(api: Hono<Env>): void {
  api.post("/posts/:id/share", requireUser(), async (c) => {
    const post = await loadOwnDraft(c.var.sql, c.var.user, postIdParam(c.req.param("id")));
    const expiresAt = now() + c.var.config.get("shareLinkDays") * DAY_MS;
    const token = await signToken(await c.var.secrets.get("shareKey"), post.id, expiresAt);
    const body: ShareLink = { token, expiresAt };
    return c.json(body, 201);
  });

  // Anyone with a valid link sees the post. An altered, expired or unknown link looks like a missing post.
  api.get("/shared", queryParams(sharedQuery), async (c) => {
    const subject = await verifyToken(await c.var.secrets.get("shareKey"), c.req.valid("query").token);
    const postId = subject === null ? null : z.uuid().safeParse(subject);
    if (postId === null || !postId.success) throw new FrameworkError("HTTP.NOT_FOUND", "share link not found");
    const [row] = await c.var.sql
      .select({ ...summaryColumns, body: posts.body })
      .from(posts)
      .where(eq(posts.id, postId.data));
    if (row === undefined) throw new FrameworkError("HTTP.NOT_FOUND", "share link not found");
    return c.json(await withPhotos(c.var.sql, c.var.files, row));
  });
}
