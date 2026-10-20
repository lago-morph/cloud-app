/**
 * Per-target expected criteria (COMPL-AC-001): which criteria and scenarios a run on one target
 * and tier must report, derived from the Where columns and lines, with this phase's not-run
 * rules (plan §8; prompt §4, §11) applied.
 */
import type { CatalogueEntry, Target } from "./catalogue.js";

export type RunMode = "automated" | "milestone";

export const GOOGLE_MOCKED = "Google login mocked for this phase";
export const AWS_NOT_STARTED = "AWS phase not started";

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
}

const CLOUD: readonly Target[] = ["cloudflare", "aws"];

/** This phase's not-run rules (plan §8.1, §8.2). §8.3's outstanding milestone items follow from them. */
export const PHASE_RULES: readonly NotRunRule[] = [
  { id: "*", targets: ["aws"], mode: "any", detail: AWS_NOT_STARTED },
  { id: "GOOGLE-AC-001", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  { id: "GOOGLE-AC-005", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  { id: "AUTH-AC-005", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  { id: "AUTH-AC-009", targets: CLOUD, mode: "automated", part: "cloud production part", detail: GOOGLE_MOCKED },
  { id: "AUTH-AC-011", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  { id: "COMPL-AC-005", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  { id: "SKILL-AC-006", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  { id: "E2E-006", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  { id: "E2E-007", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  { id: "E2E-008", targets: CLOUD, mode: "milestone", detail: GOOGLE_MOCKED },
  { id: "CLI-AC-001", targets: CLOUD, mode: "automated", detail: GOOGLE_MOCKED },
  // The demo is built in phase F (plan C-EV); the template part runs now. Phase F removes this rule when it adds the
  // demo's [CHECK-AC-005] test. ai/implementation/root-causes/2026-10-20-E2E-004-coverage-and-not-run.md, Cause C (revised).
  { id: "CHECK-AC-005", targets: ["local"], mode: "automated", part: "demo part", detail: "demo built in phase F (plan C-EV)" },
];

/**
 * Unit-level criteria (plan §10.3; decision draft ai/implementation/decisions/fix-c3.md): the
 * criteria whose own text is stated over a unit test, hand-built inputs, stubbed cloud responses
 * or injected failures. On local the driver also runs the unit layer for these IDs, and folds a
 * unit test's outcome only into the unit-level IDs its title carries. Every other ID is
 * evidenced by the integration and E2E layers only.
 */
export const UNIT_LEVEL: readonly string[] = ["CLI-AC-003", "COMPL-AC-002", "COMPL-AC-006", "COMPL-AC-007", "GOOGLE-AC-002", "PROV-AC-007"];

function ruleMatches(rule: NotRunRule, id: string, target: Target, mode: RunMode): boolean {
  return (rule.id === "*" || rule.id === id) && rule.targets.includes(target) && (rule.mode === "any" || rule.mode === mode);
}

export function expectedCriteria(catalogue: readonly CatalogueEntry[], target: Target, mode: RunMode, rules: readonly NotRunRule[] = PHASE_RULES): ExpectedEntry[] {
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
    out.push({ id: entry.id, run: true, parts, notRunParts });
  }
  return out;
}

/** Problems with `rules` against the catalogue: a rule for an unknown ID, or for a target/tier where its criterion does not apply. */
export function checkRules(catalogue: readonly CatalogueEntry[], rules: readonly NotRunRule[]): string[] {
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
