/**
 * CHECK portability rules and type-escape bans, exercised through `npx <package> verify` on
 * fixture apps (CHECK-REQ-001…003, SQL-REQ-002). Fixtures: `test/fixtures/check/`.
 * Expectations per fixture: `test/fixtures/support/check-catalog.ts`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import {
  FixtureApp,
  REPO_ROOT,
  diagnosticsFor,
  isTypeScriptError,
  namesRule,
  skillReferences,
  type RunResult,
} from "../../fixtures/support/app.js";
import {
  ALL_RULES,
  OTHER_CHECK_FIXTURES,
  OTHER_RULE_REPRESENTATIVES,
  RULES,
  RULE_FIXTURES,
  TYPE_ESCAPE_FIXTURES,
  baseName,
  type AnyRuleName,
  type FailingFixture,
} from "../../fixtures/support/check-catalog.js";

const SETUP_TIMEOUT = 900_000;

function show(result: RunResult): string {
  return `verify exit ${String(result.code)}; output:\n${result.output.slice(-20_000)}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * CHECK-REQ-003: one diagnostic (a line naming the rule, plus continuation lines up to the
 * next diagnostic) names the construct, the rule, and a skill reference that exists in
 * `skill/`.
 */
function actionableDiagnostic(
  lines: readonly string[],
  fixture: Pick<FailingFixture, "file" | "construct">,
  rule: AnyRuleName,
): boolean {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!namesRule(line, rule)) continue;
    const segment = [line];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? "";
      if (ALL_RULES.some((r) => namesRule(next, r)) || isTypeScriptError(next)) break;
      segment.push(next);
    }
    const text = segment.join("\n");
    const refs = skillReferences(text);
    const refExists = refs.some((ref) => existsSync(join(REPO_ROOT, "skill", ref)));
    const rest = text
      .replace(new RegExp(`\\S*${escapeRe(baseName(fixture.file))}\\S*`, "g"), " ")
      .replace(new RegExp(`[\\w@./-]*${escapeRe(rule)}`, "g"), " ")
      .replace(/(?:skill\/)?reference\/[A-Za-z0-9._/-]+?\.md/g, " ");
    const namesConstruct = (fixture.construct ?? []).some((re) => re.test(rest));
    if (refExists && namesConstruct) return true;
  }
  return false;
}

