/**
 * `no-env-access` (CHECK-REQ-001, SYS-REQ-005): no `process.env`, `import.meta.env`, Hono's
 * `c.env` or `c.executionCtx` (platform bindings), and no replacing the framework's error and
 * not-found handlers. Hono values are recognised by type, so aliases and destructuring count.
 */
import type { TSESTree } from "@typescript-eslint/utils";
import { createRule, report, typeInfo, type RuleContext } from "../rule-kit.js";
import { isHonoType, memberName } from "../resolve.js";

const CONTEXT_MEMBERS = new Set(["env", "executionCtx"]);
const HANDLERS = new Set(["onError", "notFound"]);

const ENV_HINT = "read configuration and secrets through c.var.config and c.var.secrets";

function isProcess(node: TSESTree.Node): boolean {
  if (node.type === "Identifier") return node.name === "process";
  return node.type === "MemberExpression" && memberName(node) === "process";
}

function isImportMeta(node: TSESTree.Node): boolean {
  return node.type === "MetaProperty" && node.meta.name === "import" && node.property.name === "meta";
}

function checkContextMember(context: RuleContext, at: TSESTree.Node, name: string, object: TSESTree.Node): void {
  if (name === "env" && isProcess(object)) {
    report(context, at, `process.env: environment variables differ per target; ${ENV_HINT}.`);
  } else if (name === "env" && isImportMeta(object)) {
    report(context, at, `import.meta.env: build-time environment differs per target; ${ENV_HINT}.`);
  } else if (CONTEXT_MEMBERS.has(name) && isHonoType(typeInfo(context), object, ["Context"])) {
    report(context, at, `Hono's c.${name} exposes platform bindings; ${ENV_HINT}, and the other services in c.var.`);
  }
}

function propertyKey(prop: TSESTree.Property): string | undefined {
  if (!prop.computed && prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal" && typeof prop.key.value === "string") return prop.key.value;
  return undefined;
}

export const noEnvAccess = createRule("No environment or platform-binding access; framework handlers stay", (context) => ({
  MemberExpression(node) {
    const name = memberName(node);
    if (name === undefined) return;
    if (HANDLERS.has(name)) {
      if (isHonoType(typeInfo(context), node.object, ["Hono", "HonoBase"])) {
        report(context, node.property, `${name}() replaces the framework's ${name === "onError" ? "error" : "not-found"} handler, which keeps error responses identical on every target; throw FrameworkError instead.`);
      }
      return;
    }
    checkContextMember(context, node.property, name, node.object);
  },
  VariableDeclarator(node) {
    if (node.id.type !== "ObjectPattern" || node.init === null) return;
    for (const prop of node.id.properties) {
      const key = prop.type === "Property" ? propertyKey(prop) : undefined;
      if (key !== undefined) checkContextMember(context, prop, key, node.init);
    }
  },
}));
