import { defineTable, id, number, ref, text, timestamp } from "@lago-morph/prototype-framework";

/** One post per row (DEMO-REQ-001). `status` is "draft" or "published". */
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
 * One row per finalized photo (DEMO-REQ-003). The file is stored as `posts/<postId>/<id>`; access
 * comes from the post. `size` is a number, not a 32-bit integer, because photos may exceed 2 GiB.
 */
export const photos = defineTable(
  "photos",
  {
    id: id(),
    postId: ref(() => posts.id),
    name: text(),
    size: number(),
    contentType: text(),
    createdAt: timestamp(),
  },
  { indexes: [["postId", "createdAt"]] },
);
