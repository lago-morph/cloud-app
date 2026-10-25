/**
 * `stop` and `start` (CLI-REQ-001; DEC-0544), target-neutral. The stage's record in the target's
 * state home says whether the owner stopped it, so that `deploy` leaves a stopped stage stopped
 * unless `--start` is given.
 *
 * - `stop`: turns the app off (`stopApp`), then records `stopped`. If recording fails, the app
 *   is off but a deploy would start it again; the failure says so and `stop` exits 1.
 * - `start`: deletes the record first, then turns the app on (`startApp`). If starting fails,
 *   the record already says "not stopped", so the next deploy starts the app.
 * Neither changes code, data, secrets or bindings, and both may be run again safely.
 */
import type { Stage, TargetOperations } from "./operations.js";
import { EXIT, errorLine, line, messageOf, type ProvisionIo, type ProvisionStatus } from "./output.js";

export async function runStop(ops: TargetOperations, stage: Stage, io: ProvisionIo): Promise<ProvisionStatus> {
  try {
    await ops.stopApp(stage);
  } catch (error) {
    errorLine(io, `stop of stage ${stage.stage} failed: ${messageOf(error)}`);
    errorLine(io, "  stage state: unchanged (deploy the stage first if it does not exist)");
    return EXIT.failed;
  }
  try {
    await ops.writeStageRecord(stage, { stopped: true });
  } catch (error) {
    errorLine(io, `stop of stage ${stage.stage} failed: recording the stop failed: ${messageOf(error)}`);
    errorLine(io, "  stage state: the app is stopped, but a deploy would start it again");
    errorLine(io, "  next action: run stop again");
    return EXIT.failed;
  }
  line(io, `stopped ${stage.app} stage ${stage.stage} on ${ops.target}; its code, data and secrets stay. deploy leaves it stopped; start it with start --target ${ops.target} --stage ${stage.stage}`);
  return EXIT.ok;
}

export async function runStart(ops: TargetOperations, stage: Stage, io: ProvisionIo): Promise<ProvisionStatus> {
  try {
    await ops.writeStageRecord(stage, { stopped: false });
  } catch (error) {
    errorLine(io, `start of stage ${stage.stage} failed: clearing the stop record failed: ${messageOf(error)}`);
    errorLine(io, "  stage state: unchanged");
    return EXIT.failed;
  }
  try {
    await ops.startApp(stage);
  } catch (error) {
    errorLine(io, `start of stage ${stage.stage} failed: ${messageOf(error)}`);
    errorLine(io, "  stage state: no longer recorded as stopped; the app is not started (the next deploy starts it)");
    errorLine(io, "  next action: run start again, or deploy the stage if it does not exist");
    return EXIT.failed;
  }
  line(io, `started ${stage.app} stage ${stage.stage} on ${ops.target}`);
  return EXIT.ok;
}
