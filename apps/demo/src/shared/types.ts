/** Response and request shapes shared by the server routes and the browser pages. */

export type PostStatus = "draft" | "published";

export interface SiteInfo {
  readonly title: string;
  readonly banner: string | null;
  readonly maxPhotosPerPost: number;
  readonly shareLinkDays: number;
}

export interface Banner {
  readonly banner: string | null;
}

export interface Preferences {
  readonly perPage: number;
}

export interface PostSummary {
  readonly id: string;
  readonly title: string;
  readonly authorId: string;
  readonly authorName: string | null;
  readonly status: PostStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Post extends PostSummary {
  readonly body: string;
}

export interface PostPage {
  readonly posts: readonly PostSummary[];
  readonly page: number;
  readonly perPage: number;
  readonly hasMore: boolean;
}

export interface PostList {
  readonly posts: readonly PostSummary[];
}

/** A photo with a fresh download ticket; `T` is the framework's `DownloadTicket` type on each side. */
export interface Photo<T> {
  readonly id: string;
  readonly size: number;
  readonly contentType: string;
  readonly ticket: T;
}

export interface PostDetail<T> {
  readonly post: Post;
  readonly photos: readonly Photo<T>[];
}

export interface PhotoUpload<T> {
  readonly id: string;
  readonly ticket: T;
}

export interface StoredPhoto {
  readonly id: string;
  readonly size: number;
  readonly contentType: string;
}

export interface ShareLink {
  readonly token: string;
  readonly expiresAt: number;
}

export interface Created {
  readonly id: string;
}
