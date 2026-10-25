/**
 * Criterion production stages (DEC-0560; COMPL-REQ-004's exception): a few stage-lifecycle
 * criteria need a production stage of their own (PROV-AC-003's production removal, DEC-0543;
 * PROV-AC-004's production deploy, DEC-0553). Such a stage is named with a reserved prefix and 10
 * random lowercase letters and digits (`p003<random>`, `p004<random>`), never `prodcheck` and
 * never `test-…`. The driver cleans these stages like `test-` stages: at the start and at the end
 * of every cloud run it lists the account's stages with a reserved prefix, removes each with
 * `remove --confirm-production <stage>`, and reports what is still there as a leftover.
 * Node-free except for the random source.
 */
import { randomBytes } from "node:crypto";

/** The reserved prefixes, one per criterion that creates a production stage. */
export const CRITERION_PRODUCTION_PREFIXES: readonly string[] = Object.freeze(["p003", "p004"]);

/** Length of the random part (PAR-291 allows 20 characters in all). */
export const CRITERION_STAGE_RANDOM = 10;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PATTERN = new RegExp(`^(?:${CRITERION_PRODUCTION_PREFIXES.join("|")})[a-z0-9]{${String(CRITERION_STAGE_RANDOM)}}$`);

/** Whether `stage` is a criterion production stage name (a reserved prefix and the random part). */
export function isCriterionProductionStage(stage: string): boolean {
  return PATTERN.test(stage);
}

/** A new criterion production stage name for one of the reserved prefixes (uniform over the alphabet). */
export function newCriterionProductionStage(prefix: string, random: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  if (!CRITERION_PRODUCTION_PREFIXES.includes(prefix)) throw new Error(`${prefix} is not a reserved criterion production stage prefix (${CRITERION_PRODUCTION_PREFIXES.join(", ")})`);
  let out = "";
  while (out.length < CRITERION_STAGE_RANDOM) {
    for (const byte of random(CRITERION_STAGE_RANDOM)) {
      if (byte < 252 && out.length < CRITERION_STAGE_RANDOM) out += ALPHABET[byte % ALPHABET.length] ?? "";
    }
  }
  return `${prefix}${out}`;
}

/**
 * The criterion production stages of `app` named by the account's resource names: Workers
 * `<app>-<stage>`, buckets `<app>-<stage>-files`, D1 databases `<app>-<stage>-db-<n>` (fixed
 * names, DEC-0331). Sorted, each once.
 */
export function criterionStagesIn(names: readonly string[], app: string): string[] {
  const found = new Set<string>();
  for (const name of names) {
    if (!name.startsWith(`${app}-`)) continue;
    const rest = name.slice(app.length + 1).replace(/-files$/, "").replace(/-db-\d+$/, "");
    if (isCriterionProductionStage(rest)) found.add(rest);
  }
  return [...found].sort();
}

/** Whether the compliance cleanup may remove `stage`: a test stage or a criterion production stage, never `prodcheck`. */
export function isCleanableStage(stage: string): boolean {
  return stage.startsWith("test-") || isCriterionProductionStage(stage);
}
