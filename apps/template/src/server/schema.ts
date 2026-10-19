import { defineTable, id, text, timestamp } from "@lago-morph/prototype-framework";

/** One note per row, owned by the user who wrote it. */
export const notes = defineTable(
  "notes",
  {
    id: id(),
    ownerId: text(),
    text: text(),
    createdAt: timestamp(),
  },
  { indexes: [["ownerId", "createdAt"]] },
);
