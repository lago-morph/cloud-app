/**
 * `no-dialect-features` (CHECK-REQ-001, SQL-REQ-002): query features outside sql.md §2.3,
 * wherever they appear (also inside subqueries and common table expressions):
 * - Drizzle expressions the framework does not export (`like`, `ilike`, `exists`, Drizzle's `sum`, …);
 * - right, full, cross and lateral joins, set operations, row locking (`.for(...)`);
 * - data-modifying common table expressions (`$with(...).as(insert/update/delete)`);
 * - aggregate argument types: `min`/`max` not on boolean columns, `sum`/`avg` only on integer
 *   and number columns.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, mergeListeners, report, typeInfo } from "../rule-kit.js";
import { columnKind, forEachValueReference, isDrizzleMember, memberName, resolveCallee, type ColumnKind } from "../resolve.js";
import { drizzleName, RAW_SQL_EXPORTS } from "./no-raw-sql.js";

/** Drizzle expressions the framework re-exports (sql.d.ts): allowed wherever they come from. */
export const SUPPORTED_DRIZZLE_EXPORTS: ReadonlySet<string> = new Set([
  "eq", "ne", "gt", "gte", "lt", "lte", "and", "or", "not", "isNull", "isNotNull", "inArray", "notInArray", "between",
  "count", "countDistinct", "min", "max",
]);

/** Drizzle exports other rules own (ordering, relational queries). */
const OTHER_RULES = new Set(["asc", "desc", "relations"]);

const UNSUPPORTED_MEMBERS = new Set([
  "rightJoin", "fullJoin", "crossJoin", "innerJoinLateral", "leftJoinLateral", "crossJoinLateral",
  "for", "union", "unionAll", "intersect", "intersectAll", "except", "exceptAll",
]);

const WRITES = new Set(["insert", "update", "delete"]);

const AGGREGATE_KINDS: Readonly<Record<string, readonly ColumnKind[]>> = {
  min: ["text", "integer", "number", "timestamp", "id", "ref"],
  max: ["text", "integer", "number", "timestamp", "id", "ref"],
  sum: ["integer", "number"],
  avg: ["integer", "number"],
};

const HINT = "it is outside the portable query subset (sql.md §2.3)";

/** The first method of a builder chain (`db.insert(t).values(…)` → `insert`). */
function rootMethod(node: TSESTree.Node): string | undefined {
  let current = node;
  for (;;) {
    if (current.type !== "CallExpression" || current.callee.type !== "MemberExpression") return undefined;
    const object = current.callee.object;
    if (object.type !== "CallExpression") return memberName(current.callee);
    current = object;
  }
}

function shortText(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export const noDialectFeatures = createRule("Only the portable query subset", (context) =>
  mergeListeners(
    forEachValueReference(context, (node, resolved) => {
      // Drizzle's SQL expressions and functions (`drizzle-orm/sql/…`); dialect modules
      // (`pgTable`, `drizzle`, …) are allowed-imports' and reported once, at the import.
      if (resolved.origin !== "drizzle" || !resolved.topLevel || !resolved.fileName.includes("/drizzle-orm/sql/")) return;
      if (SUPPORTED_DRIZZLE_EXPORTS.has(resolved.name) || RAW_SQL_EXPORTS.has(resolved.name) || OTHER_RULES.has(resolved.name)) return;
      report(context, node, `${drizzleName(node, resolved.name)}: ${HINT}.`);
    }),
    {
      MemberExpression(node: TSESTree.MemberExpression) {
        const name = memberName(node);
        if (name === undefined || !UNSUPPORTED_MEMBERS.has(name) || !isDrizzleMember(typeInfo(context), node)) return;
        report(context, node.property, `.${name}(): ${HINT}; use inner or left joins and the framework's operators.`);
      },
      CallExpression(node: TSESTree.CallExpression) {
        const info = typeInfo(context);
        const callee = node.callee;
        // $with(name).as(<write>)
        if (callee.type === "MemberExpression" && memberName(callee) === "as" && callee.object.type === "CallExpression") {
          const withCall = callee.object.callee;
          const write = node.arguments[0];
          if (withCall.type === "MemberExpression" && memberName(withCall) === "$with" && isDrizzleMember(info, withCall) && write !== undefined) {
            const root = rootMethod(write);
            if (root !== undefined && WRITES.has(root)) {
              report(context, write, `$with(…).as(${root} …) is a data-modifying common table expression: ${HINT}; only select-only CTEs are portable.`);
            }
          }
        }
        // Aggregate argument types.
        const target = resolveCallee(info, callee);
        const arg = node.arguments[0];
        if (target === undefined || arg === undefined) return;
        const isAggregate =
          (target.origin === "drizzle" && (target.name === "min" || target.name === "max")) ||
          (target.origin === "framework" && (target.name === "sum" || target.name === "avg"));
        if (!isAggregate) return;
        const allowed = AGGREGATE_KINDS[target.name] ?? [];
        const kind = columnKind(info, arg);
        if (kind === undefined || allowed.includes(kind)) return;
        report(
          context,
          node,
          `${target.name}(${shortText(context.sourceCode.getText(arg))}) on ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} column: ${HINT}; ${target.name} accepts ${allowed.filter((k) => k !== "id" && k !== "ref").join(", ")} columns.`,
        );
      },
    },
  ),
);
