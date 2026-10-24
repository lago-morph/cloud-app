/**
 * `browser-api-only` (CHECK-REQ-001, SYS-REQ-008): browser code imports from the framework only
 * through `./client`, and reaches the server only through its helpers: no direct `fetch`,
 * `XMLHttpRequest`, `WebSocket` or `EventSource` (globals recognised by their lib declarations,
 * so `globalThis.fetch`, `window.fetch` and aliases count).
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { codeKind, createRule, mergeListeners, report, typeInfo } from "../rule-kit.js";
import { FRAMEWORK_PACKAGE, forEachValueReference, resolveNode } from "../resolve.js";

const NETWORK_GLOBALS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource"]);
const CLIENT = `${FRAMEWORK_PACKAGE}/client`;

export const browserApiOnly = createRule("Browser code reaches the server only through ./client", (context) => {
  if (codeKind(context) !== "browser") return {};
  const reported = new Set<TSESTree.Node>();
  const network = (node: TSESTree.Node, name: string): void => {
    if (reported.has(node)) return;
    reported.add(node);
    report(context, node, `Direct ${name} use in browser code: reach the server only through the ${CLIENT} helpers (api, uploadFile, downloadUrl, …).`);
  };
  const checkSource = (node: TSESTree.Node, specifier: string): void => {
    if ((specifier === FRAMEWORK_PACKAGE || specifier.startsWith(`${FRAMEWORK_PACKAGE}/`)) && specifier !== CLIENT) {
      report(context, node, `Import of "${specifier}" in browser code: browser code imports from the framework only through "${CLIENT}".`);
    }
  };
  return mergeListeners(
    forEachValueReference(context, (node, resolved) => {
      if (resolved.origin === "lib" && resolved.topLevel && NETWORK_GLOBALS.has(resolved.name)) network(node, resolved.name);
    }),
    {
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        checkSource(node.source, node.source.value);
      },
      ExportNamedDeclaration(node: TSESTree.ExportNamedDeclaration) {
        if (node.source !== null) checkSource(node.source, node.source.value);
      },
      ExportAllDeclaration(node: TSESTree.ExportAllDeclaration) {
        checkSource(node.source, node.source.value);
      },
      ImportExpression(node: TSESTree.ImportExpression) {
        if (node.source.type === "Literal" && typeof node.source.value === "string") checkSource(node.source, node.source.value);
      },
      MemberExpression(node: TSESTree.MemberExpression) {
        if (node.computed || node.property.type !== "Identifier" || !NETWORK_GLOBALS.has(node.property.name)) return;
        const resolved = resolveNode(typeInfo(context), node.property);
        if (resolved?.origin === "lib") network(node.property, resolved.name);
      },
    },
  );
});
