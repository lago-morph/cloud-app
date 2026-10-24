/**
 * Folds test outcomes into one or more evidence results per expected criterion
 * (COMPL-REQ-003). The driver records; it does not judge: a criterion with a passing test is
 * `passed` only in the record, and the evaluator decides whether the evidence shows it.
 * - failed beats blocked beats passed;
 * - a criterion with no executed tagged test is `not-run`, never `passed`;
 * - a clause the expected entry names (`clauses`) with no executed test of its own adds a
 *   `not-run` entry;
 * - skipped tests and parts that are not run each add a `not-run` entry; a skipped test that gave
 *   a note (`skip(note)`, the reason it did not run) has its own entry with the note as detail.
 */
import type { EvidenceResult } from "../../../packages/framework/src/evidence/public.js";
import { parseTags } from "../../support/tags.js";
import { PREREQUISITE_MARKER } from "./blocked.js";
import type { Target } from "./catalogue.js";
import type { ExpectedEntry } from "./expected.js";

export interface TestOutcome {
  /** Full title, including enclosing describe titles. */
  readonly title: string;
  readonly file: string;
  readonly status: "passed" | "failed" | "skipped";
  /** First failure message, for failed tests. */
  readonly message?: string;
  /** Skipped tests: the note the test gave for skipping (its not-run reason), when any. */
  readonly note?: string;
  /** The IDs this outcome may evidence, when narrower than its title's tags (unit layer: unit-level IDs only). */
  readonly ids?: readonly string[];
}

export interface CriterionResultsInput {
  readonly target: Target;
  readonly expected: readonly ExpectedEntry[];
  readonly outcomes: readonly TestOutcome[];
  /** Criteria whose prerequisite the operator reports missing (`--blocked`), with the reason. */
  readonly blocked?: ReadonlyMap<string, string>;
}

const MAX_MESSAGE = 300;
const MAX_DETAIL = 1000;

function firstLine(text: string | undefined): string {
  const line = (text ?? "").split("\n").find((l) => l.trim() !== "") ?? "(no message)";
  const trimmed = line.trim();
  return trimmed.length > MAX_MESSAGE ? `${trimmed.slice(0, MAX_MESSAGE)}…` : trimmed;
}

function cap(detail: string): string {
  return detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}…` : detail;
}

/** A skip note as a not-run detail: the status already says not-run, so a leading `not-run:` is dropped. */
function skipNoteDetail(note: string): string {
  const text = note.trim().replace(/^not-run:\s*/i, "");
  return text === "" ? note.trim() : text;
}

function isBlocked(outcome: TestOutcome): boolean {
  return outcome.status === "failed" && (outcome.message ?? "").includes(PREREQUISITE_MARKER);
}

export function criterionResults(input: CriterionResultsInput): EvidenceResult[] {
  const results: EvidenceResult[] = [];
  const tagged = input.outcomes.map((outcome) => ({ outcome, ids: new Set(outcome.ids ?? parseTags(outcome.title)) }));
  for (const entry of input.expected) {
    if (!entry.run) {
      results.push({ id: entry.id, status: "not-run", detail: entry.notRun ?? "not run" });
      continue;
    }
    const operatorBlocked = input.blocked?.get(entry.id);
    if (operatorBlocked !== undefined) {
      results.push({ id: entry.id, status: "blocked", detail: operatorBlocked });
      continue;
    }
    const mine = tagged.filter((t) => t.ids.has(entry.id)).map((t) => t.outcome);
    const executed = mine.filter((o) => o.status !== "skipped");
    const skipped = mine.filter((o) => o.status === "skipped");
    const failed = executed.filter((o) => o.status === "failed" && !isBlocked(o));
    const blocked = executed.filter(isBlocked);
    const partNote = entry.parts.filter((p) => p !== "").map((p) => `milestone part: ${p}`).join("; ");

    if (failed.length > 0) {
      const lines = failed.map((o) => `${o.title}: ${firstLine(o.message)}`).join("; ");
      results.push({ id: entry.id, status: "failed", detail: cap(`${String(failed.length)} of ${String(executed.length)} tests failed: ${lines}`) });
    } else if (blocked.length > 0) {
      const reason = (o: TestOutcome): string => {
        const line = firstLine(o.message);
        return line.slice(line.indexOf(PREREQUISITE_MARKER) + PREREQUISITE_MARKER.length);
      };
      const lines = blocked.map((o) => `${o.title}: ${reason(o)}`).join("; ");
      results.push({ id: entry.id, status: "blocked", detail: cap(lines) });
    } else if (executed.length > 0) {
      results.push(partNote === "" ? { id: entry.id, status: "passed" } : { id: entry.id, status: "passed", detail: partNote });
    } else if (skipped.length === 0) {
      results.push({ id: entry.id, status: "not-run", detail: `no test tagged [${entry.id}] ran on ${input.target}` });
    }
    for (const o of skipped) if (o.note !== undefined) results.push({ id: entry.id, status: "not-run", detail: cap(skipNoteDetail(o.note)) });
    const unnoted = skipped.filter((o) => o.note === undefined);
    if (unnoted.length > 0) {
      const noun = unnoted.length === 1 ? "tagged test" : "tagged tests";
      results.push({ id: entry.id, status: "not-run", detail: cap(`${String(unnoted.length)} ${noun} skipped: ${unnoted.map((o) => o.title).join("; ")}`) });
    }
    for (const part of entry.notRunParts) results.push({ id: entry.id, status: "not-run", detail: `${part.part}: ${part.detail}` });
    // A clause shown by no executed test of its own (DEC-0499): the other tests do not stand for it.
    for (const clause of entry.clauses ?? []) {
      const pattern = new RegExp(clause.titlePattern, "i");
      if (!executed.some((o) => pattern.test(o.title))) results.push({ id: entry.id, status: "not-run", detail: `${clause.part}: no test tagged [${entry.id}] for this clause ran on ${input.target}` });
    }
  }
  return results;
}
