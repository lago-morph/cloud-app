/**
 * Run IDs and test-stage names (COMPL-REQ-004, compliance.md "Test stages", PROV-REQ-005).
 * A run ID comes from a cryptographically secure random source and fills the rest of the
 * PAR-291 stage-name length after `test-` with lowercase letters and digits.
 */
import { checkStageName, STAGE_NAME_MAX_LENGTH } from "../core/identity.js";

export const RUN_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PREFIX = "test-";
export const RUN_ID_LENGTH = STAGE_NAME_MAX_LENGTH - PREFIX.length;

/** Fills a buffer with random bytes; defaults to the Web Crypto CSPRNG. */
export type RandomSource = (buffer: Uint8Array<ArrayBuffer>) => Uint8Array;

const cryptoSource: RandomSource = (buffer) => crypto.getRandomValues(buffer);
// Largest multiple of the alphabet size that fits a byte: bytes at or above it are discarded,
// so every character is equally likely.
const LIMIT = 256 - (256 % RUN_ID_ALPHABET.length);
const RUN_ID = new RegExp(`^[a-z0-9]{${String(RUN_ID_LENGTH)}}$`);

export function newRunId(random: RandomSource = cryptoSource): string {
  let id = "";
  const buffer = new Uint8Array(RUN_ID_LENGTH * 2);
  while (id.length < RUN_ID_LENGTH) {
    for (const byte of random(buffer)) {
      if (byte >= LIMIT) continue;
      id += RUN_ID_ALPHABET[byte % RUN_ID_ALPHABET.length];
      if (id.length === RUN_ID_LENGTH) break;
    }
  }
  return id;
}

/** `test-<runId>`; refuses an ID that is not of the run-ID form. */
export function testStageName(runId: string): string {
  if (!RUN_ID.test(runId)) throw new Error(`run ID ${JSON.stringify(runId)} is not ${String(RUN_ID_LENGTH)} lowercase letters and digits`);
  const stage = `${PREFIX}${runId}`;
  checkStageName(stage);
  return stage;
}
