/**
 * Per-target expected criteria (COMPL-AC-001): which criteria and scenarios a run on one target
 * and tier must report, derived from the Where columns and lines, with this phase's not-run
 * rules (plan §8; prompt §4, §11) applied, and the clauses a tagged test must show by name.
 * Release 1 runs local and Cloudflare only (DEC-0508): no AWS criterion is ever expected, and the
 * AWS clauses of Local criteria are deferred with the AWS target (branch `aws`).
 */
import type { CatalogueEntry, Target } from "./catalogue.js";

export type RunMode = "automated" | "milestone";

/**
 * The not-run reason for criteria that need the password login provider on a cloud stage until
 * implementation items I-B…I-G land and the test authors tag tests (DEC-0509, DEC-0520). It
 * replaces the Google-mocked reason: Google is retired (DEC-0513).
 */
export const PASSWORD_PENDING = "password login provider not implemented yet (DEC-0509)";

/** A scenario whose steps went with the password provider, mail and `admins` (plan-v0.2.0 §6), until T2 rewrites it (§7.1). */
export const E2E_REWRITE_PENDING = "steps removed with the password provider, mail and admins; rewrite for sign-in with Cloudflare pending (plan-v0.2.0 §7.1, T2)";

/** AUTH-AC-005's successful-callback response needs a redirect login provider, which no cloud stage has (DEC-0513). */
export const NO_REDIRECT_PROVIDER = "no redirect login provider on a cloud stage (DEC-0513)";

/**
 * Clauses that need a second Cloudflare account, deferred by the owner (2026-10-25: "Defer the
 * tests that require another account"; DEC-0532).
 */
export const SECOND_ACCOUNT_DEFERRED = "deferred: needs a second Cloudflare account (owner, 2026-10-25)";

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
 * A clause of a criterion that its own tagged test must show by name (DEC-0499): the
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

/** Release 1's cloud targets (DEC-0508: AWS is deferred to a later release). */
const CLOUD: readonly Target[] = ["cloudflare"];

/**
 * This phase's not-run rules (plan §8.1, §8.2; plan-auth.md, DEC-0520, DEC-0526). AUTH-AC-011
 * and E2E-008, the results `check-login` records (DEC-0700), have none: the driver runs
 * `check-login` on `prodcheck` (prodcheck.ts). The password-pending rules of the criteria that items T2 and T3 tagged cloud
 * tests for are gone (plan-auth.md): AUTH-AC-005's admin-role part, AUTH-AC-009's production
 * part, AUTH-AC-014, COMPL-AC-005, PWD-AC-008, MAIL-AC-006, MAIL-AC-007, E2E-006, E2E-007 and
 * CLI-AC-007. PROV-AC-004's fresh-account clause is deferred (plan §8.4, DEC-0532). §8.3's
 * outstanding milestone items follow from the rest. Local criteria get no
 * rule: a new local criterion without a test is reported untested.
 */
export const PHASE_RULES: readonly NotRunRule[] = [
  // fix-auth005, revised by DEC-0513: the successful-callback response needs a redirect provider; cloud stages have none.
  { id: "AUTH-AC-005", targets: CLOUD, mode: "automated", part: "contract part: successful callback (needs a redirect login provider)", detail: NO_REDIRECT_PROVIDER },
  { id: "SKILL-AC-006", targets: CLOUD, mode: "milestone", detail: PASSWORD_PENDING },
  { id: "CLI-AC-001", targets: CLOUD, mode: "automated", detail: PASSWORD_PENDING },
  // Plan-v0.2.0 §6, §7.1: E2E-007's steps were password sign-up, mail and `admins`, removed with them; T2 rewrites it for sign-in with Cloudflare.
  { id: "E2E-007", targets: CLOUD, mode: "automated", detail: E2E_REWRITE_PENDING },
  // DEC-0532: "Deploying without it fails with a clear message" needs an account on which setup-account never ran.
  { id: "PROV-AC-004", targets: CLOUD, mode: "milestone", part: "fresh-account clause: deploying without setup-account fails with a clear message", detail: SECOND_ACCOUNT_DEFERRED },
];

/**
 * Clauses that must be shown by their own tagged test. None in release 1: the only ones were the
 * AWS clauses of Local criteria (CORE-AC-006's AWS bundle, SQL-AC-006's Data API retry loop),
 * which are deferred with the AWS target and their tests (DEC-0508, branch `aws`). The rule kind
 * stays for the AWS release.
 */
export const CLAUSE_RULES: readonly ClauseRule[] = [];

/**
 * Unit-level criteria (plan §10.3; DEC-0319, decision log Item: fix-c3): the
 * criteria whose own text is stated over a unit test, hand-built inputs, stubbed cloud responses
 * or injected failures. On local the driver also runs the unit layer for these IDs, and folds a
 * unit test's outcome only into the unit-level IDs its title carries. Every other ID is
 * evidenced by the integration and E2E layers only.
 */
export const UNIT_LEVEL: readonly string[] = ["CLI-AC-003", "COMPL-AC-002", "COMPL-AC-006", "COMPL-AC-007", "PROV-AC-007"];

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
