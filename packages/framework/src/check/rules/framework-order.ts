/**
 * `framework-order` (CHECK-REQ-001, SQL-REQ-002/-003): ordering only with the framework's `asc`
 * and `desc` (explicit NULL placement). Drizzle's own `asc`/`desc` are rejected wherever they
 * are referenced; every `orderBy` argument must be a call of the framework's helpers.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, mergeListeners, report, typeInfo } from "../rule-kit.js";
import { forEachValueReference, isDrizzleMember, memberName, resolveCallee } from "../resolve.js";
import { drizzleName } from "./no-raw-sql.js";

const ORDER_HELPERS = new Set(["asc", "desc"]);

const HINT = "order with the framework's asc/desc, which place NULLs the same on every target";

export const frameworkOrder = createRule("Ordering only with the framework's asc/desc", (context) =>
  mergeListeners(
    forEachValueReference(context, (node, resolved) => {
      if (resolved.origin !== "drizzle" || !resolved.topLevel || !ORDER_HELPERS.has(resolved.name)) return;
      report(context, node, `Ordering with ${drizzleName(node, resolved.name)}; ${HINT}.`);
    }),
    {
      CallExpression(node: TSESTree.CallExpression) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || memberName(callee) !== "orderBy") return;
        const info = typeInfo(context);
        if (!isDrizzleMember(info, callee)) return;
        for (const arg of node.arguments) {
          if (arg.type === "CallExpression") {
            const target = resolveCallee(info, arg.callee);
            // Drizzle's helpers are reported where they are referenced.
            if (target !== undefined && ORDER_HELPERS.has(target.name) && (target.origin === "framework" || target.origin === "drizzle")) continue;
          }
          const text = context.sourceCode.getText(arg);
          report(context, arg, `orderBy(${text.length > 40 ? `${text.slice(0, 40)}…` : text}) does not use the framework's asc/desc; ${HINT}.`);
        }
      },
    },
  ),
);
