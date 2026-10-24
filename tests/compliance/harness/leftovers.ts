/**
 * The leftover check of a compliance cloud run (COMPL-REQ-004, compliance.md "Test stages"):
 * every resource of PROV's removal list still present for a test stage, by exact name, read
 * through the target's `listStageResources` (PROV §2). Databases are matched by the exact
 * stage pattern, never a wildcard. Only `test-` stages are ever checked or cleaned up: the
 * `prodcheck` stage is exempt.
 */
import { matchStageDatabases } from "../../../packages/framework/src/provision/core/databases.js";
import type { Stage, TargetOperations } from "../../../packages/framework/src/provision/core/operations.js";

/** The reference app's name (`apps/reference`). */
export const REFERENCE_APP = "reference";

export function assertTestStage(stage: string): void {
  if (!stage.startsWith("test-")) throw new Error(`stage ${stage}: compliance cleanup handles test stages only (names starting with test-)`);
}

/** Leftovers as `database <name>` and `<kind> <id>`, in the form `remove` prints them. */
export async function stageLeftovers(ops: Pick<TargetOperations, "listStageResources">, stage: Stage): Promise<string[]> {
  assertTestStage(stage.stage);
  const listed = await ops.listStageResources(stage);
  return [...matchStageDatabases(stage, listed.databases).map((d) => `database ${d.name}`), ...listed.resources.map((r) => `${r.kind} ${r.id}`)];
}
