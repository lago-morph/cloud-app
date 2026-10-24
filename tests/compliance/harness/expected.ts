/**
 * Per-target expected criteria (COMPL-AC-001): which criteria and scenarios a run on one target
 * and tier must report, derived from the Where columns and lines, with this phase's not-run
 * rules (plan §8; prompt §4, §11) applied, and the clauses a tagged test must show by name.
 */
import type { CatalogueEntry, Target } from "./catalogue.js";

export type RunMode = "automated" | "milestone";

export const GOOGLE_MOCKED = "Google login mocked for this phase";
/**
 * Every AWS criterion while there is no AWS account (plan-aws.md G-T4, §2): the offline phase G
 * builds and pre-checks everything, and only the live phase L records AWS evidence.
 */
export const AWS_LIVE_PENDING = "AWS live run pending (no account)";

export interface NotRunRule {
  /** A criterion or scenario ID, or "*" for every one on the rule's targets. */
  readonly id: string;
  readonly targets: readonly Target[];
  readonly mode: RunMode | "any";
  /** A part of the criterion; absent for the whole criterion. */
  readonly part?: string;
  readonly detail: string;
}

export interface ExpectedEntry {
  readonly id: string;
  /** Whether the run executes this criterion's tests. */
  readonly run: boolean;
  /** Set when the whole criterion is not run on this target and tier: the reason. */
  readonly notRun?: string;
  /** The parts this tier covers: "" for the whole criterion (milestone runs may name a part). */
  readonly parts: readonly string[];
  /** Parts not run, each recorded as its own `not-run` result. */
  readonly notRunParts: readonly { readonly part: string; readonly detail: string }[];
  /**
   * Clauses this run must show by an executed tagged test whose title matches `titlePattern`
   * (a RegExp source, case-insensitive); a clause no such test shows is recorded `not-run`.
   * Absent when the criterion has none.
   */
  readonly clauses?: readonly { readonly part: string; readonly titlePattern: string }[];
}

/**
 * A clause of a criterion that its own tagged test must show by name (plan-aws.md G-T4): the
 * criterion's other tests passing does not cover it. Replaces DEC-0397's static not-run parts:
 * the clause is now expected to run, and a run in which no test for it ran records that part
 * `not-run` instead of letting the criterion's other tests stand for it.
 */
export interface ClauseRule {
  readonly id: string;
  readonly targets: readonly Target[];
  readonly mode: RunMode;
  readonly part: string;
  /** Matches the title of a test that shows the clause (RegExp source, case-insensitive). */
  readonly titlePattern: string;
}

const CLOUD: readonly Target[] = ["cloudflare", "aws"];

