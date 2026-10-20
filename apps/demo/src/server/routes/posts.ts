import {
  FrameworkError,
  and,
  asc,
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
  type DownloadTicket,
  type PortableDb,
} from "@lago-morph/prototype-framework";
import type { Hono } from "hono";
import type { Created, Photo, Post, PostDetail, PostList, PostPage, PostSummary, ShareLink } from "../../shared/types";
import { findPost, ownDraft, parseId, photoName, photoPrefix, toStatus, visiblePost } from "../access";
import type { Env } from "../env";
import { photos, posts } from "../schema";
import { signToken, verifyToken } from "../signing";
import { readPerPage } from "./site";

/** What a handler sees on `c.var`, for helpers shared by guarded and open routes. */
type Vars = Env["Variables"];

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PER_PAGE = 10;

const postInput = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(20_000),
});
const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  perPage: z.coerce.number().int().min(1).max(50).optional(),
});
const tokenPattern = z.string().min(1).max(300);

const summaryColumns = {
  id: posts.id,
  title: posts.title,
  authorId: posts.authorId,
  authorName: posts.authorName,
  status: posts.status,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
};

function summaries(rows: readonly (Omit<PostSummary, "status"> & { readonly status: string })[]): PostSummary[] {
  return rows.map((r) => ({ ...r, status: toStatus(r.status) }));
}

/** The post with fresh download tickets for its photos. */
async function detail(c: { readonly var: Vars }, post: Post): Promise<PostDetail<DownloadTicket>> {
  const rows = await c.var.sql
    .select({ id: photos.id, size: photos.size, contentType: photos.contentType })
    .from(photos)
    .where(eq(photos.postId, post.id))
    .orderBy(asc(photos.createdAt), asc(photos.id))
    .limit(100);
  const withTickets: Photo<DownloadTicket>[] = [];
  for (const row of rows) {
    withTickets.push({ ...row, ticket: await c.var.files.createDownloadTicket(photoName(post.id, row.id)) });
  }
  return { post, photos: withTickets };
}

/** Deletes the post's photo rows and the post, then its files; a failed file cleanup is logged, not raised. */
async function deletePost(c: { readonly var: Vars }, db: PortableDb, postId: string): Promise<void> {
  await atomic(db, [(w) => w.delete(photos).where(eq(photos.postId, postId)), (w) => w.delete(posts).where(eq(posts.id, postId))]);
  try {
    const prefix = photoPrefix(postId);
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await c.var.files.list(prefix, cursor === null ? { limit: 1000 } : { limit: 1000, cursor });
      names.push(...page.items.map((item) => item.name));
      cursor = page.nextCursor;
    } while (cursor !== null);
    for (const name of names) await c.var.files.delete(name);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "unknown error";
    c.var.log.write("photos", "warn", `post ${postId}: photo file cleanup failed: ${reason}`);
  }
  c.var.log.write("posts", "info", `post ${postId} deleted`);
}

async function setStatus(c: { readonly var: Vars }, id: string, status: "draft" | "published"): Promise<PostSummary> {
  const post = await visiblePost(c.var.sql, c.var.user, id);
  const updatedAt = now();
  await c.var.sql.update(posts).set({ status, updatedAt }).where(eq(posts.id, post.id));
  c.var.log.write("posts", "info", `post ${post.id} ${status === "published" ? "published" : "unpublished"}`);
  const summary: PostSummary = {
    id: post.id,
    title: post.title,
    authorId: post.authorId,
    authorName: post.authorName,
    status,
    createdAt: post.createdAt,
    updatedAt,
  };
  return summary;
}

