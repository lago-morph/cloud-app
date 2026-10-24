/** Reads the evidence records `validation/<target>/<runId>.json` (COMPL-REQ-003). */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateEvidence, type EvidenceRecord } from "../../../packages/framework/src/evidence/public.js";
import { TARGETS } from "../harness/catalogue.js";

export function readRecords(root: string): { records: EvidenceRecord[]; skipped: string[] } {
  const records: EvidenceRecord[] = [];
  const skipped: string[] = [];
  for (const target of TARGETS) {
    const dir = join(root, "validation", target);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const rel = `validation/${target}/${entry.name}`;
      let value: unknown;
      try {
        value = JSON.parse(readFileSync(join(dir, entry.name), "utf8"));
      } catch (error) {
        skipped.push(`${rel}: not JSON (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      const errors = validateEvidence(value);
      if (errors.length > 0) skipped.push(`${rel}: ${errors.join("; ")}`);
      else records.push(value as EvidenceRecord);
    }
  }
  return { records, skipped };
}
