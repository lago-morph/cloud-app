import type { FilesStore } from "../service.js";

/** Stub (red step): the Cloudflare store is the R2 binding unchanged. */
export function cloudflareFilesStore(store: FilesStore): FilesStore {
  return store;
}
