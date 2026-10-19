/**
 * `no-suppression-comments` (CHECK-REQ-002, DEC-0043): no comments that suppress type or lint
 * errors: TypeScript's `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck`, and ESLint's
 * `eslint-disable…`/`eslint-enable`, inline `eslint` configuration and `global(s)` comments.
 * `verify` also lints with inline configuration turned off, so ESLint comments have no effect;
 * this rule makes them fail.
 */
import { createRule, report } from "../rule-kit.js";

const TS_DIRECTIVE = /^[\s/*]*@ts-(?:ignore|expect-error|nocheck)\b/;
const LINE_DIRECTIVE = /^\s*eslint-(?:disable|enable)(?:-next-line|-line)?(?:\s|$)/;
const BLOCK_DIRECTIVE = /^\s*(?:eslint-(?:disable|enable)(?:-next-line|-line)?|eslint|eslint-env|globals?|exported)(?:\s|$)/;

export const noSuppressionComments = createRule("No comments that suppress type or lint errors", (context) => ({
  Program() {
    for (const comment of context.sourceCode.getAllComments()) {
      const ts = TS_DIRECTIVE.exec(comment.value);
      if (ts !== null) {
        const directive = ts[0].replace(/^[\s/*]*/, "");
        report(context, comment, `The comment "${directive}" suppresses type errors; app code may not use type escapes (CHECK-REQ-002) — fix the type error instead.`);
        continue;
      }
      const lint = comment.type === "Line" ? LINE_DIRECTIVE.exec(comment.value) : BLOCK_DIRECTIVE.exec(comment.value);
      if (lint !== null) {
        report(context, comment, `The comment "${lint[0].trim()}" would suppress or reconfigure lint rules; app code may not switch framework rules off (CHECK-REQ-002) — fix the code instead.`);
      }
    }
  },
}));
