import {
  FrameworkError,
  and,
  atomic,
  desc,
  eq,
  jsonBody,
  newId,
  now,
  queryParams,
  requireAdmin,
  requireUser,
  z,
  type FilesService,
} from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Created, DraftList, PostDetail, PostPage, PostSummary } from "../../shared/types";
import type { Env } from "../env";
import { loadPost, type Ticket, ownDraft, photoName, photoPrefix, postDetail, readPageSize, summary, toStatus, visiblePost } from "../posts";
import { photos, posts } from "../schema";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});
const title = z.string().trim().min(1).max(120);
const body = z.string().max(20_000);
const newPost = z.object({ title, body });
const postChange = z.object({ title: title.optional(), body: body.optional() });

const summaryColumns = {
  id: posts.id,
  title: posts.title,
  authorId: posts.authorId,
  status: posts.status,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
};

/**
 * Removes a deleted post's photo files: the finalized ones by name, then anything left under the
 * post's prefix (uploads never finalized). A failure is logged at `warn` and never fails the request (DEMO-REQ-003).
 */
async function removePhotoFiles(files: FilesService, log: (message: string) => void, postId: string, photoIds: readonly string[]): Promise<void> {
  try {
    for (const photoId of photoIds) await files.delete(photoName(postId, photoId));
    let cursor: string | null = null;
    do {
      const page = await files.list(photoPrefix(postId), cursor === null ? { limit: 1000 } : { limit: 1000, cursor });
      for (const item of page.items) await files.delete(item.name);
      cursor = page.nextCursor;
    } while (cursor !== null);
  } catch (error: unknown) {
    const reason = error instanceof FrameworkError ? error.code : error instanceof Error ? error.name : "unknown error";
    log(`photo cleanup failed for deleted post ${postId}: ${reason}`);
  }
}

/** Posts (SQL, log): public listing, drafts, publishing and deletion (DEMO-REQ-001, -002, -008). */
export function postRoutes(api: Hono<Env>): void {
  // Anyone: published posts, newest first, a page at a time. Logged-in users get their saved page size.
  api.get("/posts", queryParams(listQuery), async (c) => {
    const query = c.req.valid("query");
    const page = query.page ?? 1;
    const user = c.var.user;
    const pageSize = query.pageSize ?? (user.level === "anonymous" ? 10 : await readPageSize(c.var.kv, user.id));
    const rows = await c.var.sql
      .select(summaryColumns)
      .from(posts)
      .where(eq(posts.status, "published"))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(pageSize + 1)
      .offset((page - 1) * pageSize);
    const list: PostSummary[] = rows.slice(0, pageSize).map((r) => ({ ...r, status: toStatus(r.status) }));
    const result: PostPage = { posts: list, page, pageSize, hasMore: rows.length > pageSize };
    return c.json(result);
  });

  // The caller's own drafts.
  api.get("/drafts", requireUser(), async (c) => {
    const rows = await c.var.sql
      .select(summaryColumns)
      .from(posts)
      .where(and(eq(posts.authorId, c.var.user.id), eq(posts.status, "draft")))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(100);
    const result: DraftList = { posts: rows.map((r) => ({ ...r, status: toStatus(r.status) })) };
    return c.json(result);
  });

  api.get("/posts/:id", async (c) => {
    const post = await visiblePost(c.var.sql, c.var.user, c.req.param("id"));
    const result: PostDetail<Ticket> = await postDetail(c.var.sql, c.var.files, post);
    return c.json(result);
  });

  api.post("/posts", requireUser(), jsonBody(newPost), async (c) => {
    const { title: postTitle, body: postBody } = c.req.valid("json");
    const id = newId();
    const at = now();
    await c.var.sql.insert(posts).values({ id, authorId: c.var.user.id, title: postTitle, body: postBody, status: "draft", createdAt: at, updatedAt: at });
    const result: Created = { id };
    return c.json(result, 201);
  });

  // The author edits their own draft.
  api.patch("/posts/:id", requireUser(), jsonBody(postChange), async (c) => {
    const post = await ownDraft(c.var.sql, c.var.user, c.req.param("id"));
    const change = c.req.valid("json");
    const updated = {
      title: change.title ?? post.title,
      body: change.body ?? post.body,
      updatedAt: now(),
    };
    const rows = await c.var.sql
      .update(posts)
      .set(updated)
      .where(and(eq(posts.id, post.id), eq(posts.status, "draft")))
      .returning({ id: posts.id });
    if (rows.length === 0) throw new FrameworkError("HTTP.CONFLICT", "the post is no longer a draft");
    const result: PostSummary = summary({ ...post, ...updated });
    return c.json(result);
  });

  // The author deletes their own draft; an admin deletes any post. Rows first, then files.
  api.delete("/posts/:id", requireUser(), async (c) => {
    const user = c.var.user;
    const post = await visiblePost(c.var.sql, user, c.req.param("id"));
    if (user.level !== "admin") {
      if (post.authorId !== user.id) throw new FrameworkError("AUTH.FORBIDDEN", "only the author or an admin may delete this post");
      if (post.status !== "draft") throw new FrameworkError("AUTH.FORBIDDEN", "only an admin may delete a published post");
    }
    const photoRows = await c.var.sql.select({ id: photos.id }).from(photos).where(eq(photos.postId, post.id)).limit(1000);
    await atomic(c.var.sql, [(w) => w.delete(photos).where(eq(photos.postId, post.id)), (w) => w.delete(posts).where(eq(posts.id, post.id))]);
    c.var.log.write("posts", "info", `post ${post.id} deleted by ${user.id}`);
    await removePhotoFiles(
      c.var.files,
      (message) => c.var.log.write("photos", "warn", message),
      post.id,
      photoRows.map((p) => p.id),
    );
    return c.body(null, 204);
  });

  for (const [action, status] of [
    ["publish", "published"],
    ["unpublish", "draft"],
  ] as const) {
    api.post(`/posts/:id/${action}`, requireAdmin(), async (c) => {
      const post = await loadPost(c.var.sql, c.req.param("id"));
      if (post === null) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
      const updatedAt = now();
      await c.var.sql.update(posts).set({ status, updatedAt }).where(eq(posts.id, post.id));
      c.var.log.write("posts", "info", `post ${post.id} ${action}ed by ${c.var.user.id}`);
      const result: PostSummary = summary({ ...post, status, updatedAt });
      return c.json(result);
    });
  }
}
