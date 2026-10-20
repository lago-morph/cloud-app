import type { FilesService } from "@lago-morph/prototype-framework";
import { photoFileName, postFilePrefix } from "./access";

/** The part of `c.var.log` cleanup needs. */
interface Log {
  write(component: string, severity: "warn", message: string): void;
}

/**
 * Deletes a deleted post's files (DEMO-REQ-003): each recorded photo, then anything left under the
 * post's prefix (uploads that were never finalized). Runs after the records are gone, so a failure
 * here never keeps the post; it is logged at `warn` (DEMO-REQ-008) and the request still succeeds.
 */
export async function cleanUpPostFiles(files: FilesService, log: Log, postId: string, photoIds: readonly string[]): Promise<void> {
  const failed: string[] = [];
  const names = new Set(photoIds.map((id) => photoFileName(postId, id)));
  for (const name of names) {
    try {
      await files.delete(name);
    } catch {
      failed.push(name);
    }
  }
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const listed: { items: readonly { name: string }[]; nextCursor: string | null } = await files.list(
        postFilePrefix(postId),
        cursor === null ? { limit: 100 } : { limit: 100, cursor },
      );
      for (const item of listed.items) {
        if (names.has(item.name)) continue;
        try {
          await files.delete(item.name);
        } catch {
          failed.push(item.name);
        }
      }
      cursor = listed.nextCursor;
      if (cursor === null) break;
    }
  } catch {
    failed.push(`${postFilePrefix(postId)}*`);
  }
  if (failed.length > 0) {
    log.write("photos", "warn", `photo cleanup for deleted post ${postId} failed for ${String(failed.length)} file(s): ${failed.join(", ")}`);
  }
}
