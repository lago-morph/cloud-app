/**
 * Missing prerequisites (COMPL-REQ-003 `blocked`). A test that finds a prerequisite missing
 * (for example the Cloudflare account's D1 daily row limit is exhausted) calls
 * `prerequisiteMissing(detail)` instead of failing on it. The driver then records the
 * criterion as `blocked` with `detail`; it never records it as passed. The evaluator judges.
 */
export const PREREQUISITE_MARKER = "PREREQUISITE MISSING: ";

export class PrerequisiteMissingError extends Error {
  constructor(detail: string) {
    super(`${PREREQUISITE_MARKER}${detail}`);
    this.name = "PrerequisiteMissingError";
  }
}

export function prerequisiteMissing(detail: string): never {
  throw new PrerequisiteMissingError(detail);
}