/** SQL, secrets and log: posts, their drafts, publishing and share links. */
export function postRoutes(api: Hono<Env>): void {
  api.get("/posts", queryParams(listQuery), async (c) => {
    const query = c.req.valid("query");
    const page = query.page ?? 1;
    const user = c.var.user;
    const perPage = query.perPage ?? (user.level === "anonymous" ? DEFAULT_PER_PAGE : await readPerPage(c.var.kv, user.id, DEFAULT_PER_PAGE));
    const rows = await c.var.sql
      .select(summaryColumns)
      .from(posts)
      .where(eq(posts.status, "published"))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(perPage + 1)
      .offset((page - 1) * perPage);
    const body: PostPage = { posts: summaries(rows.slice(0, perPage)), page, perPage, hasMore: rows.length > perPage };
    return c.json(body);
  });

  api.get("/posts/mine", requireUser(), async (c) => {
    const rows = await c.var.sql
      .select(summaryColumns)
      .from(posts)
      .where(eq(posts.authorId, c.var.user.id))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(100);
    const body: PostList = { posts: summaries(rows) };
    return c.json(body);
  });

  api.get("/admin/drafts", requireAdmin(), async (c) => {
    const rows = await c.var.sql
      .select(summaryColumns)
      .from(posts)
      .where(eq(posts.status, "draft"))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(100);
    const body: PostList = { posts: summaries(rows) };
    return c.json(body);
  });

  api.post("/posts", requireUser(), jsonBody(postInput), async (c) => {
    const { title, body } = c.req.valid("json");
    const id = newId();
    const at = now();
    await c.var.sql.insert(posts).values({
      id,
      authorId: c.var.user.id,
      authorName: c.var.user.displayName,
      title,
      body,
      status: "draft",
      createdAt: at,
      updatedAt: at,
    });
    const created: Created = { id };
    return c.json(created, 201);
  });

  api.get("/posts/:id", async (c) => {
    const post = await visiblePost(c.var.sql, c.var.user, parseId(c.req.param("id")));
    return c.json(await detail(c, post));
  });

  api.put("/posts/:id", requireUser(), jsonBody(postInput), async (c) => {
    const post = await ownDraft(c.var.sql, c.var.user, parseId(c.req.param("id")));
    const { title, body } = c.req.valid("json");
    const updatedAt = now();
    const changed = await c.var.sql
      .update(posts)
      .set({ title, body, updatedAt })
      .where(and(eq(posts.id, post.id), eq(posts.status, "draft")))
      .returning({ id: posts.id });
    if (changed.length === 0) throw new FrameworkError("HTTP.CONFLICT", "the post is no longer a draft");
    const updated: Post = { ...post, title, body, updatedAt };
    return c.json(updated);
  });

  api.delete("/posts/:id", requireUser(), async (c) => {
    const user = c.var.user;
    const post = await visiblePost(c.var.sql, user, parseId(c.req.param("id")));
    const ownDraftPost = post.authorId === user.id && post.status === "draft";
    if (user.level !== "admin" && !ownDraftPost) throw new FrameworkError("AUTH.FORBIDDEN", "only an admin may delete this post");
    await deletePost(c, c.var.sql, post.id);
    return c.body(null, 204);
  });

  api.post("/posts/:id/publish", requireAdmin(), async (c) => c.json(await setStatus(c, parseId(c.req.param("id")), "published")));
  api.post("/posts/:id/unpublish", requireAdmin(), async (c) => c.json(await setStatus(c, parseId(c.req.param("id")), "draft")));

  api.post("/posts/:id/share", requireUser(), async (c) => {
    const post = await ownDraft(c.var.sql, c.var.user, parseId(c.req.param("id")));
    const expiresAt = now() + c.var.config.get("shareLinkDays") * DAY_MS;
    const token = await signToken(await c.var.secrets.get("shareKey"), post.id, expiresAt);
    const link: ShareLink = { token, expiresAt };
    return c.json(link, 201);
  });

  // Anyone holding a valid, unexpired link may view the draft it names.
  api.get("/shared/:token", async (c) => {
    const token = tokenPattern.safeParse(c.req.param("token"));
    const subject = token.success ? await verifyToken(await c.var.secrets.get("shareKey"), token.data) : null;
    const id = z.uuid().safeParse(subject);
    const post = id.success ? await findPost(c.var.sql, id.data) : null;
    if (post === null) throw new FrameworkError("HTTP.NOT_FOUND", "share link not found");
    return c.json(await detail(c, post));
  });
}
