/**
 * Type-information helpers shared by the rules: where a referenced value is really declared
 * (through aliases, re-exports, namespace imports and `const` copies), so rules never rely on
 * identifier spelling (CHECK-REQ-001).
 */
import { realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { TSESTree } from "@typescript-eslint/utils";
import ts from "typescript";
import type { RuleContext, TypeInfo } from "./rule-kit.js";
import { typeInfo } from "./rule-kit.js";

export const FRAMEWORK_PACKAGE = "@lago-morph/prototype-framework";

function realpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** This package's root directory (from `src/check/` or `dist/check/`), symlinks resolved. */
const FRAMEWORK_ROOT = realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));

export type Origin = "framework" | "drizzle" | "hono" | "lib" | "app";

export function originOfFile(program: ts.Program, sourceFile: ts.SourceFile): Origin {
  const name = sourceFile.fileName.split("/").join(sep);
  if (program.isSourceFileDefaultLibrary(sourceFile)) return "lib";
  if (name.startsWith(FRAMEWORK_ROOT + sep) && !name.includes(`${sep}node_modules${sep}`)) return "framework";
  if (name.includes(`${sep}node_modules${sep}drizzle-orm${sep}`)) return "drizzle";
  if (name.includes(`${sep}node_modules${sep}hono${sep}`)) return "hono";
  return "app";
}

export interface Resolved {
  readonly origin: Origin;
  /** The name at the declaration (e.g. `sql` for an import `sql as q`). */
  readonly name: string;
  /** Declared at module level (not a member of a class, interface or namespace). */
  readonly topLevel: boolean;
  readonly declaration: ts.Declaration;
}

function isTopLevel(decl: ts.Node): boolean {
  let node: ts.Node = decl;
  if (ts.isVariableDeclaration(node)) node = node.parent.parent;
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  return ts.isSourceFile(parent) || (ts.isModuleBlock(parent) && ts.isStringLiteral(parent.parent.name));
}

/** The symbol a reference really denotes: aliases followed, `const x = y` copies followed. */
export function resolveSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  let current = symbol;
  for (let i = 0; i < 16; i++) {
    if ((current.flags & ts.SymbolFlags.Alias) !== 0) {
      const target = checker.getAliasedSymbol(current);
      if (target === current || (target.flags & ts.SymbolFlags.Alias) !== 0) return target;
      current = target;
      continue;
    }
    const decl = current.valueDeclaration;
    if (decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined && (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0) {
      const init = skipOuterExpressions(decl.initializer);
      if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) {
        const next = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(init) ? init.name : init);
        if (next !== undefined && next !== current) {
          current = next;
          continue;
        }
      }
    }
    return current;
  }
  return current;
}

function skipOuterExpressions(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

export function describeSymbol(info: TypeInfo, symbol: ts.Symbol): Resolved | undefined {
  const target = resolveSymbol(info.checker, symbol);
  const declaration = target.declarations?.[0];
  if (declaration === undefined) return undefined;
  return {
    origin: originOfFile(info.program, declaration.getSourceFile()),
    name: target.name,
    topLevel: isTopLevel(declaration),
    declaration,
  };
}

/** What an ESTree identifier (or member name) refers to; undefined when unresolved. */
export function resolveNode(info: TypeInfo, node: TSESTree.Node): Resolved | undefined {
  const symbol = info.checker.getSymbolAtLocation(info.tsNode(node));
  return symbol === undefined ? undefined : describeSymbol(info, symbol);
}

/** What a call's callee (or a tagged template's tag) refers to. */
export function resolveCallee(info: TypeInfo, callee: TSESTree.Node): Resolved | undefined {
  if (callee.type === "MemberExpression" && !callee.computed) return resolveNode(info, callee.property);
  return resolveNode(info, callee);
}

const TYPE_CONTEXT = new Set([
  "TSTypeAnnotation", "TSTypeReference", "TSQualifiedName", "TSTypeQuery", "TSTypeParameterInstantiation",
  "TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSInterfaceHeritage", "TSClassImplements", "TSImportType",
]);

function inTypeContext(node: TSESTree.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (TYPE_CONTEXT.has(current.type)) return true;
    if (current.type.endsWith("Statement") || current.type === "Program") return false;
  }
  return false;
}

