/** Response and request shapes shared by the server routes and the browser pages. */

export type PostStatus = "draft" | "published";

/** Site-wide settings everyone sees (DEMO-REQ-004, DEMO-REQ-006). */
export interface Site {
  readonly title: string;
  readonly banner: string | null;
  readonly maxPhotosPerPost: number;
  readonly shareLinkDays: number;
}

export interface Banner {
  readonly banner: string | null;
}

export interface PostSummary {
  readonly id: string;
  readonly title: string;
  readonly authorName: string | null;
  readonly status: PostStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PostPage {
  readonly posts: readonly PostSummary[];
  readonly page: number;
  readonly perPage: number;
  readonly hasMore: boolean;
}

export interface DraftList {
  readonly posts: readonly PostSummary[];
}

export interface Photo {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

export interface PostDetail extends PostSummary {
  readonly body: string;
  readonly photos: readonly Photo[];
  /** Whether the caller may edit the post, add photos and create share links (the author, while a draft). */
  readonly canEdit: boolean;
  /** Whether the caller may delete the post. */
  readonly canDelete: boolean;
  /** Whether the caller may publish or unpublish the post (admins). */
  readonly canModerate: boolean;
}

export interface Created {
  readonly id: string;
}

export interface Preferences {
  readonly perPage: number;
}

export interface ShareLink {
  readonly token: string;
  readonly expiresAt: number;
}
