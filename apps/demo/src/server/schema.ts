import { defineTable, id, integer, ref, text, timestamp } from "@lago-morph/prototype-framework";

/** One post per row (DEMO-REQ-001). `status` is "draft" or "published"; `authorId` is the author's user ID. */
export const posts = defineTable(
  "posts",
  {
    id: id(),
    authorId: text(),
    title: text(),
    body: text(),
    status: text(),
    createdAt: timestamp(),
    updatedAt: timestamp(),
  },
  { indexes: [["status", "createdAt"], ["authorId", "status", "createdAt"]] },
);

/** One row per finalized photo (DEMO-REQ-003). The file is stored as `photos/<postId>/<id>`; access comes from the post. */
export const photos = defineTable(
  "photos",
  {
    id: id(),
    postId: ref(() => posts.id),
    name: text(),
    size: integer(),
    contentType: text(),
    createdAt: timestamp(),
  },
  { indexes: [["postId", "createdAt"]] },
);
