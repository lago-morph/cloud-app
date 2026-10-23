/**
 * The `remove` sequence (PROV-REQ-003; provisioning.md §2 "Removal"), target-neutral:
 * delete the stage's CLI-owned databases, matched by the exact pattern, then let the target
 * remove everything else of the stage, then list what is left. Every step is attempted even
 * when an earlier one failed; each leftover is printed by name and the exit status is 1.
 * Shared account resources and other stages are never touched (the target's `removeStage`
 * works by the stage's exact identifiers).
 */
import { matchStageDatabases } from "./databases.js";
import type { Stage, TargetOperations } from "./operations.js";
import { EXIT, errorLine, line, messageOf, type ProvisionIo, type ProvisionStatus } from "./output.js";

export interface RemoveResult {
  readonly status: ProvisionStatus;
  /** Leftover resources by name (`database <name>`, `<kind> <id>`). */
  readonly leftovers: readonly string[];
}

export async function runRemove(ops: TargetOperations, stage: Stage, io: ProvisionIo): Promise<RemoveResult> {
  const failures: string[] = [];
  const record = (what: string, error: unknown) => {
    failures.push(`${what}: ${messageOf(error)}`);
    errorLine(io, `remove: ${what} failed: ${messageOf(error)}`);
  };

  try {
    const databases = matchStageDatabases(stage, (await ops.listStageResources(stage)).databases);
    for (const db of databases) {
      try {
        await ops.dropDatabase(stage, db);
        line(io, `deleted database ${db.name}`);
      } catch (error) {
        record(`deleting database ${db.name}`, error);
      }
    }
  } catch (error) {
    record("listing the stage's databases", error);
  }

  try {
    await ops.removeStage(stage);
  } catch (error) {
    record(`removing the stage's resources on ${ops.target}`, error);
  }

  let leftovers: string[];
  try {
    const after = await ops.listStageResources(stage);
    leftovers = [
      ...matchStageDatabases(stage, after.databases).map((d) => `database ${d.name}`),
      ...after.resources.map((r) => `${r.kind} ${r.id}`),
    ];
  } catch (error) {
    errorLine(io, `remove: leftovers could not be listed: ${messageOf(error)}`);
    return { status: EXIT.failed, leftovers: [] };
  }

  for (const l of leftovers) errorLine(io, `leftover: ${l}`);
  if (failures.length > 0 || leftovers.length > 0) {
    errorLine(io, `remove of stage ${stage.stage} failed: ${leftovers.length} leftover resource(s); fix the problem and run remove again`);
    return { status: EXIT.failed, leftovers };
  }
  line(io, `removed stage ${stage.stage} of ${stage.app} from ${ops.target}; its log entries stay in the shared log bucket`);
  return { status: EXIT.ok, leftovers };
}
