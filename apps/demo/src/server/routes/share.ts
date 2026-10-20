import { FrameworkError, now, requireUser } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { PostDetail, ShareLink } from "../../shared/types";
import { detail, editablePost, findPost } from "../access";
import type { Env } from "../env";
import { signToken, verifyToken } from "../signing";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Share links (DEMO-REQ-007): signed with the `shareKey` secret, valid for the configured number of days. */
export function shareRoutes(api: Hono<Env>): void {
  api.post("/posts/:id/share", requireUser(), async (c) => {
    const post = await editablePost(c.var.sql, c.req.param("id"), c.var.user);
    const expiresAt = now() + c.var.config.get("shareLinkDays") * DAY_MS;
    const token = await signToken(await c.var.secrets.get("shareKey"), post.id, expiresAt);
    const result: ShareLink = { token, expiresAt };
    return c.json(result, 201);
  });

  // An altered, foreign or expired link answers 404, like a missing post.
  api.get("/shared/:token", async (c) => {
    const postId = await verifyToken(await c.var.secrets.get("shareKey"), c.req.param("token"));
    const post = postId === null ? null : await findPost(c.var.sql, postId);
    if (post === null) throw new FrameworkError("HTTP.NOT_FOUND", "this link is invalid or has expired");
    const result: PostDetail = await detail(c.var.sql, post, c.var.user);
    return c.json(result);
  });
}
