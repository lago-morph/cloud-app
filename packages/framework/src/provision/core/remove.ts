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
 * is removed without a backup. Before the backup the app is stopped and the stop recorded, as
 * `stop` does, so nothing writes while it is copied; a failed backup leaves the stage stopped and
 * names the `start` command. A stop that fails because the app no longer exists (a retry after a
 * partial removal) does not block the backup; any other failed stop deletes nothing (DEC-0557).
 *
 * Before the backup, the stage's earlier backups are listed (a failed listing also deletes
 * nothing). After it, every backup is printed, the usable ones first, newest first; a backup
 * without a manifest, or whose database ids are a strict subset of an earlier backup's (one
 * written by a retry after those databases were deleted), is flagged "do not restore from it", and
 * the closing line names the backup to restore from (DEC-0556, DEC-0557).
 */
import { matchStageDatabases } from "./databases.js";
import type { BackupListing, Stage, StageBackup, TargetOperations } from "./operations.js";
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
  let restoreFrom: BackupListing | undefined;
  if (!isTestStage(stage)) {
    // Nothing may write while the backup copies the stage: it is stopped first, as `stop` does (DEC-0557).
    const stopped = await stopForBackup(ops, stage, io);
    if (stopped === "failed") return { status: EXIT.failed, leftovers: [] };
    const stoppedState =
      stopped === "stopped"
        ? `nothing was deleted; remove stopped the stage for the backup, and it stays stopped (to serve it again: start --target ${ops.target} --stage ${stage.stage})`
        : "nothing was deleted; the stage's app no longer exists";
    let earlier: readonly BackupListing[];
    try {
      const databases = matchStageDatabases(stage, (await ops.listStageResources(stage)).databases);
      // A retry after a partial remove (databases already deleted) writes a backup with less in it:
      // the earlier backups are listed first, so the owner is pointed at a complete one (DEC-0556).
      earlier = await ops.listStageBackups(stage);
      backup = await ops.backupStage(stage, databases);
    } catch (error) {
      errorLine(io, `remove of production stage ${stage.stage} failed: the backup failed: ${messageOf(error)}`);
      errorLine(io, `  stage state: ${stoppedState}`);
      errorLine(io, `  next action: fix the problem (run setup-account --target ${ops.target} if the backup bucket is missing) and run remove again`);
      return { status: EXIT.failed, leftovers: [] };
    }
    line(io, `backed up stage ${stage.stage} to ${backup.location}: ${backup.items.join(", ")}`);
    restoreFrom = printBackups(io, stage, [...earlier.filter((b) => b.stamp !== backup?.listing.stamp), backup.listing]);
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
  if (restoreFrom !== undefined) {
    line(io, `its data stays in the backups above until the backup bucket's lifecycle rule deletes them; to restore it, use ${restoreFrom.location} and follow "Restore a removed production stage" in the skill's reference/deploying.md`);
  }
  return { status: EXIT.ok, leftovers, ...withBackup };
}

/**
 * Stops the app and records the stop, as `stop` does, before a production backup. `gone`: the
 * stop failed because the app no longer exists (a retry after a partial removal), so nothing can
 * write. `failed`: printed; nothing was deleted or backed up.
 */
async function stopForBackup(ops: TargetOperations, stage: Stage, io: ProvisionIo): Promise<"stopped" | "gone" | "failed"> {
  const fail = (what: string, error: unknown, state: string) => {
    errorLine(io, `remove of production stage ${stage.stage} failed: ${what} failed: ${messageOf(error)}`);
    errorLine(io, `  stage state: ${state}`);
    errorLine(io, "  next action: fix the problem and run remove again");
    return "failed" as const;
  };
  try {
    await ops.stopApp(stage);
  } catch (error) {
    let exists: boolean;
    try {
      exists = (await ops.listStageResources(stage)).resources.some((r) => r.kind === ops.appResourceKind);
    } catch {
      exists = true;
    }
    return exists ? fail("stopping the app for the backup", error, "nothing was deleted; the app may still be running") : "gone";
  }
  try {
    await ops.writeStageRecord(stage, { stopped: true });
  } catch (error) {
    return fail("recording the stop for the backup", error, `nothing was deleted; the app is stopped (to serve it again: start --target ${ops.target} --stage ${stage.stage})`);
  }
  line(io, `stopped stage ${stage.stage} for the backup`);
  // Requests the app took before it stopped may still be writing: a bounded wait for them (PAR-315 on Cloudflare).
  try {
    line(io, `${await ops.waitForInFlight(stage)} before the backup`);
  } catch (error) {
    return fail("waiting for requests in flight", error, `nothing was deleted; the app is stopped (to serve it again: start --target ${ops.target} --stage ${stage.stage})`);
  }
  return "stopped";
}

/**
 * Prints every backup of the stage, the usable ones first, newest first, and flags the others;
 * returns the one to restore from (DEC-0557). A backup is flagged when it has no manifest (it did
 * not finish), or when its database ids are a strict subset of an earlier backup's: it was written
 * after some of those very databases were deleted (a retry after a partial removal). A backup of
 * an earlier lifetime of the stage holds other databases, so it never makes a fresh one look
 * incomplete. A manifest without ids (an older one) is never flagged for its databases.
 */
function printBackups(io: ProvisionIo, stage: Stage, backups: readonly BackupListing[]): BackupListing | undefined {
  const supersetOf = (b: BackupListing): BackupListing | undefined => {
    const ids = b.databaseIds;
    if (ids === undefined) return undefined;
    return backups.find((e) => e.complete && e.stamp < b.stamp && e.databaseIds !== undefined && e.databaseIds.length > ids.length && ids.every((id) => e.databaseIds?.includes(id)));
  };
  const usable = (b: BackupListing) => b.complete && supersetOf(b) === undefined;
  const newestFirst = (a: BackupListing, b: BackupListing) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0);
  const ordered = [...backups.filter(usable).sort(newestFirst), ...backups.filter((b) => !usable(b)).sort(newestFirst)];
  line(io, `backups of stage ${stage.stage} (the one to restore from first):`);
  for (const b of ordered) {
    const fuller = supersetOf(b);
    const what = !b.complete
      ? "INCOMPLETE: no manifest (the backup did not finish); do not restore from it"
      : fuller === undefined
        ? `${b.databases ?? 0} database(s), ${b.files ?? 0} file(s)`
        : `INCOMPLETE: holds ${b.databaseIds?.length ?? 0} of the ${fuller.databaseIds?.length ?? 0} database(s) of the earlier backup ${fuller.stamp}; do not restore from it`;
    line(io, `  ${b.location}: ${what}`);
  }
  return ordered.find(usable);
}
