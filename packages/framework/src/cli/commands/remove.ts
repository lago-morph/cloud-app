/**
 * `remove --target <t> --stage <s> [--confirm-production <s>]` (CLI-REQ-001; PROV-REQ-003; D-05).
 *
 * Removes one stage through the target-neutral PROV core (`runRemove`): the stage's databases
 * by the exact pattern, then everything else of the stage, then a leftover listing. Shared
 * account resources and other stages are never touched. A test stage (`test-…`) is removed as
 * named. A production stage is removed only when `--confirm-production` repeats its name, so a
 * typo or a copied test command can never remove a production stage (DEC-PENDING-D-05-2).
 * After a removal with no leftovers, the stage's recorded deploy output
 * (`.framework/<target>/stages/<stage>.json`) is deleted (plan §5 "From phase C").
 * Exit 1 on any failure or leftover (CLI-REQ-003).
 */
import { checkStageName, type Target } from "../../core/identity.js";
import { runRemove } from "../../provision/core/remove.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { parseOptions, TARGETS, UsageError } from "../args.js";
import { describeFailure } from "../failure.js";
import { EXIT, type Command } from "../io.js";
import { refuseUnreachableCloud } from "./deploy.js";
import type { ProcessEnvironment } from "./smoke-cloud.js";

export interface RemoveDeps {
  readonly env: ProcessEnvironment;
  /** The app's name (`defineApp`). */
  appName(appDir: string): Promise<string>;
  operations(input: { readonly appDir: string; readonly target: Target }): TargetOperations;
  /** Deletes `.framework/<target>/stages/<stage>.json`. */
  forgetDeployOutput(appDir: string, target: Target, stage: string): void;
}

const CONFIRM = "confirm-production";

/** A stage name checked against PAR-291, as a usage error (the name is the owner's own input). */
export function checkedStage(stage: string): string {
  try {
    checkStageName(stage);
  } catch (error) {
    throw new UsageError(describeFailure(error));
  }
  return stage;
}

function parseRemoveOptions(args: readonly string[]): { target: Target; stage: string } {
  const options = parseOptions(args, ["target", "stage", CONFIRM]);
  const target = options.get("target");
  const stage = options.get("stage");
  if (target === undefined) throw new UsageError("--target is missing");
  if (stage === undefined) throw new UsageError("--stage is missing");
  if (!(TARGETS as readonly string[]).includes(target)) throw new UsageError(`--target must be one of: ${TARGETS.join(", ")}`);
  if (target === "local") throw new UsageError("remove works on cloud targets; local state is cleared with reset-local");
  checkedStage(stage);
  const confirmed = options.get(CONFIRM);
  if (stage.startsWith("test-")) {
    if (confirmed !== undefined) throw new UsageError(`--${CONFIRM} is only for production stages; ${stage} is a test stage`);
  } else if (confirmed !== stage) {
    throw new UsageError(`remove removes only test stages (names starting with "test-") unless the production stage is confirmed: add --${CONFIRM} ${stage} to remove production stage ${stage} and all its data`);
  }
  return { target: target as Target, stage };
}

export function removeCommand(deps: RemoveDeps): Command {
  return async (args, io) => {
    const { target, stage } = parseRemoveOptions(args);
    const refused = refuseUnreachableCloud("remove", deps.env, io);
    if (refused !== undefined) return refused;
    const app = await deps.appName(io.cwd);
    const result = await runRemove(deps.operations({ appDir: io.cwd, target }), { app, stage }, io);
    if (result.status !== EXIT.ok) return EXIT.failed;
    deps.forgetDeployOutput(io.cwd, target, stage);
    return EXIT.ok;
  };
}
