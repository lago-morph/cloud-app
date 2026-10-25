/**
 * The Worker bundle's Node.js module rule (CF-REQ-003 and its amendment; DEC-0516): the only
 * Node.js modules a Worker bundle may reference are `node:crypto` and `node:async_hooks`, which
 * the password provider needs under the `nodejs_compat` flag. esbuild keeps exactly these two
 * external (`bundle.ts`); any other Node built-in fails to resolve for the browser platform, and
 * this inspection of the written bundle catches whatever reaches it another way (a `node:`
 * string handed to `process.getBuiltinModule`, a dynamic import, a bare `fs`).
 */
import { builtinModules } from "node:module";

/** The Node.js modules a Worker bundle may reference. */
export const ALLOWED_NODE_MODULES: readonly string[] = Object.freeze(["node:crypto", "node:async_hooks"]);

/** Bare built-in names (`fs`, `fs/promises`, …), longest first so a prefix never wins. */
const BARE_BUILTINS = builtinModules
  .filter((name) => !name.startsWith("_") && !name.startsWith("node:"))
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[/]/g, "\\/"));

/** Any string literal naming a `node:` module. */
const NODE_PREFIXED = /["'`](node:[a-z0-9_/]+)["'`]/g;
/** An import, dynamic import, re-export or require of a bare built-in name. */
const BARE_SPECIFIER = new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s*|\\brequire\\s*\\(\\s*)["'](${BARE_BUILTINS.join("|")})["']`, "g");

/** Every Node.js module the bundle text references, as `node:<name>`, sorted. */
export function nodeModulesIn(bundle: string): string[] {
  const found = new Set<string>();
  for (const match of bundle.matchAll(NODE_PREFIXED)) found.add(match[1] as string);
  for (const match of bundle.matchAll(BARE_SPECIFIER)) found.add(`node:${match[1] as string}`);
  return [...found].sort();
}

/** The referenced Node.js modules CF-REQ-003 does not allow (empty when the bundle complies). */
export function disallowedNodeModules(bundle: string): string[] {
  return nodeModulesIn(bundle).filter((name) => !ALLOWED_NODE_MODULES.includes(name));
}