describe("failing fixtures (apps/base + check/fail)", () => {
  let app: FixtureApp | undefined;
  let result: RunResult;

  beforeAll(async () => {
    app = await FixtureApp.create({ layers: ["apps/base", "check/fail"] });
    result = await app.cli(["verify"]);
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    await app?.dispose();
  });

  for (const fixture of RULE_FIXTURES) {
    const rule = fixture.rule;
    if (rule === null) continue;
    const ids = fixture.sqlFeature ? ["CHECK-AC-001", "SQL-AC-002"] : ["CHECK-AC-001"];
    it(tag(ids, `${rule} rejects ${fixture.what} (${baseName(fixture.file)})`), () => {
      expect(result.code, show(result)).not.toBe(0);
      const lines = diagnosticsFor(result.output, baseName(fixture.file));
      expect(
        lines.some((l) => namesRule(l, rule)),
        `no ${rule} diagnostic names ${fixture.file}\n${show(result)}`,
      ).toBe(true);
      if (fixture.typeError) {
        expect(lines.some(isTypeScriptError), `no type error reported for ${fixture.file}\n${show(result)}`).toBe(true);
      }
    });
  }

  for (const fixture of OTHER_CHECK_FIXTURES) {
    it(tag("CHECK-AC-001", `verify rejects ${fixture.what} (${baseName(fixture.file)})`), () => {
      expect(result.code, show(result)).not.toBe(0);
      const lines = diagnosticsFor(result.output, baseName(fixture.file));
      expect(lines.length, `no diagnostic names ${fixture.file}\n${show(result)}`).toBeGreaterThan(0);
      if (fixture.typeError) {
        expect(
          lines.some((l) => isTypeScriptError(l) && (fixture.construct ?? []).some((re) => re.test(l))),
          `no type error naming the construct for ${fixture.file}\n${show(result)}`,
        ).toBe(true);
      }
    });
  }

  for (const fixture of TYPE_ESCAPE_FIXTURES) {
    it(tag("CHECK-AC-002", `verify rejects ${fixture.what} (${baseName(fixture.file)})`), () => {
      expect(result.code, show(result)).not.toBe(0);
      const lines = diagnosticsFor(result.output, baseName(fixture.file));
      expect(lines.length, `no diagnostic names ${fixture.file}\n${show(result)}`).toBeGreaterThan(0);
    });
  }

  it(tag("CHECK-AC-001", "a passing helper module next to the failing fixtures gets no diagnostic (control)"), () => {
    expect(diagnosticsFor(result.output, "tables.ts"), show(result)).toEqual([]);
    expect(diagnosticsFor(result.output, "schemas.ts"), show(result)).toEqual([]);
  });

  for (const rule of RULES) {
    const fixture = RULE_FIXTURES.find((f) => f.rule === rule && f.representative === true);
    it(tag("CHECK-AC-003", `the ${rule} diagnostic names the construct, the rule and an existing skill reference`), () => {
      expect(fixture, `catalogue has no representative fixture for ${rule}`).toBeDefined();
      if (fixture === undefined) return;
      const lines = diagnosticsFor(result.output, baseName(fixture.file));
      expect(
        actionableDiagnostic(lines, fixture, rule),
        `no ${rule} diagnostic for ${fixture.file} names ${String(fixture.construct)} and an existing skill/reference/*.md\n${lines.join("\n")}\n${show(result)}`,
      ).toBe(true);
    });
  }

  // The remaining rules of check.md §2: no-raw-html, no-suppression-comments and the
  // typescript-eslint type-escape bans (B-T5, evaluation flag F2).
  for (const fixture of OTHER_RULE_REPRESENTATIVES) {
    const rule = fixture.rule;
    it(tag("CHECK-AC-003", `the ${rule} diagnostic names the construct, the rule and an existing skill reference`), () => {
      expect(result.code, show(result)).not.toBe(0);
      const lines = diagnosticsFor(result.output, baseName(fixture.file));
      expect(
        lines.some((l) => namesRule(l, rule)),
        `no ${rule} diagnostic names ${fixture.file}\n${lines.join("\n")}\n${show(result)}`,
      ).toBe(true);
      expect(
        actionableDiagnostic(lines, fixture, rule),
        `no ${rule} diagnostic for ${fixture.file} names ${String(fixture.construct)} and an existing skill/reference/*.md\n${lines.join("\n")}\n${show(result)}`,
      ).toBe(true);
    });
  }

  it("CHECK-AC-003 coverage: every rule has exactly one representative fixture (control)", () => {
    const covered = [
      ...RULES.filter((r) => RULE_FIXTURES.some((f) => f.rule === r && f.representative === true)),
      ...OTHER_RULE_REPRESENTATIVES.map((f) => f.rule),
    ].sort();
    expect(covered).toEqual([...ALL_RULES].sort());
  });
});

describe("passing fixtures (apps/base + check/pass)", () => {
  let app: FixtureApp | undefined;
  let result: RunResult;
  const passFiles = [
    "sql-example.ts",
    "queries.ts",
    "order.ts",
    "schema-extra.ts",
    "errors.ts",
    "consts.ts",
    "page.ts",
    "schemas.ts",
    "app.ts",
    "pass.test.ts",
  ];

  beforeAll(async () => {
    app = await FixtureApp.create({ layers: ["apps/base", "check/pass"] });
    result = await app.cli(["verify"]);
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    await app?.dispose();
  });

  it(tag("CHECK-AC-001", "every rule passes its realistic passing fixtures, incl. type-only shared imports and zod in browser code"), () => {
    expect(result.code, show(result)).toBe(0);
    for (const file of passFiles) expect(diagnosticsFor(result.output, file), `${file}\n${show(result)}`).toEqual([]);
  });

  it(tag("CHECK-AC-002", "`as const` and `satisfies` pass"), () => {
    expect(result.code, show(result)).toBe(0);
    expect(diagnosticsFor(result.output, "consts.ts"), show(result)).toEqual([]);
  });

  it(tag("SQL-AC-002", "the portability rules accept every supported query feature, incl. the sql.md §2.3 example"), () => {
    expect(result.code, show(result)).toBe(0);
    for (const file of ["sql-example.ts", "queries.ts", "order.ts", "schema-extra.ts"]) {
      expect(diagnosticsFor(result.output, file), `${file}\n${show(result)}`).toEqual([]);
    }
  });
});
