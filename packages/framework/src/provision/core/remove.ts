/**
 * The `remove` sequence (PROV-REQ-003; provisioning.md §2 "Removal"), target-neutral:
 * delete the stage's CLI-owned databases, matched by the exact pattern, then let the target
 * remove everything else of the stage, then list what is left. Every step is attempted even
 * when an earlier one failed; each leftover is printed by name and the exit status is 1.
 * Shared account resources and other stages are never touched (the target's `removeStage`
 * works by the stage's exact identifiers).
 *
 * A production stage (any name not starting with `test-`) is backed up first (DEC-0543): the
 * target exports its databases and copies its files to the account's backup bucket. Only when
 * that succeeded is anything deleted; a failed backup deletes nothing and exits 1. A test stage
 * is removed without a backup.
 */
import { matchStageDatabases } from "./databases.js";
import type { Stage, StageBackup, TargetOperations } from "./operations.js";
import { EXIT, errorLine, line, messageOf, type ProvisionIo, type ProvisionStatus } from "./output.js";

export interface RemoveResult {
  readonly status: ProvisionStatus;
  /** Leftover resources by name (`database <name>`, `<kind> <id>`). */
  readonly leftovers: readonly string[];
  /** A production stage's backup, written before anything was deleted. */
  readonly backup?: StageBackup;
}

const isTestStage = (stage: Stage) => stage.stage.startsWith("test-");

export async function runRemove(ops: TargetOperations, stage: Stage, io: ProvisionIo): Promise<RemoveResult> {
  const failures: string[] = [];
  const record = (what: string, error: unknown) => {
    failures.push(`${what}: ${messageOf(error)}`);
    errorLine(io, `remove: ${what} failed: ${messageOf(error)}`);
  };

  let backup: StageBackup | undefined;
  if (!isTestStage(stage)) {
    try {
      const databases = matchStageDatabases(stage, (await ops.listStageResources(stage)).databases);
      backup = await ops.backupStage(stage, databases);
    } catch (error) {
      errorLine(io, `remove of production stage ${stage.stage} failed: the backup failed: ${messageOf(error)}`);
      errorLine(io, "  stage state: nothing was deleted; the stage is unchanged");
      errorLine(io, `  next action: fix the problem (run setup-account --target ${ops.target} if the backup bucket is missing) and run remove again`);
      return { status: EXIT.failed, leftovers: [] };
    }
    line(io, `backed up stage ${stage.stage} to ${backup.location}: ${backup.items.join(", ")}`);
  }
  const withBackup = backup === undefined ? {} : { backup };

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
    return { status: EXIT.failed, leftovers: [], ...withBackup };
  }

  for (const l of leftovers) errorLine(io, `leftover: ${l}`);
  if (failures.length > 0 || leftovers.length > 0) {
    errorLine(io, `remove of stage ${stage.stage} failed: ${leftovers.length} leftover resource(s); fix the problem and run remove again`);
    return { status: EXIT.failed, leftovers, ...withBackup };
  }
  line(io, `removed stage ${stage.stage} of ${stage.app} from ${ops.target}; its log entries stay in the shared log bucket`);
  if (backup !== undefined) line(io, `its data stays in ${backup.location} until the backup bucket's lifecycle rule deletes it; to restore it, follow "Restore a removed production stage" in the skill's reference/deploying.md`);
  return { status: EXIT.ok, leftovers, ...withBackup };
}
