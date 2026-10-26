/**
 * `stop --target <t> --stage <s>` and `start --target <t> --stage <s>` (CLI-REQ-001; DEC-0544).
 *
 * `stop` turns the stage's app off without deleting its code, data, secrets or bindings, and
 * records in the stage's record (the target's state home) that it is stopped, so that `deploy`
 * leaves it stopped unless `--start` is given. `start` clears the record and turns the app on.
 * Both work on test and production stages alike, refuse target `local` and an invalid stage name
 * (exit 2), and make the same HTTPS proxy check as the other cloud commands. Exit 1 on any failure
 * (CLI-REQ-003).
 */
import type { Target } from "../../core/identity.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { runStart, runStop } from "../../provision/core/stop-start.js";
import { UsageError } from "../args.js";
import { EXIT, type Command } from "../io.js";
import { checkedStage, parseCloudTargetStage, refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

export interface StopStartDeps {
  readonly env: ProcessEnvironment;
  /** The app's name (`defineApp`). */
  appName(appDir: string): Promise<string>;
  operations(input: { readonly appDir: string; readonly target: Target }): TargetOperations;
}

function stageCommand(name: "stop" | "start", deps: StopStartDeps): Command {
  return async (args, io) => {
    let parsed: { target: Target; stage: string };
    try {
      parsed = parseCloudTargetStage(name, args);
    } catch (error) {
      if (error instanceof UsageError && /cloud targets/.test(error.message)) throw new UsageError(`${name} works on cloud targets; locally, stop dev with Ctrl-C`);
      throw error;
    }
    const stage = checkedStage(parsed.stage);
    const refused = refuseUnreachableCloud(name, deps.env, io);
    if (refused !== undefined) return refused;
    const app = await deps.appName(io.cwd);
    const ops = deps.operations({ appDir: io.cwd, target: parsed.target });
    const status = name === "stop" ? await runStop(ops, { app, stage }, io) : await runStart(ops, { app, stage }, io);
    return status === EXIT.ok ? EXIT.ok : EXIT.failed;
  };
}

export const stopCommand = (deps: StopStartDeps): Command => stageCommand("stop", deps);
export const startCommand = (deps: StopStartDeps): Command => stageCommand("start", deps);

async function bindings(env: ProcessEnvironment): Promise<StopStartDeps> {
  const [{ loadApp }, { targetOperations }] = await Promise.all([import("../../build/load.js"), import("./operations.js")]);
  return {
    env,
    appName: async (appDir) => (await loadApp(appDir)).definition.name,
    operations: targetOperations({ env, requireCredentials: true }),
  };
}

/** `stop` bound to the app loader and the target's operations. */
export async function stopBinding(env: ProcessEnvironment = process.env): Promise<Command> {
  return stopCommand(await bindings(env));
}

/** `start` bound to the app loader and the target's operations. */
export async function startBinding(env: ProcessEnvironment = process.env): Promise<Command> {
  return startCommand(await bindings(env));
}
