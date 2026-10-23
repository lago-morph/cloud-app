/**
 * `framework-ids` (CHECK-REQ-001, SQL-REQ-001): values written to `id()` columns come from
 * `newId()`, and `id()` columns are never updated. Static and narrow by design: an inserted ID
 * that is a literal, a template, or a call or construction other than the framework's `newId`
 * (directly or through `const` bindings) is rejected; values the rule cannot trace (parameters,
 * properties) are left to the run-time value rule (SQL-REQ-004).
 */
import type { TSESTree } from "@typescript-eslint/utils";
import ts from "typescript";
import { createRule, report, typeInfo, type TypeInfo } from "../rule-kit.js";
import { describeSymbol, isDrizzleMember, memberName, tableColumns } from "../resolve.js";

function shortText(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

/** Why an inserted ID value is not from `newId()`; undefined when it is (or cannot be traced). */
function idValueProblem(info: TypeInfo, expr: ts.Node, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr)) {
    return idValueProblem(info, expr.expression, depth + 1);
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || ts.isTemplateExpression(expr) || ts.isNumericLiteral(expr)) {
    return `the literal ${shortText(expr.getText())}`;
  }
  if (ts.isCallExpression(expr)) {
    const symbol = info.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expr.expression) ? expr.expression.name : expr.expression);
    const target = symbol === undefined ? undefined : describeSymbol(info, symbol);
    if (target?.origin === "framework" && target.name === "newId") return undefined;
    return `${shortText(expr.getText())}`;
  }
  if (ts.isNewExpression(expr)) return shortText(expr.getText());
  if (ts.isIdentifier(expr)) {
    const symbol = info.checker.getSymbolAtLocation(expr);
    const decl = symbol?.valueDeclaration;
    if (decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined && (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0) {
      const inner = idValueProblem(info, decl.initializer, depth + 1);
      return inner === undefined ? undefined : `"${expr.text}" (${inner})`;
    }
  }
  return undefined;
}

function propertyKey(prop: TSESTree.Property): string | undefined {
  if (!prop.computed && prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal" && typeof prop.key.value === "string") return prop.key.value;
  return undefined;
}

/** The table a builder chain was started on: `db.insert(t)…`, `db.update(t)…`. */
function chainTable(node: TSESTree.Node, method: string): TSESTree.Node | undefined {
  let current: TSESTree.Node = node;
  while (current.type === "CallExpression" && current.callee.type === "MemberExpression") {
    if (memberName(current.callee) === method && current.callee.object.type !== "CallExpression") {
      const table = current.arguments[0];
      return table?.type === "SpreadElement" ? undefined : table;
    }
    current = current.callee.object;
  }
  return undefined;
}

function idKeys(info: TypeInfo, table: TSESTree.Node | undefined): Set<string> {
  const columns = table === undefined ? undefined : tableColumns(info, table);
  if (columns === undefined) return new Set(["id"]);
  return new Set([...columns].filter(([, kind]) => kind === "id").map(([key]) => key));
}

function objectArgs(arg: TSESTree.Node | undefined): TSESTree.ObjectExpression[] {
  if (arg?.type === "ObjectExpression") return [arg];
  if (arg?.type === "ArrayExpression") return arg.elements.flatMap((e) => (e?.type === "ObjectExpression" ? [e] : []));
  return [];
}

const ID_HINT = "id() columns hold IDs from newId() only";

export const frameworkIds = createRule("IDs only from newId(); id() columns are immutable", (context) => ({
  CallExpression(node) {
    const callee = node.callee;
    if (callee.type !== "MemberExpression") return;
    const name = memberName(callee);
    if (name !== "values" && name !== "set" && name !== "onConflictDoUpdate") return;
    const info = typeInfo(context);
    if (!isDrizzleMember(info, callee)) return;
    const builder = callee.object;

    if (name === "values") {
      const keys = idKeys(info, chainTable(builder, "insert"));
      for (const object of objectArgs(node.arguments[0])) {
        for (const prop of object.properties) {
          if (prop.type !== "Property" || !keys.has(propertyKey(prop) ?? "")) continue;
          const problem = idValueProblem(info, info.tsNode(prop.value));
          if (problem !== undefined) report(context, prop, `id value ${problem} is not from newId(); ${ID_HINT}.`);
        }
      }
      return;
    }

    const table = name === "set" ? chainTable(builder, "update") : chainTable(builder, "insert");
    const keys = idKeys(info, table);
    let sets = objectArgs(node.arguments[0]);
    if (name === "onConflictDoUpdate") {
      sets = sets.flatMap((o) => o.properties.flatMap((p) => (p.type === "Property" && propertyKey(p) === "set" ? objectArgs(p.value) : [])));
    }
    for (const object of sets) {
      for (const prop of object.properties) {
        const key = prop.type === "Property" ? propertyKey(prop) : undefined;
        if (key !== undefined && keys.has(key)) report(context, prop, `update of the id() column "${key}": IDs are immutable; ${ID_HINT}.`);
      }
    }
  },
}));
