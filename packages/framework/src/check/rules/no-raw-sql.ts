/**
 * `no-raw-sql` (CHECK-REQ-001, SQL-REQ-002): Drizzle's `sql` tag and its helpers, and low-level
 * execution on database handles. Excluded features that only raw SQL reaches (window functions,
 * JSON operators, full-text search) are rejected here.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, mergeListeners, report, typeInfo } from "../rule-kit.js";
import { forEachValueReference, isDrizzleDatabase, memberName } from "../resolve.js";

/** Drizzle exports that build or carry raw SQL. */
export const RAW_SQL_EXPORTS: ReadonlySet<string> = new Set([
  "sql", "SQL", "placeholder", "Placeholder", "param", "Param", "name", "Name", "StringChunk", "fillPlaceholders",
]);

/** Low-level execution members of a Drizzle database. */
const EXECUTION_MEMBERS = new Set(["execute", "run", "all", "get", "values", "$client", "session", "dialect", "_"]);

const HINT = "use the framework's query API instead (sql.md §2.3, \"Common needs\")";

/** `"q" (drizzle-orm's sql)` for an alias, `drizzle-orm's sql` otherwise. */
export function drizzleName(node: TSESTree.Node, name: string): string {
  return node.type === "Identifier" && node.name !== name ? `"${node.name}" (drizzle-orm's ${name})` : `drizzle-orm's ${name}`;
}

export const noRawSql = createRule("No raw SQL or low-level database execution", (context) =>
  mergeListeners(
    forEachValueReference(context, (node, resolved) => {
      if (resolved.origin !== "drizzle" || !resolved.topLevel || !RAW_SQL_EXPORTS.has(resolved.name)) return;
      report(context, node, `Raw SQL through ${drizzleName(node, resolved.name)}; ${HINT}.`);
    }),
    {
      MemberExpression(node: TSESTree.MemberExpression) {
        const name = memberName(node);
        if (name === undefined || !EXECUTION_MEMBERS.has(name)) return;
        if (!isDrizzleDatabase(typeInfo(context), node.object)) return;
        report(context, node.property, `Low-level database execution (${name}); ${HINT}.`);
      },
    },
  ),
);
