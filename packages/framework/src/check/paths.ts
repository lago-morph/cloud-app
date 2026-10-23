/**
 * App code classification by path (CHECK-REQ-001). Paths are app-relative.
 */
export type CodeKind = "browser" | "server" | "shared" | "test";

/**
 * `src/client/**` browser, `src/shared/**` shared, `src/app.ts` and `src/server/**` server,
 * `tests/**` test. Any other file under `src/` is treated as server code (the strictest
 * classification that still allows the framework's server API). Files outside `src/` and
 * `tests/` are not app code (undefined).
 */
export function classifyPath(appRelativePath: string): CodeKind | undefined {
  const path = appRelativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.startsWith("src/client/")) return "browser";
  if (path.startsWith("src/shared/")) return "shared";
  if (path.startsWith("src/")) return "server";
  if (path.startsWith("tests/")) return "test";
  return undefined;
}
