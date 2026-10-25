/**
 * The installed dependency tree check (CHECK-REQ-001 `allowed-imports`, amended by DEC-0554):
 * `allowed-imports` rejects a platform SDK or database driver that app code imports by name, but
 * an ordinary-looking package can bring one in as its own dependency. So `verify` also walks the
 * app's installed tree, as the npm lockfile records it, and reports every app dependency whose
 * tree contains a denied package (`denied-packages.ts`), with the path to it.
 *
 * - **Which lockfile.** The nearest `package-lock.json` from the app directory upwards (an app in
 *   an npm workspace is recorded in the workspace root's lockfile), else the app's
 *   `node_modules/.package-lock.json`. Lockfile versions 2 and 3 (`packages`) are read. Without
 *   one nothing is installed to inspect, and the check reports nothing (`npm install` writes it).
 * - **Where the walk starts.** The app's `dependencies`, `devDependencies` and
 *   `optionalDependencies`, except the framework itself: its own tree holds the tools it runs on
 *   the owner's machine (SST, Wrangler, PGlite), which never reach a Worker bundle (CORE-REQ-006).
 * - **What it follows.** Each installed package's `dependencies`, `optionalDependencies` and
 *   non-optional `peerDependencies`, resolved as Node resolves them (the nearest
 *   `node_modules/<name>` up from the package's location; a workspace link to its target). A
 *   dependency the lockfile does not list is not installed and is skipped.
 * - **What it reports.** One diagnostic per app dependency and denied package, on the line of
 *   `package.json` that declares the dependency, under the rule ID of `allowed-imports`, naming
 *   the chain (`app dependency → … → denied package`). Ordinary packages pass.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isDeniedPackage } from "./denied-packages.js";
import type { CheckDiagnostic } from "./engine.js";
import { referenceFor } from "./references.js";
import { FRAMEWORK_PACKAGE } from "./resolve.js";
import { PLUGIN_NAME } from "./rule-names.js";

const RULE = `${PLUGIN_NAME}/allowed-imports`;

interface LockEntry {
  readonly version?: string;
  readonly link?: boolean;
  readonly resolved?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

/** A lockfile's `packages` map, keyed by location (`""` the root, `node_modules/a`, `apps/x`). */
export type LockPackages = Readonly<Record<string, LockEntry>>;

