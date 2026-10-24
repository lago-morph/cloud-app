/**
 * The browser assets an app serves, and the repository's files, for E2E-014's scans.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { USER_AGENT } from "../../harness/index.js";

export interface Asset {
  readonly path: string;
  readonly text: string;
}

const MAX_ASSETS = 300;

/** Same-origin paths referenced from HTML (`src`, `href`) or from JS/CSS (import specifiers, `url()`, quoted absolute paths). */
function references(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)[^"']*["']/g)) if (m[1] !== undefined) out.add(m[1]);
  for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g)) if (m[1] !== undefined) out.add(m[1]);
  for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) if (m[1] !== undefined) out.add(m[1]);
  for (const m of text.matchAll(/["'](\/(?:assets|src|@vite|@fs|node_modules)\/[^"'\s]+)["']/g)) if (m[1] !== undefined) out.add(m[1]);
  return [...out];
}

/**
 * Every browser asset reachable from the app's entry page `/` on `origin`: same-origin,
 * outside `/api`, bounded in number (an app's client has a handful of files).
 */
export async function crawlAssets(origin: string): Promise<Asset[]> {
  const base = new URL(origin);
  const queue = ["/"];
  const seen = new Set<string>();
  const assets: Asset[] = [];
  while (queue.length > 0 && assets.length < MAX_ASSETS) {
    const path = queue.shift() ?? "/";
    if (seen.has(path)) continue;
    seen.add(path);
    const response = await fetch(new URL(path, base), { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(55_000) });
    if (!response.ok) continue;
    const text = await response.text();
    assets.push({ path, text });
    for (const ref of references(text)) {
      let url: URL;
      try {
        url = new URL(ref, new URL(path, base));
      } catch {
        continue;
      }
      if (url.origin !== base.origin || url.pathname.startsWith("/api/")) continue;
      const next = url.pathname + url.search;
      if (!seen.has(next)) queue.push(next);
    }
  }
  return assets;
}

/** The repository's tracked files and its untracked files that are not ignored. */
export function repositoryFiles(root: string): string[] {
  const list = (args: string[]): string[] => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter((p) => p !== "");
  const paths = [...new Set([...list(["ls-files", "-z"]), ...list(["ls-files", "-z", "--others", "--exclude-standard"])])];
  return paths.map((p) => join(root, p)).filter((p) => existsSync(p) && statSync(p).isFile());
}

/** Paths (relative) of the files whose bytes contain `value`. Never returns the value. */
export function filesWithValue(files: readonly string[], value: string, root: string): string[] {
  const needle = Buffer.from(value, "utf8");
  return files.filter((f) => readFileSync(f).includes(needle)).map((f) => f.slice(root.length + 1));
}
