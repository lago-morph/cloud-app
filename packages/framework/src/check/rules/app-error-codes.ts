/**
 * `app-error-codes` (CHECK-REQ-001, CORE-REQ-007): app code constructs `FrameworkError` only with
 * the four codes of CORE-REQ-007's table. The code's type decides, so constants, aliases and
 * re-exported classes are covered; a code whose type is wider than those four (e.g. `ErrorCode`)
 * is rejected.
 */
import ts from "typescript";
import { createRule, report, typeInfo } from "../rule-kit.js";
import { resolveCallee } from "../resolve.js";

/** CORE-REQ-007: the codes app code may throw. */
export const APP_ERROR_CODES: readonly string[] = ["HTTP.NOT_FOUND", "AUTH.FORBIDDEN", "HTTP.INVALID_INPUT", "HTTP.CONFLICT"];

const HINT = `app code throws only ${APP_ERROR_CODES.join(", ")} (CORE-REQ-007); capability codes are the framework's`;

export const appErrorCodes = createRule("FrameworkError only with the CORE-REQ-007 codes", (context) => ({
  NewExpression(node) {
    const info = typeInfo(context);
    const target = resolveCallee(info, node.callee);
    if (target?.origin !== "framework" || target.name !== "FrameworkError") return;
    const arg = node.arguments[0];
    if (arg === undefined) return;
    const type = info.checker.getTypeAtLocation(info.tsNode(arg));
    const parts = type.isUnion() ? type.types : [type];
    const literals = parts.flatMap((t) => (t.isStringLiteral() ? [t.value] : []));
    const disallowed = literals.filter((code) => !APP_ERROR_CODES.includes(code));
    if (literals.length < parts.length) {
      report(context, arg, `FrameworkError code ${context.sourceCode.getText(arg)} is not a fixed code (type ${info.checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation).slice(0, 80)}); ${HINT}.`);
    } else if (disallowed.length > 0) {
      const shown = disallowed.length > 3 ? `${disallowed.slice(0, 3).join(", ")}, … (${String(disallowed.length)} codes from ${context.sourceCode.getText(arg)})` : disallowed.join(", ");
      report(context, arg, `FrameworkError code ${shown}: ${HINT}.`);
    }
  },
}));
