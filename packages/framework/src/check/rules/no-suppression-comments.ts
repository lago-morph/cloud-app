/**
 * `no-suppression-comments` (CHECK-REQ-002, DEC-0043): no comments that suppress or reconfigure
 * lint rules (`eslint-disable…`, `eslint-enable`, inline `eslint` configuration, `global(s)`).
 * `verify` also lints with inline configuration turned off, so such comments have no effect;
 * this rule makes them fail. TypeScript's `@ts-…` comments are `@typescript-eslint/ban-ts-comment`'s.
 */
import { createRule, report } from "../rule-kit.js";

const LINE_DIRECTIVE = /^\s*eslint-(?:disable|enable)(?:-next-line|-line)?(?:\s|$)/;
const BLOCK_DIRECTIVE = /^\s*(?:eslint-(?:disable|enable)(?:-next-line|-line)?|eslint|eslint-env|globals?|exported)(?:\s|$)/;

export const noSuppressionComments = createRule("No lint-suppression or inline lint configuration comments", (context) => ({
  Program() {
    for (const comment of context.sourceCode.getAllComments()) {
      const directive = comment.type === "Line" ? LINE_DIRECTIVE.exec(comment.value) : BLOCK_DIRECTIVE.exec(comment.value);
      if (directive === null) continue;
      report(context, comment, `The comment "${directive[0].trim()}" would suppress or reconfigure lint rules; app code may not switch framework rules off (CHECK-REQ-002) — fix the code instead.`);
    }
  },
}));
