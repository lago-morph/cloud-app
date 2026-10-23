/**
 * `no-transactions` and `no-relational-queries` (CHECK-REQ-001, SQL-REQ-002/-005): members of a
 * database handle that `PortableDb` leaves out, read by member access (also `db["…"]`) or by
 * destructuring, plus Drizzle's `relations` for the relational API.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, mergeListeners, report, typeInfo, type FrameworkRule, type RuleContext } from "../rule-kit.js";
import { forEachValueReference, isDrizzleDatabase, memberName } from "../resolve.js";
import { drizzleName } from "./no-raw-sql.js";

function propertyKey(prop: TSESTree.Property): string | undefined {
  if (!prop.computed && prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal" && typeof prop.key.value === "string") return prop.key.value;
  return undefined;
}

function dbMemberListeners(context: RuleContext, members: ReadonlySet<string>, message: (name: string) => string) {
  return {
    MemberExpression(node: TSESTree.MemberExpression) {
      const name = memberName(node);
      if (name !== undefined && members.has(name) && isDrizzleDatabase(typeInfo(context), node.object)) report(context, node.property, message(name));
    },
    ObjectPattern(node: TSESTree.ObjectPattern) {
      const names = node.properties.flatMap((p) => (p.type === "Property" ? [{ prop: p, key: propertyKey(p) }] : []));
      const hits = names.filter((n) => n.key !== undefined && members.has(n.key));
      if (hits.length === 0 || !isDrizzleDatabase(typeInfo(context), node)) return;
      for (const hit of hits) report(context, hit.prop, message(hit.key ?? ""));
    },
  };
}

export const noTransactions: FrameworkRule = createRule("No interactive transactions or batches; use atomic", (context) =>
  mergeListeners(
    dbMemberListeners(
      context,
      new Set(["transaction", "batch"]),
      (name) => `.${name}() on a database handle: interactive transactions and batches are not portable; use atomic(db, steps) for all-or-nothing writes.`,
    ),
  ),
);

export const noRelationalQueries: FrameworkRule = createRule("No relational query API", (context) =>
  mergeListeners(
    dbMemberListeners(
      context,
      new Set(["query"]),
      () => "db.query (Drizzle's relational query API) is not portable; use select with inner or left joins.",
    ),
    forEachValueReference(context, (node, resolved) => {
      if (resolved.origin === "drizzle" && resolved.topLevel && resolved.name === "relations") {
        report(context, node, `${drizzleName(node, "relations")} declares relational queries, which are not portable; use select with joins.`);
      }
    }),
  ),
);
