/**
 * `verify`'s zod check (check.md §2 "Zod version"): browser and shared code import `zod`
 * directly, so the installed version must be exactly PAR-112, the one `.` re-exports.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** PAR-112. */
export const ZOD_VERSION = "4.6.7";

/** The version of the `zod` Node resolution finds from `appDir` (nearest `node_modules/zod`), or undefined. */
export function installedZodVersion(appDir: string): string | undefined {
  let dir = resolve(appDir);
  for (;;) {
    const manifest = join(dir, "node_modules", "zod", "package.json");
    if (existsSync(manifest)) {
      const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown }).version;
      return typeof version === "string" ? version : undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
