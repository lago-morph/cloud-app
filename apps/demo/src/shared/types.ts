/** Response and request shapes shared by the server routes and the browser pages. */

export type PostStatus = "draft" | "published";

/** Site-wide settings every page shows (DEMO-REQ-004, DEMO-REQ-006). */
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
  readonly authorId: string;
  readonly status: PostStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
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

/**
 * A photo with a fresh download ticket. The ticket's type comes from the framework (`DownloadTicket`
 * in the browser), which shared code may not import, so it is a type parameter here.
 */
export interface Photo<Ticket> {
  readonly id: string;
  readonly contentType: string;
  readonly size: number;
  readonly ticket: Ticket;
}

export interface PostDetail<Ticket> extends PostSummary {
  readonly body: string;
  readonly photos: readonly Photo<Ticket>[];
}

export interface Created {
  readonly id: string;
}

export interface ShareLink {
  readonly token: string;
  readonly path: string;
  readonly expiresAt: number;
}

export interface Preferences {
  readonly pageSize: number;
}
