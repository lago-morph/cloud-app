import { FrameworkError, now, requireUser } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { PostDetail, ShareLink } from "../../shared/types";
import type { Env } from "../env";
import { loadPost, ownDraft, postDetail, type Ticket } from "../posts";
import { signToken, verifyToken } from "../signing";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Share links (SECRETS, DEMO-REQ-007): signed with `shareKey`, valid for the configured number of days. */
export function shareRoutes(api: Hono<Env>): void {
  api.post("/posts/:id/share", requireUser(), async (c) => {
    const post = await ownDraft(c.var.sql, c.var.user, c.req.param("id"));
    const expiresAt = now() + c.var.config.get("shareLinkDays") * DAY_MS;
    const token = await signToken(await c.var.secrets.get("shareKey"), post.id, expiresAt);
    const result: ShareLink = { token, path: `/share/${token}`, expiresAt };
    return c.json(result, 201);
  });

  // Anyone holding a valid link sees the post; an altered, expired or unknown link looks missing.
  api.get("/shared/:token", async (c) => {
    const postId = await verifyToken(await c.var.secrets.get("shareKey"), c.req.param("token"));
    const post = postId === null ? null : await loadPost(c.var.sql, postId);
    if (post === null) throw new FrameworkError("HTTP.NOT_FOUND", "share link not found");
    const result: PostDetail<Ticket> = await postDetail(c.var.sql, c.var.files, post);
    return c.json(result);
  });
}