/** This phase's not-run rules (plan §8.1, §8.2). §8.3's outstanding milestone items follow from them. */
export const PHASE_RULES: readonly NotRunRule[] = [
  { id: "*", targets: ["aws"], mode: "any", detail: AWS_LIVE_PENDING },
  { id: "GOOGLE-AC-001", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  { id: "GOOGLE-AC-005", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  { id: "AUTH-AC-005", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  // Added for the evaluator to confirm (plan §8.1; fix-auth005): a test stage has no real login provider (DEC-0171),
  // so the successful-callback response first exists on prodcheck with Google, like AUTH-AC-009's cloud production part.
  { id: "AUTH-AC-005", targets: CLOUD, mode: "automated", part: "contract part: successful callback (needs a real login provider)", detail: GOOGLE_MOCKED },
  { id: "AUTH-AC-009", targets: CLOUD, mode: "automated", part: "cloud production part", detail: GOOGLE_MOCKED },
  { id: "AUTH-AC-011", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  { id: "COMPL-AC-005", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  { id: "SKILL-AC-006", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  { id: "E2E-006", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  { id: "E2E-007", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  { id: "E2E-008", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  { id: "CLI-AC-001", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  // DEC-0397's AWS parts of Local criteria (CORE-AC-006 AWS bundle, SQL-AC-006 Data API retry loop) are no longer
  // not-run rules: plan-aws.md G-T4 adds their tests, and CLAUSE_RULES below requires each to run.
];

/**
 * The AWS clauses of Local criteria (plan-aws.md §1, G-T4). Each runs on local, by its own tagged
 * test: SQL-AC-006's in `tests/compliance/criteria/sql/data-api-retry.test.ts`, CORE-AC-006's in
 * the framework's AWS bundle inspection (G-06; its title names the AWS bundle).
 */
export const CLAUSE_RULES: readonly ClauseRule[] = [
  { id: "CORE-AC-006", targets: ["local"], mode: "automated", part: "AWS-bundle clause", titlePattern: String.raw`\bAWS[- ]bundle\b` },
  { id: "SQL-AC-006", targets: ["local"], mode: "automated", part: "Data API retry-loop clause", titlePattern: String.raw`\bData API retry[- ]loop clause\b` },
];

/**
 * Unit-level criteria (plan §10.3; DEC-0319, decision log Item: fix-c3): the
 * criteria whose own text is stated over a unit test, hand-built inputs, stubbed cloud responses
 * or injected failures. On local the driver also runs the unit layer for these IDs, and folds a
 * unit test's outcome only into the unit-level IDs its title carries. Every other ID is
 * evidenced by the integration and E2E layers only.
 */
export const UNIT_LEVEL: readonly string[] = ["CLI-AC-003", "COMPL-AC-002", "COMPL-AC-006", "COMPL-AC-007", "GOOGLE-AC-002", "PROV-AC-007"];

function ruleMatches(rule: NotRunRule, id: string, target: Target, mode: RunMode): boolean {
  return (rule.id === "*" || rule.id === id) && rule.targets.includes(target) && (rule.mode === "any" || rule.mode === mode);
}

export function expectedCriteria(
  catalogue: readonly CatalogueEntry[],
  target: Target,
  mode: RunMode,
  rules: readonly NotRunRule[] = PHASE_RULES,
  clauseRules: readonly ClauseRule[] = CLAUSE_RULES,
): ExpectedEntry[] {
  const out: ExpectedEntry[] = [];
  for (const entry of catalogue) {
    const applies = entry.applies[target];
    if (applies === undefined) continue;
    const parts = mode === "automated" ? (applies.automated ? [""] : []) : [...applies.milestone];
    if (parts.length === 0) continue;
    const matching = rules.filter((rule) => ruleMatches(rule, entry.id, target, mode));
    const whole = matching.find((rule) => rule.part === undefined);
    if (whole !== undefined) {
      out.push({ id: entry.id, run: false, notRun: whole.detail, parts, notRunParts: [] });
      continue;
    }
    const notRunParts = matching.flatMap((rule) => (rule.part === undefined ? [] : [{ part: rule.part, detail: rule.detail }]));
    const notRunNames = new Set(notRunParts.map((p) => p.part));
    const clauses = clauseRules
      .filter((c) => c.id === entry.id && c.targets.includes(target) && c.mode === mode && !notRunNames.has(c.part))
      .map((c) => ({ part: c.part, titlePattern: c.titlePattern }));
    out.push(clauses.length === 0 ? { id: entry.id, run: true, parts, notRunParts } : { id: entry.id, run: true, parts, notRunParts, clauses });
  }
  return out;
}

/** Problems with `rules` (not-run or clause rules) against the catalogue: a rule for an unknown ID, or for a target/tier where its criterion does not apply. */
export function checkRules(catalogue: readonly CatalogueEntry[], rules: readonly (NotRunRule | ClauseRule)[]): string[] {
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  const problems: string[] = [];
  for (const rule of rules) {
    if (rule.id === "*") continue;
    const entry = byId.get(rule.id);
    if (entry === undefined) {
      problems.push(`not-run rule ${rule.id}: no such criterion or scenario`);
      continue;
    }
    for (const target of rule.targets) {
      const applies = entry.applies[target];
      const tierApplies = applies !== undefined && (rule.mode === "any" || (rule.mode === "automated" ? applies.automated : applies.milestone.length > 0));
      if (!tierApplies) problems.push(`not-run rule ${rule.id} (${target}, ${rule.mode}): the criterion does not apply there in that tier`);
    }
  }
  return problems;
}
