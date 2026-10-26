/**
 * `allowed-imports` (CHECK-REQ-001, CORE-REQ-005): no platform SDKs, database drivers, Drizzle
 * dialect modules, framework subpaths outside the importing code's row of CORE-REQ-005's table,
 * `node:*` or bare Node built-in modules. Shared code imports only `zod` and shared code; browser
 * code imports `src/shared/` only type-only. Static, dynamic and `require`-style imports and
 * re-exports are checked; a named import from a local module is followed through that module's
 * re-exports, so a forbidden module cannot be laundered through a local file. An npm alias the
 * app's `package.json` declares (`"s3": "npm:@aws-sdk/client-s3@^3"`) is judged by the package it
 * installs as well, so a denied package cannot be imported under another name.
 * Framework imports in browser code are `browser-api-only`'s.
 */
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import type { TSESTree } from "@typescript-eslint/utils";
import ts from "typescript";
import { classifyPath, type CodeKind } from "../paths.js";
import { codeKind, createRule, report, typeInfo } from "../rule-kit.js";
import { isDeniedPackage, npmAliasTarget } from "../denied-packages.js";
import { FRAMEWORK_PACKAGE } from "../resolve.js";

const BUILTINS = new Set(builtinModules.filter((m) => !m.startsWith("_")));

/** Hono subpaths that expose a platform (adapters, `env()`, connection info). */
const HONO_PLATFORM = /^hono\/(?:adapter|cloudflare-workers|cloudflare-pages|aws-lambda|lambda-edge|bun|deno|vercel|netlify|service-worker|conninfo)(?:\/|$)/;

/** CORE-REQ-005: framework subpaths each kind of app code may import (browser: `browser-api-only`). */
const FRAMEWORK_SUBPATHS: Readonly<Record<Exclude<CodeKind, "browser">, readonly string[]>> = {
  server: ["."],
  test: [".", "./testing"],
  shared: [],
};

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** The app's npm aliases (`"s3": "npm:@aws-sdk/client-s3@^3"` → s3 → @aws-sdk/client-s3), from its `package.json`. */
export function appAliases(appDir: string): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return aliases;
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = manifest[field];
    if (typeof deps !== "object" || deps === null) continue;
    for (const [alias, spec] of Object.entries(deps as Record<string, unknown>)) {
      const target = npmAliasTarget(spec);
      if (target !== undefined && target !== alias) aliases.set(alias, target);
    }
  }
  return aliases;
}

/**
 * Why a bare (package or scheme) specifier is not allowed in this kind of code; undefined if
 * allowed. An npm alias in `aliases` is judged by the package it installs as well.
 */
export function packageImportProblem(specifier: string, kind: CodeKind, aliases: ReadonlyMap<string, string> = new Map()): string | undefined {
  const real = specifier.startsWith(".") || specifier.includes(":") ? undefined : aliases.get(packageName(specifier));
  if (real !== undefined) {
    const realSpecifier = `${real}${specifier.slice(packageName(specifier).length)}`;
    const problem = packageImportProblem(realSpecifier, kind);
    if (problem !== undefined) return `"${specifier}" is an npm alias of "${real}", and ${problem}`;
  }
  return directPackageImportProblem(specifier, kind);
}

function directPackageImportProblem(specifier: string, kind: CodeKind): string | undefined {
  if (specifier.startsWith("node:")) return `the Node built-in module "${specifier}" does not exist on every target`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return `"${specifier}" is a platform module`;
  const name = packageName(specifier);
  if (BUILTINS.has(specifier) || BUILTINS.has(name)) return `"${specifier}" is a Node built-in module, which does not exist on every target`;
  if (name === FRAMEWORK_PACKAGE) {
    if (kind === "browser") return undefined;
    const subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
    const allowed = FRAMEWORK_SUBPATHS[kind];
    if (allowed.includes(subpath)) return undefined;
    const may = allowed.length === 0 ? "nothing" : allowed.map((s) => `"${s === "." ? name : name + s.slice(1)}"`).join(" and ");
    return `${kind} code may import ${may} from the framework (CORE-REQ-005), not "${specifier}"`;
  }
  if (kind === "shared") {
    return name === "zod" ? undefined : `shared code imports only "zod" and other shared code, not "${specifier}"`;
  }
  if (name === "drizzle-orm" && specifier !== name) return `"${specifier}" is a Drizzle dialect module; use the framework's SQL API`;
  if (HONO_PLATFORM.test(specifier)) return `"${specifier}" is a platform-specific Hono module`;
  if (isDeniedPackage(name)) return `"${specifier}" is a platform SDK or database driver`;
  return undefined;
}

