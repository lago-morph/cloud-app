/** Response and request shapes shared by the server routes and the browser pages. */

export type PostStatus = "draft" | "published";

export interface Site {
  readonly title: string;
  readonly maxPhotosPerPost: number;
  readonly banner: string | null;
}

export interface PostSummary {
  readonly id: string;
  readonly title: string;
  readonly authorId: string;
  readonly status: PostStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A photo with a fresh download ticket. `T` is the framework's `DownloadTicket` (shared code cannot name it). */
export interface Photo<T> {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  readonly ticket: T;
}

export interface Post<T> extends PostSummary {
  readonly body: string;
  readonly photos: readonly Photo<T>[];
}

export interface PostPage {
  readonly posts: readonly PostSummary[];
  readonly page: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
}

export interface DraftList {
  readonly posts: readonly PostSummary[];
}

export interface Created {
  readonly id: string;
}

export interface PhotoUpload<T> {
  readonly photoId: string;
  readonly ticket: T;
}

export interface StoredPhoto {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

export interface ShareLink {
  readonly token: string;
  readonly expiresAt: number;
}

export interface Banner {
  readonly message: string | null;
}

export interface Preferences {
  readonly pageSize: number;
}