/**
 * Calls `onReference` for every value reference in the file: identifiers bound by imports or
 * declarations (via scope analysis), re-export specifiers (`export { x as y } from "m"`) and
 * module-level members reached through namespace objects (`d.like`).
 */
export function forEachValueReference(
  context: RuleContext,
  onReference: (node: TSESTree.Node, resolved: Resolved, info: TypeInfo) => void,
): Record<string, (node: never) => void> {
  const visit = (node: TSESTree.Node): void => {
    const info = typeInfo(context);
    const resolved = resolveNode(info, node);
    if (resolved !== undefined) onReference(node, resolved, info);
  };
  return {
    "Program:exit"(program: TSESTree.Program) {
      const seen = new Set<TSESTree.Node>();
      const scopes = [context.sourceCode.getScope(program)];
      while (scopes.length > 0) {
        const scope = scopes.pop();
        if (scope === undefined) break;
        scopes.push(...scope.childScopes);
        for (const ref of scope.references) {
          const id = ref.identifier;
          if (!ref.isValueReference || seen.has(id) || id.type !== "Identifier" || inTypeContext(id)) continue;
          seen.add(id);
          visit(id);
        }
      }
    },
    ExportSpecifier(node: TSESTree.ExportSpecifier) {
      if (node.parent.type === "ExportNamedDeclaration" && node.parent.source !== null && node.parent.exportKind !== "type" && node.exportKind !== "type") {
        visit(node.local);
      }
    },
    MemberExpression(node: TSESTree.MemberExpression) {
      if (node.computed || inTypeContext(node)) return;
      const info = typeInfo(context);
      const objectSymbol = info.checker.getSymbolAtLocation(info.tsNode(node.object));
      if (objectSymbol === undefined) return;
      const target = resolveSymbol(info.checker, objectSymbol);
      if ((target.flags & ts.SymbolFlags.ValueModule) === 0) return;
      visit(node.property);
    },
  };
}

function declaredIn(info: TypeInfo, symbol: ts.Symbol | undefined, origin: Origin): boolean {
  const decl = symbol?.declarations?.[0];
  return decl !== undefined && originOfFile(info.program, decl.getSourceFile()) === origin;
}

/**
 * A Drizzle database handle (`PortableDb`, `WriteDb`, or any Drizzle database): its type has
 * Drizzle's `insert` method.
 */
export function isDrizzleDatabase(info: TypeInfo, node: TSESTree.Node): boolean {
  const type = info.checker.getTypeAtLocation(info.tsNode(node));
  return [type, ...(type.isUnion() ? type.types : [])].some((t) => declaredIn(info, t.getProperty("insert"), "drizzle"));
}

/** A member of a Drizzle query builder or database (`.rightJoin`, `.orderBy`, `.$with`, …). */
export function isDrizzleMember(info: TypeInfo, member: TSESTree.MemberExpression): boolean {
  if (member.computed) return false;
  const symbol = info.checker.getSymbolAtLocation(info.tsNode(member.property));
  return declaredIn(info, symbol, "drizzle");
}

/** A value whose type is declared by Hono under one of `names` (e.g. `Context`, `Hono`). */
export function isHonoType(info: TypeInfo, node: TSESTree.Node, names: readonly string[]): boolean {
  const type = info.checker.getTypeAtLocation(info.tsNode(node));
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  return symbol !== undefined && names.includes(symbol.name) && declaredIn(info, symbol, "hono");
}

/** The static name of a member access (`a.b` or `a["b"]`), if any. */
export function memberName(member: TSESTree.MemberExpression): string | undefined {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.computed && member.property.type === "Literal" && typeof member.property.value === "string") return member.property.value;
  return undefined;
}