/** Why an app-local (relative) import is not allowed; undefined if allowed. */
function localImportProblem(specifier: string, from: CodeKind, target: CodeKind | undefined, typeOnly: boolean): string | undefined {
  if (target === undefined || from === "test") return undefined;
  if (from === "browser") {
    if (target === "browser") return undefined;
    if (target === "shared") return typeOnly ? undefined : `browser code may import "${specifier}" (shared code) only with a type-only import`;
    return `browser code may not import ${target} code ("${specifier}")`;
  }
  if (from === "shared") return target === "shared" ? undefined : `shared code may not import ${target} code ("${specifier}")`;
  return target === "browser" || target === "test" ? `server code may not import ${target} code ("${specifier}")` : undefined;
}

function isLocal(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

function allTypeOnly(node: TSESTree.ImportDeclaration | TSESTree.ExportNamedDeclaration | TSESTree.ExportAllDeclaration): boolean {
  if (node.type === "ImportDeclaration") {
    if (node.importKind === "type") return true;
    return node.specifiers.length > 0 && node.specifiers.every((s) => s.type === "ImportSpecifier" && s.importKind === "type");
  }
  if (node.exportKind === "type") return true;
  return node.type === "ExportNamedDeclaration" && node.specifiers.length > 0 && node.specifiers.every((s) => s.exportKind === "type");
}

function moduleOfExportSpecifier(decl: ts.Declaration): string | undefined {
  if (!ts.isExportSpecifier(decl)) return undefined;
  const exportDecl = decl.parent.parent;
  const spec = exportDecl.moduleSpecifier;
  return spec !== undefined && ts.isStringLiteral(spec) ? spec.text : undefined;
}

export const allowedImports = createRule("Only portable imports in app code", (context) => {
  const kind = codeKind(context);
  if (kind === undefined) return {};
  const fileDir = dirname(context.filename);
  const aliases = appAliases(context.cwd);

  const check = (node: TSESTree.Node, specifier: string, typeOnly: boolean): void => {
    let problem: string | undefined;
    if (isLocal(specifier)) {
      const target = posix.normalize(relative(context.cwd, posix.join(fileDir.split("\\").join("/"), specifier)).split("\\").join("/"));
      problem = localImportProblem(specifier, kind, classifyPath(target), typeOnly);
    } else {
      problem = packageImportProblem(specifier, kind, aliases);
    }
    if (problem !== undefined) report(context, node, `Import of "${specifier}": ${problem}.`);
  };

  /** Follows each named import from a local module through re-exports to the module it came from. */
  const followReexports = (node: TSESTree.ImportDeclaration): void => {
    const { checker, tsNode } = typeInfo(context);
    for (const specifier of node.specifiers) {
      if (specifier.type !== "ImportSpecifier") continue;
      let symbol = checker.getSymbolAtLocation(tsNode(specifier.local));
      for (let hop = 0; symbol !== undefined && hop < 16; hop++) {
        if ((symbol.flags & ts.SymbolFlags.Alias) === 0) break;
        const next: ts.Symbol | undefined = checker.getImmediateAliasedSymbol(symbol);
        if (next === undefined) break;
        for (const decl of next.declarations ?? []) {
          const from = moduleOfExportSpecifier(decl);
          if (from === undefined || isLocal(from)) continue;
          const problem = packageImportProblem(from, kind, aliases);
          if (problem !== undefined) {
            report(context, specifier, `Import of "${specifier.local.name}" from "${String(node.source.value)}", which re-exports it from "${from}": ${problem}.`);
            return;
          }
        }
        symbol = next;
      }
    }
  };

  const checkCall = (node: TSESTree.Node, source: TSESTree.Node): void => {
    if (source.type === "Literal" && typeof source.value === "string") check(node, source.value, false);
    else if (source.type === "TemplateLiteral" && source.expressions.length === 0) check(node, source.quasis[0]?.value.cooked ?? "", false);
    else report(context, node, "A dynamic import with a computed specifier cannot be checked; import a fixed module name.");
  };

  return {
    ImportDeclaration(node) {
      check(node.source, node.source.value, allTypeOnly(node));
      if (isLocal(node.source.value)) followReexports(node);
    },
    ExportNamedDeclaration(node) {
      if (node.source !== null) check(node.source, node.source.value, allTypeOnly(node));
    },
    ExportAllDeclaration(node) {
      check(node.source, node.source.value, allTypeOnly(node));
    },
    ImportExpression(node) {
      checkCall(node, node.source);
    },
    TSImportEqualsDeclaration(node) {
      const ref = node.moduleReference;
      if (ref.type === "TSExternalModuleReference" && ref.expression.type === "Literal" && typeof ref.expression.value === "string") {
        check(ref.expression, ref.expression.value, node.importKind === "type");
      }
    },
    TSImportType(node) {
      const arg = node.argument;
      if (arg.type === "TSLiteralType" && arg.literal.type === "Literal" && typeof arg.literal.value === "string") {
        check(arg, arg.literal.value, true);
      }
    },
    CallExpression(node) {
      const first = node.arguments[0];
      if (node.callee.type === "Identifier" && node.callee.name === "require" && first !== undefined) checkCall(node, first);
    },
  };
});
