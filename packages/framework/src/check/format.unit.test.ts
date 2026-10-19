import { describe, expect, it } from "vitest";
import { formatDiagnostic, formatDiagnostics } from "./format.js";

const diag = {
  file: "src/server/fail/ai-node-fs.ts",
  line: 1,
  column: 30,
  rule: "prototype-framework/allowed-imports",
  message: 'Import of "node:fs": the Node built-in module "node:fs" does not exist on every target.',
  reference: "skill/reference/http-and-validation.md",
};

describe("[CHECK-AC-003] diagnostic layout (CHECK-REQ-003)", () => {
  it("one line: file:line:col, the message naming the construct, the rule, and the skill reference", () => {
    expect(formatDiagnostic(diag)).toBe(
      'src/server/fail/ai-node-fs.ts:1:30  error  Import of "node:fs": the Node built-in module "node:fs" does not exist on every target.  prototype-framework/allowed-imports  (read skill/reference/http-and-validation.md)',
    );
  });

  it("messages are kept on one line", () => {
    expect(formatDiagnostic({ ...diag, message: "a\nb" })).not.toMatch(/\n/);
  });

  it("several diagnostics, one per line, with a closing count", () => {
    const text = formatDiagnostics([diag, { ...diag, line: 2 }]);
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toMatch(/2 portability problems/);
    expect(formatDiagnostics([])).toBe("");
  });
});
