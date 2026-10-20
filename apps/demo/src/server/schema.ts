import { defineTable, id, number, ref, text, timestamp } from "@lago-morph/prototype-framework";

/** One post per row. `status` is "draft" or "published"; `authorId` is the creator's user ID. */
export const posts = defineTable(
  "posts",
  {
    id: id(),
    authorId: text(),
    authorName: text().nullable(),
    title: text(),
    body: text(),
    status: text(),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  { indexes: [["status", "createdAt"], ["authorId", "createdAt"]] },
);

/**
 * One row per finalized photo. The file is stored as `photos/<postId>/<id>`; access comes from the post.
 * `size` is a double so files over 2 GiB fit.
 */
export const photos = defineTable(
  "photos",
  {
    id: id(),
    postId: ref(() => posts.id),
    size: number(),
    contentType: text(),
    createdAt: timestamp(),
  },
  { indexes: [["postId", "createdAt"]] },
);
