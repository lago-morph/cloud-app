/**
 * The Worker bundle's Node.js module rule (CF-REQ-003 and its amendment; DEC-0516): the only
 * Node.js modules a Worker bundle may reference are `node:crypto` and `node:async_hooks`, which
 * the password provider needs under the `nodejs_compat` flag. esbuild keeps exactly these two
 * external (`bundle.ts`); any other Node built-in fails to resolve for the browser platform, and
 * this inspection of the written bundle catches whatever reaches it another way (a `node:`
 * string handed to `process.getBuiltinModule`, a dynamic import, a bare `fs`).
 */
import { builtinModules } from "node:module";
import { isDeniedPackage } from "../check/denied-packages.js";

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

/**
 * Provider SDKs in the Worker bundle (CF-REQ-003: no AWS SDKs; DEC-0554): a module esbuild
 * bundled from a denied package (`check/denied-packages.ts`, read from the module's
 * `node_modules/<package>/` path), and marker strings that a provider SDK carries in its own
 * code (its package scope, or the client header it sends) even when it arrives pre-bundled
 * inside another package. The markers are specific to the SDKs: the framework's own SigV4 signer
 * (aws4fetch) and ordinary packages carry none of them.
 */
export const PROVIDER_SDK_MARKERS: readonly { readonly sdk: string; readonly markers: readonly string[] }[] = Object.freeze([
  { sdk: "AWS SDK for JavaScript", markers: ["@aws-sdk/", "@smithy/", "aws-sdk-js"] },
  { sdk: "Google Cloud client libraries", markers: ["@google-cloud/", "x-goog-api-client"] },
  { sdk: "Azure SDK for JavaScript", markers: ["@azure/", "azsdk-js-"] },
  { sdk: "Firebase Admin SDK", markers: ["firebase-admin"] },
  { sdk: "Cloudflare SDK or tooling", markers: ["@cloudflare/", "cloudflare-typescript"] },
  { sdk: "Pulumi", markers: ["@pulumi/"] },
  { sdk: "Vercel SDK", markers: ["@vercel/"] },
  { sdk: "Netlify SDK", markers: ["@netlify/"] },
  { sdk: "Neon serverless driver", markers: ["@neondatabase/"] },
  { sdk: "PlanetScale database driver", markers: ["@planetscale/"] },
  { sdk: "libSQL client", markers: ["@libsql/"] },
]);

/** The package a bundled module path belongs to (`…/node_modules/@scope/name/…` → `@scope/name`). */
export function packageOfModule(path: string): string | undefined {
  const normalized = path.split("\\").join("/");
  const at = normalized.lastIndexOf("node_modules/");
  if (at < 0) return undefined;
  const parts = normalized.slice(at + "node_modules/".length).split("/");
  const name = parts[0]?.startsWith("@") === true ? parts.slice(0, 2).join("/") : parts[0];
  return name === undefined || name === "" ? undefined : name;
}

/** The provider SDKs found in a bundle, one entry each, sorted (empty when it complies). */
export function providerSdksIn(bundle: string, modules: readonly string[]): string[] {
  const found = new Set<string>();
  for (const module of modules) {
    const name = packageOfModule(module);
    if (name !== undefined && isDeniedPackage(name)) found.add(`package ${name}`);
  }
  for (const { sdk, markers } of PROVIDER_SDK_MARKERS) {
    const marker = markers.find((m) => bundle.includes(m));
    if (marker !== undefined) found.add(`${sdk} (marker "${marker}")`);
  }
  return [...found].sort();
}
