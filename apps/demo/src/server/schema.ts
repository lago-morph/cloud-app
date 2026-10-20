import { defineTable, id, integer, text, timestamp } from "@lago-morph/prototype-framework";

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

/** One row per finalized upload. The file is stored as `uploads/<ownerId>/<id>`; access comes from this row. */
export const uploads = defineTable(
  "uploads",
  {
    id: id(),
    ownerId: text(),
    name: text(),
    size: integer(),
    contentType: text(),
    createdAt: timestamp(),
  },
  { indexes: [["ownerId", "createdAt"]] },
);
