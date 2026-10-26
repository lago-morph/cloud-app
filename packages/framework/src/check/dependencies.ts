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
 *   one (nothing installed, or another package manager: pnpm, yarn, bun) the check reports
 *   nothing and `verify` prints a warning that the tree was not checked (`npm install` writes it).
 * - **npm aliases.** A package installed under another name (`"s3": "npm:@aws-sdk/client-s3@^3"`)
 *   is judged by the package it installs: the lock entry's `name`, else the `npm:` spec's target.
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
import { isDeniedPackage, npmAliasTarget } from "./denied-packages.js";
import type { CheckDiagnostic } from "./engine.js";
import { referenceFor } from "./references.js";
import { FRAMEWORK_PACKAGE } from "./resolve.js";
import { PLUGIN_NAME } from "./rule-names.js";

const RULE = `${PLUGIN_NAME}/allowed-imports`;

interface LockEntry {
  readonly name?: string;
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

/** The spec a lock entry (or manifest) declares for `name`. */
function specOf(entry: LockEntry, name: string): string | undefined {
  return entry.dependencies?.[name] ?? entry.optionalDependencies?.[name] ?? entry.peerDependencies?.[name] ?? entry.devDependencies?.[name];
}

/**
 * The real package name installed under `alias`: the lock entry's `name` (npm records it for an
 * alias), else the target of an `npm:` spec, else the alias itself.
 */
function realName(packages: LockPackages, location: string, alias: string, spec: string | undefined): string {
  const recorded = packages[location]?.name;
  if (typeof recorded === "string" && recorded !== "" && packages[location]?.link !== true) return recorded;
  return npmAliasTarget(spec) ?? alias;
}

/** A chain element: the name as declared, with the real package of an npm alias. */
const shown = (alias: string, real: string): string => (alias === real ? alias : `${alias} (npm:${real})`);

/**
 * Every (app dependency, denied package) pair in the installed tree, with one shortest chain each.
 * An npm alias (`"s3": "npm:@aws-sdk/client-s3@^3"`) is judged by the package it installs.
 * `rootSpecs`: the manifest's spec of each root dependency.
 */
export function deniedChains(lock: LockfileLocation, rootDependencies: readonly string[], rootSpecs: Readonly<Record<string, string>> = {}): DeniedChain[] {
  const { packages, appLocation } = lock;
  const out: DeniedChain[] = [];
  for (const dependency of rootDependencies) {
    if (dependency === FRAMEWORK_PACKAGE) continue;
    const start = resolveLocation(packages, appLocation, dependency);
    if (start === undefined) continue;
    const seen = new Set<string>();
    const found = new Map<string, readonly string[]>();
    const first = realName(packages, start, dependency, rootSpecs[dependency]);
    const queue: { location: string; real: string; chain: readonly string[] }[] = [{ location: start, real: first, chain: [shown(dependency, first)] }];
    while (queue.length > 0) {
      const { location, real, chain } = queue.shift()!;
      if (isDeniedPackage(real)) {
        if (!found.has(real)) found.set(real, chain);
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
        if (where === undefined) continue;
        const nextReal = realName(packages, where, next, specOf(entry, next));
        queue.push({ location: where, real: nextReal, chain: [...chain, shown(next, nextReal)] });
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

/** Other package managers' lockfiles, which the tree check does not read. */
const OTHER_LOCKFILES = ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"];

function otherLockfile(appDir: string): string | undefined {
  for (let dir = resolve(appDir); ; dir = dirname(dir)) {
    const found = OTHER_LOCKFILES.find((name) => existsSync(join(dir, name)));
    if (found !== undefined) return found;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * `verify`'s diagnostics for the app's installed tree (empty when there is no lockfile or nothing
 * denied). Without an npm lockfile the tree is not checked, and `warn` says so.
 */
export function checkDependencyTree(appDir: string, warn: (message: string) => void = () => undefined): CheckDiagnostic[] {
  const manifestPath = join(appDir, "package.json");
  if (!existsSync(manifestPath)) return [];
  const text = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(text) as LockEntry;
  const lock = findLockfile(appDir);
  if (lock === undefined) {
    const other = otherLockfile(appDir);
    warn(
      `no package-lock.json (npm's lockfile) records the app's installed packages${other === undefined ? "" : `; ${other} is not read`}, so the installed dependency tree was not checked for platform SDKs and database drivers (DEC-0554). ` +
        "Install with npm (npm install) to have it checked.",
    );
    return [];
  }
  const roots = [...new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})])].sort();
  const specs = { ...manifest.optionalDependencies, ...manifest.devDependencies, ...manifest.dependencies };
  return deniedChains(lock, roots, specs).map(({ dependency, denied, chain }) => ({
    file: "package.json",
    line: declarationLine(text, dependency),
    column: 1,
    rule: RULE,
    message:
      dependency === denied
        ? `Dependency "${dependency}" is a platform SDK or database driver; app code uses the framework's APIs instead.`
        : chain.length === 1
          ? `Dependency "${dependency}" is an npm alias of the platform SDK or database driver "${denied}"; app code uses the framework's APIs instead.`
          : `Dependency "${dependency}" installs the platform SDK or database driver "${denied}" (${chain.join(" → ")}); use a package without it, or the framework's API.`,
    reference: referenceFor(RULE),
  }));
}
