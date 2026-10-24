/**
 * Evidence writer (COMPL-REQ-003, COMPL-REQ-004): framework-internal, used by the compliance
 * driver (`tests/compliance/harness/`) and `smoke`. No contract file declares app-facing names
 * for this component, and no hub re-exports it.
 */
export { EVIDENCE_SCHEMA, validateEvidence } from "./schema.js";
export { RUN_ID_ALPHABET, RUN_ID_LENGTH, newRunId, testStageName, type RandomSource } from "./run-id.js";
export {
  assertCleanTree,
  DirtyTreeError,
  gitState,
  redact,
  writeEvidence,
  type EvidencePaths,
  type EvidenceRecord,
  type EvidenceResult,
  type EvidenceTarget,
  type GitState,
  type Redaction,
  type ResultStatus,
  type WriteEvidenceInput,
} from "./writer.js";
