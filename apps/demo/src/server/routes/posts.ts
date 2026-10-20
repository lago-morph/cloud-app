import { FrameworkError, and, atomic, desc, eq, jsonBody, newId, now, queryParams, requireAdmin, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Created, DraftList, PostDetail, PostPage } from "../../shared/types";
import { canDelete, detail, editablePost, findPost, isAuthor, photosOf, postColumns, summary, toStatus, visiblePost } from "../access";
import { cleanUpPostFiles } from "../cleanup";
import type { Env } from "../env";
import { readPerPage } from "../preferences";
import { photos, posts } from "../schema";

const title = z.string().trim().min(1).max(120);
const body = z.string().max(20_000);
const newPost = z.object({ title, body });
const postChange = z.object({ title: title.optional(), body: body.optional() });
const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  perPage: z.coerce.number().int().min(1).max(50).optional(),
});

/** Posts (DEMO-REQ-001, DEMO-REQ-002, DEMO-REQ-008): public list and view, own drafts, admin moderation. */
export function postRoutes(api: Hono<Env>): void {
  // Published posts, newest first, a page at a time. Without `perPage`, a logged-in user's preference applies.
  api.get("/posts", queryParams(listQuery), async (c) => {
    const query = c.req.valid("query");
    const page = query.page ?? 1;
    const perPage = query.perPage ?? (await readPerPage(c.var.kv, c.var.user));
    const rows = await c.var.sql
      .select(postColumns)
      .from(posts)
      .where(eq(posts.status, "published"))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(perPage + 1)
      .offset((page - 1) * perPage);
    const result: PostPage = { posts: rows.slice(0, perPage).map(summary), page, perPage, hasMore: rows.length > perPage };
    return c.json(result);
  });

  api.get("/my/drafts", requireUser(), async (c) => {
    const rows = await c.var.sql
      .select(postColumns)
      .from(posts)
      .where(and(eq(posts.authorId, c.var.user.id), eq(posts.status, "draft")))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(100);
    const result: DraftList = { posts: rows.map(summary) };
    return c.json(result);
  });

  api.get("/posts/:id", async (c) => {
    const post = await visiblePost(c.var.sql, c.req.param("id"), c.var.user);
    const result: PostDetail = await detail(c.var.sql, post, c.var.user);
    return c.json(result);
  });

  api.post("/posts", requireUser(), jsonBody(newPost), async (c) => {
    const input = c.req.valid("json");
    const id = newId();
    const at = now();
    await c.var.sql.insert(posts).values({
      id,
      authorId: c.var.user.id,
      authorName: c.var.user.displayName,
      title: input.title,
      body: input.body,
      status: "draft",
      createdAt: at,
      updatedAt: at,
    });
    const result: Created = { id };
    return c.json(result, 201);
  });

  api.patch("/posts/:id", requireUser(), jsonBody(postChange), async (c) => {
    const post = await editablePost(c.var.sql, c.req.param("id"), c.var.user);
    const input = c.req.valid("json");
    await c.var.sql
      .update(posts)
      .set({ title: input.title ?? post.title, body: input.body ?? post.body, updatedAt: now() })
      .where(eq(posts.id, post.id));
    const updated = await findPost(c.var.sql, post.id);
    if (updated === null) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
    const result: PostDetail = await detail(c.var.sql, updated, c.var.user);
    return c.json(result);
  });

  // Deletes the photo records and the post together, then the photo files (DEMO-REQ-003).
  api.delete("/posts/:id", requireUser(), async (c) => {
    const post = await visiblePost(c.var.sql, c.req.param("id"), c.var.user);
    if (!canDelete(post, c.var.user)) {
      throw new FrameworkError("AUTH.FORBIDDEN", isAuthor(post, c.var.user) ? "only an admin may delete a published post" : "only the author or an admin may delete this post");
    }
    const attached = await photosOf(c.var.sql, post.id);
    await atomic(c.var.sql, [(w) => w.delete(photos).where(eq(photos.postId, post.id)), (w) => w.delete(posts).where(eq(posts.id, post.id))]);
    c.var.log.write("posts", "info", `post ${post.id} deleted by ${c.var.user.id}`);
    await cleanUpPostFiles(c.var.files, c.var.log, post.id, attached.map((p) => p.id));
    return c.body(null, 204);
  });

  for (const [action, status] of [["publish", "published"], ["unpublish", "draft"]] as const) {
    api.post(`/posts/:id/${action}`, requireAdmin(), async (c) => {
      const post = await findPost(c.var.sql, c.req.param("id"));
      if (post === null) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
      if (toStatus(post.status) === status) throw new FrameworkError("HTTP.CONFLICT", `the post is already ${status === "draft" ? "a draft" : "published"}`);
      await c.var.sql.update(posts).set({ status, updatedAt: now() }).where(eq(posts.id, post.id));
      c.var.log.write("posts", "info", `post ${post.id} ${action}ed by ${c.var.user.id}`);
      const updated = await findPost(c.var.sql, post.id);
      if (updated === null) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
      const result: PostDetail = await detail(c.var.sql, updated, c.var.user);
      return c.json(result);
    });
  }
}
