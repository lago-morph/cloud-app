import { FrameworkError, eq, z, type CurrentUser, type PortableDb } from "@lago-morph/prototype-framework";
import type { Post, PostStatus } from "../shared/types";
import { posts } from "./schema";

/** The storage name of a photo; the server builds it from the post's and the photo's `newId()` values. */
export function photoName(postId: string, photoId: string): string {
  return `${photoPrefix(postId)}${photoId}`;
}

/** Every file of a post (finalized photos and unfinished uploads) starts with this prefix. */
export function photoPrefix(postId: string): string {
  return `photos/${postId}/`;
}

/** A path ID that is not a UUID matches no row the caller may see. */
export function parseId(raw: string | undefined): string {
  const result = z.uuid().safeParse(raw);
  if (!result.success) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
  return result.data;
}

export function toStatus(value: string): PostStatus {
  return value === "published" ? "published" : "draft";
}

/** The post with this ID, or null. */
export async function findPost(db: PortableDb, id: string): Promise<Post | null> {
  const [row] = await db
    .select({
      id: posts.id,
      title: posts.title,
      body: posts.body,
      authorId: posts.authorId,
      authorName: posts.authorName,
      status: posts.status,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .where(eq(posts.id, id));
  return row === undefined ? null : { ...row, status: toStatus(row.status) };
}

/** Published posts are public; a draft is visible to its author and to admins. */
export function canView(user: CurrentUser, post: Post): boolean {
  if (post.status === "published") return true;
  if (user.level === "anonymous") return false;
  return user.level === "admin" || user.id === post.authorId;
}

/** The post, if the caller may see it; otherwise 404 so its existence is not revealed. */
export async function visiblePost(db: PortableDb, user: CurrentUser, id: string): Promise<Post> {
  const post = await findPost(db, id);
  if (post === null || !canView(user, post)) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
  return post;
}

/** The caller's own draft: 404 if they may not see it, 403 if they may see it but not change it. */
export async function ownDraft(db: PortableDb, user: CurrentUser, id: string): Promise<Post> {
  const post = await visiblePost(db, user, id);
  if (user.level === "anonymous" || post.authorId !== user.id || post.status !== "draft") {
    throw new FrameworkError("AUTH.FORBIDDEN", "only the author may change a draft");
  }
  return post;
}
