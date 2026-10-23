import { FrameworkError, asc, atomic, eq, z, type CurrentUser, type DownloadTicket, type FilesService, type LogService, type PortableDb } from "@lago-morph/prototype-framework";
import type { Photo, Post, PostStatus, PostSummary } from "../shared/types";
import { photos, posts } from "./schema";

/** The post columns every summary needs. */
export const summaryColumns = {
  id: posts.id,
  title: posts.title,
  authorId: posts.authorId,
  status: posts.status,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
};

export interface PostRow {
  readonly id: string;
  readonly title: string;
  readonly authorId: string;
  readonly status: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface FullPostRow extends PostRow {
  readonly body: string;
}

const statusSchema = z.enum(["draft", "published"]);

/** A row's status, checked (the column is plain text). */
export function postStatus(status: string): PostStatus {
  return statusSchema.parse(status);
}

export function toSummary(row: PostRow): PostSummary {
  return { id: row.id, title: row.title, authorId: row.authorId, status: postStatus(row.status), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

/** A path ID that is not a UUID matches no post: answer as for a missing one. */
export function postIdParam(value: string | undefined): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
  return parsed.data;
}

/** The storage name of a photo; built only from server-chosen IDs. */
export function photoFileName(postId: string, photoId: string): string {
  return `photos/${postId}/${photoId}`;
}

/** The prefix under which every file of a post is stored. */
export function photoPrefix(postId: string): string {
  return `photos/${postId}/`;
}

/** Whether `user` may see the post: published posts to anyone, drafts to their author and to admins. */
export function canView(user: CurrentUser, row: PostRow): boolean {
  if (row.status === "published") return true;
  if (user.level === "anonymous") return false;
  return user.level === "admin" || row.authorId === user.id;
}

/** Reads a post the user may see, or throws `HTTP.NOT_FOUND`. */
export async function loadVisiblePost(db: PortableDb, user: CurrentUser, postId: string): Promise<FullPostRow> {
  const [row] = await db
    .select({ ...summaryColumns, body: posts.body })
    .from(posts)
    .where(eq(posts.id, postId));
  if (row === undefined || !canView(user, row)) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
  return row;
}

/** Reads a draft the user wrote, for editing: not visible → 404, visible but not an own draft → 403. */
export async function loadOwnDraft(db: PortableDb, user: CurrentUser, postId: string): Promise<FullPostRow> {
  const row = await loadVisiblePost(db, user, postId);
  if (user.level === "anonymous" || row.authorId !== user.id || row.status !== "draft") {
    throw new FrameworkError("AUTH.FORBIDDEN", "only the author may change a draft");
  }
  return row;
}

/** The number of finalized photos of a post. */
export async function photoCount(db: PortableDb, postId: string): Promise<number> {
  const rows = await db.select({ id: photos.id }).from(photos).where(eq(photos.postId, postId)).limit(1000);
  return rows.length;
}

/** The post with its photos, each with a fresh download ticket. */
export async function withPhotos(db: PortableDb, files: FilesService, row: FullPostRow): Promise<Post<DownloadTicket>> {
  const rows = await db
    .select({ id: photos.id, name: photos.name, size: photos.size, contentType: photos.contentType })
    .from(photos)
    .where(eq(photos.postId, row.id))
    .orderBy(asc(photos.createdAt), asc(photos.id))
    .limit(100);
  const list: Photo<DownloadTicket>[] = [];
  for (const p of rows) {
    list.push({ ...p, ticket: await files.createDownloadTicket(photoFileName(row.id, p.id)) });
  }
  return { ...toSummary(row), body: row.body, photos: list };
}

/**
 * Deletes a post: its photo rows and the post row together, then its files (DEMO-REQ-003).
 * A file-cleanup failure is logged at `warn` and the post stays deleted.
 */
export async function deletePost(db: PortableDb, files: FilesService, log: LogService, postId: string): Promise<void> {
  await atomic(db, [(w) => w.delete(photos).where(eq(photos.postId, postId)), (w) => w.delete(posts).where(eq(posts.id, postId))]);
  try {
    const prefix = photoPrefix(postId);
    let cursor: string | null = null;
    do {
      const page: { items: readonly { name: string }[]; nextCursor: string | null } = await files.list(prefix, cursor === null ? { limit: 1000 } : { limit: 1000, cursor });
      for (const item of page.items) await files.delete(item.name);
      cursor = page.nextCursor;
    } while (cursor !== null);
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown error";
    log.write("photos", "warn", `post ${postId} deleted but its photo files could not be deleted (${reason})`);
  }
  log.write("posts", "info", `post ${postId} deleted`);
}
