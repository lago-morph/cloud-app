/**
 * Shared plumbing for the framework's ESLint rules: one message shape, type information from
 * the TypeScript program, and the path classification of the file being linted.
 */
import { relative } from "node:path";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";
import type ts from "typescript";
import { classifyPath, type CodeKind } from "./paths.js";

export type MessageId = "report";
export type RuleContext = Readonly<TSESLint.RuleContext<MessageId, []>>;
export type RuleListener = TSESLint.RuleListener;
export type FrameworkRule = TSESLint.RuleModule<MessageId, []>;

export function createRule(description: string, create: (context: RuleContext) => RuleListener): FrameworkRule {
  return {
    defaultOptions: [],
    meta: { type: "problem", docs: { description }, schema: [], messages: { report: "{{message}}" } },
    create,
  };
}

export function report(context: RuleContext, node: TSESTree.Node | TSESTree.Token, message: string): void {
  context.report({ loc: node.loc, messageId: "report", data: { message } });
}

export interface TypeInfo {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  tsNode(node: TSESTree.Node): ts.Node;
}

/** Type information for the file; the rules need it (they resolve aliases and re-exports). */
export function typeInfo(context: RuleContext): TypeInfo {
  const services = context.sourceCode.parserServices;
  const program = services?.program;
  const map = services?.esTreeNodeToTSNodeMap;
  if (program === undefined || program === null || map === undefined) {
    throw new Error("prototype-framework rules need type information (parserOptions.programs or projectService)");
  }
  return { program, checker: program.getTypeChecker(), tsNode: (node) => map.get(node) };
}

/** The linted file's app code kind, from its path relative to the lint working directory. */
export function codeKind(context: RuleContext): CodeKind | undefined {
  return classifyPath(relative(context.cwd, context.filename));
}