export interface LockfileLocation {
  readonly packages: LockPackages;
  /** The app's location in `packages` (`""` when the lockfile is the app's own). */
  readonly appLocation: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function packagesOf(lock: unknown): LockPackages | undefined {
  const packages = (lock as { packages?: unknown } | null)?.packages;
  return typeof packages === "object" && packages !== null ? (packages as LockPackages) : undefined;
}

const toPosix = (path: string): string => path.split("\\").join("/");

/** The lockfile that records the app's installed tree, or undefined when there is none. */
export function findLockfile(appDir: string): LockfileLocation | undefined {
  const app = resolve(appDir);
  for (let dir = app; ; dir = dirname(dir)) {
    const path = join(dir, "package-lock.json");
    if (existsSync(path)) {
      const packages = packagesOf(readJson(path));
      const appLocation = toPosix(relative(dir, app));
      if (packages !== undefined && (appLocation === "" || packages[appLocation] !== undefined)) return { packages, appLocation };
    }
    if (dirname(dir) === dir) break;
  }
  const hidden = join(app, "node_modules", ".package-lock.json");
  if (existsSync(hidden)) {
    const packages = packagesOf(readJson(hidden));
    if (packages !== undefined) return { packages, appLocation: "" };
  }
  return undefined;
}

const joinLocation = (base: string, rest: string): string => (base === "" ? rest : `${base}/${rest}`);

/** Where Node finds `name` from the package at `from`: the nearest `node_modules/<name>` upwards. */
export function resolveLocation(packages: LockPackages, from: string, name: string): string | undefined {
  let base = from;
  for (;;) {
    const candidate = joinLocation(base, `node_modules/${name}`);
    if (packages[candidate] !== undefined) return candidate;
    if (base === "") return undefined;
    const cut = base.lastIndexOf("/node_modules/");
    if (cut >= 0) base = base.slice(0, cut);
    else {
      const slash = base.lastIndexOf("/");
      base = base.startsWith("node_modules/") ? "" : slash < 0 ? "" : base.slice(0, slash);
    }
  }
}

/** The location of the installed package (a workspace link's target). */
function installed(packages: LockPackages, location: string): string {
  const entry = packages[location];
  return entry?.link === true && typeof entry.resolved === "string" ? entry.resolved : location;
}

function followed(entry: LockEntry): string[] {
  const peers = Object.keys(entry.peerDependencies ?? {}).filter((name) => entry.peerDependenciesMeta?.[name]?.optional !== true);
  return [...new Set([...Object.keys(entry.dependencies ?? {}), ...Object.keys(entry.optionalDependencies ?? {}), ...peers])];
}

export interface DeniedChain {
  /** The app's own dependency the denied package comes through. */
  readonly dependency: string;
  /** The denied package. */
  readonly denied: string;
  /** Package names from the app dependency to the denied package, both included. */
  readonly chain: readonly string[];
}

/** Every (app dependency, denied package) pair in the installed tree, with one shortest chain each. */
export function deniedChains(lock: LockfileLocation, rootDependencies: readonly string[]): DeniedChain[] {
  const { packages, appLocation } = lock;
  const out: DeniedChain[] = [];
  for (const dependency of rootDependencies) {
    if (dependency === FRAMEWORK_PACKAGE) continue;
    const start = resolveLocation(packages, appLocation, dependency);
    if (start === undefined) continue;
    const seen = new Set<string>();
    const found = new Map<string, readonly string[]>();
    const queue: { location: string; chain: readonly string[] }[] = [{ location: start, chain: [dependency] }];
    while (queue.length > 0) {
      const { location, chain } = queue.shift()!;
      const name = chain[chain.length - 1]!;
      if (isDeniedPackage(name)) {
        if (!found.has(name)) found.set(name, chain);
        continue;
      }
      const at = installed(packages, location);
      if (seen.has(at)) continue;
      seen.add(at);
      const entry = packages[at];
      if (entry === undefined) continue;
      for (const next of followed(entry)) {
        if (next === FRAMEWORK_PACKAGE) continue;
        const where = resolveLocation(packages, at, next);
        if (where !== undefined) queue.push({ location: where, chain: [...chain, next] });
      }
    }
    for (const [denied, chain] of [...found].sort(([a], [b]) => a.localeCompare(b))) out.push({ dependency, denied, chain });
  }
  return out;
}

/** The 1-based line of `package.json` that declares `name` (1 when it cannot be found). */
function declarationLine(text: string, name: string): number {
  const index = text.split("\n").findIndex((line) => line.includes(`${JSON.stringify(name)}:`) || line.includes(`${JSON.stringify(name)} :`));
  return index < 0 ? 1 : index + 1;
}

/** `verify`'s diagnostics for the app's installed tree (empty when there is no lockfile or nothing denied). */
export function checkDependencyTree(appDir: string): CheckDiagnostic[] {
  const manifestPath = join(appDir, "package.json");
  if (!existsSync(manifestPath)) return [];
  const text = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(text) as LockEntry;
  const lock = findLockfile(appDir);
  if (lock === undefined) return [];
  const roots = [...new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})])].sort();
  return deniedChains(lock, roots).map(({ dependency, denied, chain }) => ({
    file: "package.json",
    line: declarationLine(text, dependency),
    column: 1,
    rule: RULE,
    message:
      dependency === denied
        ? `Dependency "${dependency}" is a platform SDK or database driver; app code uses the framework's APIs instead.`
        : `Dependency "${dependency}" installs the platform SDK or database driver "${denied}" (${chain.join(" → ")}); use a package without it, or the framework's API.`,
    reference: referenceFor(RULE),
  }));
}
