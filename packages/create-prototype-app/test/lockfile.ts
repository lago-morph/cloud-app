/**
 * Test helper: a package-lock.json for a created app, cut from the framework repository's own
 * lockfile, so the app installs with `npm ci --offline` from the npm cache that the repository's
 * `npm ci` filled. (`npm ci` caches package tarballs only, not registry metadata, so an install
 * without a lockfile cannot resolve version ranges offline.)
 *
 * Each dependency is resolved from the lockfile the way Node resolves it from the workspace that
 * declares it: the nearest `node_modules/<name>` going up from the dependent's location. The
 * framework, a workspace in the repository, becomes the packed tarball at
 * `node_modules/@lago-morph/prototype-framework`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

interface Entry {
  version?: string;
  resolved?: string;
  integrity?: string;
  link?: boolean;
  dev?: boolean;
  devOptional?: boolean;
  optional?: boolean;
  peer?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  [key: string]: unknown;
}

interface Lock {
  packages: Record<string, Entry>;
}

const FRAMEWORK = "@lago-morph/prototype-framework";
const FRAMEWORK_WS = "packages/framework";

/** The lock path that `name` resolves to from a package at `from` (a lock path), or undefined. */
function resolveFrom(lock: Lock, from: string, name: string): string | undefined {
  let base = from;
  for (;;) {
    const candidate = base === "" ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (lock.packages[candidate] !== undefined) return candidate;
    if (base === "") return undefined;
    const cut = base.lastIndexOf("/node_modules/");
    // A workspace folder (e.g. packages/framework) resolves next from the repository root.
    base = cut < 0 ? "" : base.slice(0, cut);
  }
}

/**
 * @param rootLockFile the repository's package-lock.json
 * @param templateWs the template's workspace folder (apps/template)
 * @param app the created app's package.json (its framework dependency set to `file:<tarball>`)
 * @param tarball the framework tarball path, for its integrity
 */
export function appLockfile(rootLockFile: string, templateWs: string, app: { name: string; version: string; dependencies: Record<string, string>; devDependencies?: Record<string, string> }, tarball: string): object {
  const lock = JSON.parse(readFileSync(rootLockFile, "utf8")) as Lock;
  const out: Record<string, Entry> = {};
  /** repository lock path → app lock path */
  const placed = new Map<string, string>();

  const relocate = (path: string): string => {
    if (path === FRAMEWORK_WS) return `node_modules/${FRAMEWORK}`;
    if (path.startsWith(`${FRAMEWORK_WS}/`)) return `node_modules/${FRAMEWORK}/${path.slice(FRAMEWORK_WS.length + 1)}`;
    if (path.startsWith(`${templateWs}/`)) return path.slice(templateWs.length + 1);
    return path;
  };

  const visit = (path: string): void => {
    if (placed.has(path)) return;
    const entry = lock.packages[path];
    if (entry === undefined) throw new Error(`lockfile has no ${path}`);
    const target = relocate(path);
    for (const [from, to] of placed) {
      if (to === target && from !== path) throw new Error(`both ${from} and ${path} land at ${target} in the app's lockfile`);
    }
    placed.set(path, target);
    const copy: Entry = { ...entry };
    delete copy.dev;
    delete copy.peer;
    if (copy.devOptional === true) {
      delete copy.devOptional;
      copy.optional = true;
    }
    if (path === FRAMEWORK_WS) {
      copy.resolved = `file:${tarball}`;
      copy.integrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
      delete copy.devDependencies;
    }
    out[target] = copy;
    const deps: string[] = [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}).filter((n) => entry.peerDependenciesMeta?.[n]?.optional !== true),
    ];
    for (const dep of deps) {
      const found = resolveFrom(lock, path, dep);
      if (found === undefined) {
        if (entry.optionalDependencies?.[dep] !== undefined || entry.peerDependencies?.[dep] !== undefined) continue;
        throw new Error(`cannot resolve ${dep} from ${path}`);
      }
      visit(followLink(lock, found));
    }
  };

  const roots = { ...app.dependencies, ...(app.devDependencies ?? {}) };
  for (const name of Object.keys(roots)) {
    const found = name === FRAMEWORK ? FRAMEWORK_WS : resolveFrom(lock, templateWs, name);
    if (found === undefined) throw new Error(`cannot resolve ${name} from ${templateWs}`);
    visit(followLink(lock, found));
  }

  const packages: Record<string, Entry> = {
    "": { name: app.name, version: app.version, dependencies: app.dependencies, ...(app.devDependencies === undefined ? {} : { devDependencies: app.devDependencies }) },
  };
  for (const key of Object.keys(out).sort()) packages[key] = out[key] as Entry;
  return { name: app.name, version: app.version, lockfileVersion: 3, requires: true, packages };
}

/** A workspace link (`node_modules/x` → `packages/x`) resolves to the workspace folder. */
function followLink(lock: Lock, path: string): string {
  const entry = lock.packages[path];
  return entry?.link === true && typeof entry.resolved === "string" ? entry.resolved : path;
}
