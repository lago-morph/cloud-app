import { FrameworkError, asc, eq, z, type CurrentUser, type FilesService, type KvService, type PortableDb } from "@lago-morph/prototype-framework";
import type { Photo, PostDetail, PostStatus, PostSummary } from "../shared/types";
import { photos, posts } from "./schema";

/** The download ticket type `files.createDownloadTicket` returns. */
export type Ticket = Awaited<ReturnType<FilesService["createDownloadTicket"]>>;

/** KV key of the site banner (DEMO-REQ-004). */
export const BANNER_KEY = "banner";

/** Posts per page when the caller has no saved choice (DEMO-REQ-005). */
export const DEFAULT_PAGE_SIZE = 10;

/** KV key of one user's preferences, built from the trusted user ID. */
export function preferenceKey(userId: string): string {
  return `pref:${userId}`;
}

const storedPreferences = z.object({ pageSize: z.number().int().min(1).max(50) });

/** The user's saved posts-per-page, or the default. */
export async function readPageSize(kv: KvService, userId: string): Promise<number> {
  const raw = await kv.get(preferenceKey(userId));
  if (raw === null) return DEFAULT_PAGE_SIZE;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
  const parsed = storedPreferences.safeParse(value);
  return parsed.success ? parsed.data.pageSize : DEFAULT_PAGE_SIZE;
}

/** The server builds every photo's storage name from the post ID and the photo's own `newId()`. */
export function photoName(postId: string, photoId: string): string {
  return `photos/${postId}/${photoId}`;
}

/** Storage-name prefix of every photo of a post, finalized or not. */
export function photoPrefix(postId: string): string {
  return `photos/${postId}/`;
}

export interface PostRow {
  readonly id: string;
  readonly authorId: string;
  readonly title: string;
  readonly body: string;
  readonly status: PostStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const statusSchema = z.enum(["draft", "published"]);

/** The status stored in a row, checked rather than assumed. */
export function toStatus(value: string): PostStatus {
  return statusSchema.parse(value);
}

export function summary(row: PostRow): PostSummary {
  return { id: row.id, title: row.title, authorId: row.authorId, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** Loads a post by a path ID; an ID that is not a UUID is treated as missing. */
export async function loadPost(db: PortableDb, rawId: string | undefined): Promise<PostRow | null> {
  const parsed = z.uuid().safeParse(rawId);
  if (!parsed.success) return null;
  const [row] = await db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      title: posts.title,
      body: posts.body,
      status: posts.status,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .where(eq(posts.id, parsed.data))
    .limit(1);
  return row === undefined ? null : { ...row, status: toStatus(row.status) };
}

/** Published posts are public; drafts are visible to their author and to admins (DEMO-REQ-002). */
export function canView(user: CurrentUser, post: PostRow): boolean {
  if (post.status === "published") return true;
  if (user.level === "anonymous") return false;
  return user.level === "admin" || user.id === post.authorId;
}

/** Loads a post the caller may see, or answers 404 so a hidden draft looks like a missing one. */
export async function visiblePost(db: PortableDb, user: CurrentUser, rawId: string | undefined): Promise<PostRow> {
  const post = await loadPost(db, rawId);
  if (post === null || !canView(user, post)) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
  return post;
}

/** A draft the caller wrote and may still change; others' visible posts are 403, hidden ones 404. */
export async function ownDraft(db: PortableDb, user: CurrentUser, rawId: string | undefined): Promise<PostRow> {
  const post = await visiblePost(db, user, rawId);
  if (user.level === "anonymous" || post.authorId !== user.id) throw new FrameworkError("AUTH.FORBIDDEN", "only the author may change this post");
  if (post.status !== "draft") throw new FrameworkError("HTTP.CONFLICT", "only drafts can be changed");
  return post;
}

/** Number of finalized photos of a post. */
export async function photoCount(db: PortableDb, postId: string): Promise<number> {
  const rows = await db.select({ id: photos.id }).from(photos).where(eq(photos.postId, postId)).limit(1000);
  return rows.length;
}

/** The post with its photos, each with a fresh download ticket (never stored). */
export async function postDetail(db: PortableDb, files: FilesService, post: PostRow): Promise<PostDetail<Ticket>> {
  const rows = await db
    .select({ id: photos.id, contentType: photos.contentType, size: photos.size })
    .from(photos)
    .where(eq(photos.postId, post.id))
    .orderBy(asc(photos.createdAt), asc(photos.id))
    .limit(1000);
  const list: Photo<Ticket>[] = [];
  for (const row of rows) {
    const ticket = await files.createDownloadTicket(photoName(post.id, row.id));
    list.push({ ...row, ticket });
  }
  return { ...summary(post), body: post.body, photos: list };
}
