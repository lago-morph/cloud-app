import { FrameworkError, asc, eq, type CurrentUser, type PortableDb } from "@lago-morph/prototype-framework";
import type { Photo, PostDetail, PostStatus, PostSummary } from "../shared/types";
import { photos, posts } from "./schema";

/** The columns of a post the routes work with. */
export interface PostRow {
  readonly id: string;
  readonly authorId: string;
  readonly authorName: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export const postColumns = {
  id: posts.id,
  authorId: posts.authorId,
  authorName: posts.authorName,
  title: posts.title,
  body: posts.body,
  status: posts.status,
  createdAt: posts.createdAt,
  updatedAt: posts.updatedAt,
};

/** The storage name of a photo; built only from trusted IDs. */
export function photoFileName(postId: string, photoId: string): string {
  return `posts/${postId}/${photoId}`;
}

/** The prefix under which every file of a post is stored. */
export function postFilePrefix(postId: string): string {
  return `posts/${postId}/`;
}

export function toStatus(value: string): PostStatus {
  return value === "published" ? "published" : "draft";
}

export function isAuthor(post: PostRow, user: CurrentUser): boolean {
  return user.level !== "anonymous" && post.authorId === user.id;
}

/** Published posts are public; a draft is visible to its author and to admins (DEMO-REQ-002). */
export function canView(post: PostRow, user: CurrentUser): boolean {
  return toStatus(post.status) === "published" || isAuthor(post, user) || user.level === "admin";
}

/** The author may edit a post (title, body, photos, share links) while it is a draft. */
export function canEdit(post: PostRow, user: CurrentUser): boolean {
  return isAuthor(post, user) && toStatus(post.status) === "draft";
}

/** Authors delete their own drafts; admins delete any post. */
export function canDelete(post: PostRow, user: CurrentUser): boolean {
  return canEdit(post, user) || user.level === "admin";
}

export async function findPost(db: PortableDb, id: string): Promise<PostRow | null> {
  const [row] = await db.select(postColumns).from(posts).where(eq(posts.id, id)).limit(1);
  return row ?? null;
}

/** The post if the caller may see it; otherwise `HTTP.NOT_FOUND`, so a private draft's existence is not revealed. */
export async function visiblePost(db: PortableDb, id: string, user: CurrentUser): Promise<PostRow> {
  const post = await findPost(db, id);
  if (post === null || !canView(post, user)) throw new FrameworkError("HTTP.NOT_FOUND", "post not found");
  return post;
}

/** The post if the caller is its author and it is still a draft; 404 if invisible, 403 otherwise. */
export async function editablePost(db: PortableDb, id: string, user: CurrentUser): Promise<PostRow> {
  const post = await visiblePost(db, id, user);
  if (!isAuthor(post, user)) throw new FrameworkError("AUTH.FORBIDDEN", "only the post's author may change it");
  if (toStatus(post.status) !== "draft") throw new FrameworkError("AUTH.FORBIDDEN", "a published post can no longer be changed by its author");
  return post;
}

export async function photosOf(db: PortableDb, postId: string): Promise<Photo[]> {
  return db
    .select({ id: photos.id, name: photos.name, size: photos.size, contentType: photos.contentType })
    .from(photos)
    .where(eq(photos.postId, postId))
    .orderBy(asc(photos.createdAt), asc(photos.id))
    .limit(100);
}

export function summary(post: PostRow): PostSummary {
  return {
    id: post.id,
    title: post.title,
    authorName: post.authorName,
    status: toStatus(post.status),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export async function detail(db: PortableDb, post: PostRow, user: CurrentUser): Promise<PostDetail> {
  return {
    ...summary(post),
    body: post.body,
    photos: await photosOf(db, post.id),
    canEdit: canEdit(post, user),
    canDelete: canDelete(post, user),
    canModerate: user.level === "admin",
  };
}
