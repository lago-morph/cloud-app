/**
 * `no-raw-html` (CHECK-REQ-001, last paragraph): browser code does not insert raw HTML. Rejects
 * the DOM sinks (`innerHTML`/`outerHTML` writes, `insertAdjacentHTML`, `document.write(ln)`,
 * `createContextualFragment`, `setHTMLUnsafe`) and React's `dangerouslySetInnerHTML`.
 * The framework's own rule instead of a third-party plugin (no plugin is pinned in
 * parameters.md; DEC-PENDING-B-14-4).
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { codeKind, createRule, report } from "../rule-kit.js";
import { memberName } from "../resolve.js";

const PROPERTY_SINKS = new Set(["innerHTML", "outerHTML"]);
const METHOD_SINKS = new Set(["insertAdjacentHTML", "createContextualFragment", "setHTMLUnsafe"]);
const HINT = "raw HTML in the page can run injected script; set textContent or build elements instead";

function isDocument(node: TSESTree.Node): boolean {
  return (node.type === "Identifier" && node.name === "document") || (node.type === "MemberExpression" && memberName(node) === "document");
}

export const noRawHtml = createRule("No raw-HTML insertion in browser code", (context) => {
  if (codeKind(context) !== "browser") return {};
  return {
    AssignmentExpression(node) {
      if (node.left.type !== "MemberExpression") return;
      const name = memberName(node.left);
      if (name !== undefined && PROPERTY_SINKS.has(name)) report(context, node.left, `Writing ${name}: ${HINT}.`);
    },
    CallExpression(node) {
      if (node.callee.type !== "MemberExpression") return;
      const name = memberName(node.callee);
      if (name === undefined) return;
      if (METHOD_SINKS.has(name)) report(context, node.callee, `${name}(): ${HINT}.`);
      else if ((name === "write" || name === "writeln") && isDocument(node.callee.object)) report(context, node.callee, `document.${name}(): ${HINT}.`);
    },
    JSXAttribute(node) {
      if (node.name.type === "JSXIdentifier" && node.name.name === "dangerouslySetInnerHTML") {
        report(context, node, `dangerouslySetInnerHTML: ${HINT}.`);
      }
    },
  };
});
