import { FrameworkError, and, desc, eq, jsonBody, newId, now, queryParams, requireAdmin, requireUser, z } from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Created, DraftList, PostPage } from "../../shared/types";
import type { Env } from "../env";
import { deletePost, loadOwnDraft, loadVisiblePost, postIdParam, summaryColumns, toSummary, withPhotos } from "../posts";
import { pageSizeFor } from "../preferences";
import { posts } from "../schema";

const newPost = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(20_000),
});

const postChange = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().max(20_000).optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

/** Posts (DEMO-REQ-001, DEMO-REQ-002, DEMO-REQ-008). */
export function postRoutes(api: Hono<Env>): void {
  // Anyone: published posts, newest first, one page at a time.
  api.get("/posts", queryParams(listQuery), async (c) => {
    const query = c.req.valid("query");
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? (await pageSizeFor(c.var.kv, c.var.user));
    const rows = await c.var.sql
      .select(summaryColumns)
      .from(posts)
      .where(eq(posts.status, "published"))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(pageSize + 1)
      .offset((page - 1) * pageSize);
    const body: PostPage = { posts: rows.slice(0, pageSize).map(toSummary), page, pageSize, hasMore: rows.length > pageSize };
    return c.json(body);
  });

  // A user's own drafts.
  api.get("/my/drafts", requireUser(), async (c) => {
    const rows = await c.var.sql
      .select(summaryColumns)
      .from(posts)
      .where(and(eq(posts.authorId, c.var.user.id), eq(posts.status, "draft")))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(50);
    const body: DraftList = { posts: rows.map(toSummary) };
    return c.json(body);
  });

  api.get("/posts/:id", async (c) => {
    const row = await loadVisiblePost(c.var.sql, c.var.user, postIdParam(c.req.param("id")));
    return c.json(await withPhotos(c.var.sql, c.var.files, row));
  });

  api.post("/posts", requireUser(), jsonBody(newPost), async (c) => {
    const { title, body } = c.req.valid("json");
    const id = newId();
    const at = now();
    await c.var.sql.insert(posts).values({ id, authorId: c.var.user.id, title, body, status: "draft", createdAt: at, updatedAt: at });
    const created: Created = { id };
    return c.json(created, 201);
  });

  api.patch("/posts/:id", requireUser(), jsonBody(postChange), async (c) => {
    const row = await loadOwnDraft(c.var.sql, c.var.user, postIdParam(c.req.param("id")));
    const change = c.req.valid("json");
    const changed = await c.var.sql
      .update(posts)
      .set({ title: change.title ?? row.title, body: change.body ?? row.body, updatedAt: now() })
      .where(and(eq(posts.id, row.id), eq(posts.status, "draft")))
      .returning({ id: posts.id });
    if (changed.length === 0) throw new FrameworkError("HTTP.CONFLICT", "the post is no longer a draft");
    const updated = await loadVisiblePost(c.var.sql, c.var.user, row.id);
    return c.json(await withPhotos(c.var.sql, c.var.files, updated));
  });

  // The author deletes an own draft; an admin deletes any post.
  api.delete("/posts/:id", requireUser(), async (c) => {
    const postId = postIdParam(c.req.param("id"));
    if (c.var.user.level !== "admin") await loadOwnDraft(c.var.sql, c.var.user, postId);
    else await loadVisiblePost(c.var.sql, c.var.user, postId);
    await deletePost(c.var.sql, c.var.files, c.var.log, postId);
    return c.body(null, 204);
  });

  for (const [action, status] of [
    ["publish", "published"],
    ["unpublish", "draft"],
  ] as const) {
    api.post(`/posts/:id/${action}`, requireAdmin(), async (c) => {
      const row = await loadVisiblePost(c.var.sql, c.var.user, postIdParam(c.req.param("id")));
      await c.var.sql.update(posts).set({ status, updatedAt: now() }).where(eq(posts.id, row.id));
      c.var.log.write("posts", "info", `post ${row.id} ${action}ed by ${c.var.user.id}`);
      const updated = await loadVisiblePost(c.var.sql, c.var.user, row.id);
      return c.json(toSummary(updated));
    });
  }
}
