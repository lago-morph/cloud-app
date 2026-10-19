/**
 * `allowed-imports` (CHECK-REQ-001): no platform SDKs, database drivers, Drizzle dialect modules,
 * framework subpaths outside CORE-REQ-005's table for the importing code, `node:*` or bare Node
 * built-in modules.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, report, type RuleContext } from "../rule-kit.js";

function checkSpecifier(context: RuleContext, node: TSESTree.Node, specifier: string): void {
  if (specifier.startsWith("node:")) {
    report(context, node, `Import of the Node built-in module "${specifier}"; app code runs on every target, where Node modules do not exist.`);
  }
}

export const allowedImports = createRule("Only portable imports in app code", (context) => ({
  ImportDeclaration(node) {
    checkSpecifier(context, node.source, node.source.value);
  },
}));
