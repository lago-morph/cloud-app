/**
 * `setup-account --target <t>` (CLI-REQ-001; PROV-REQ-004; D-05): the one-time creation of the
 * account's shared resources through the target-neutral core (`runSetupAccount`). It creates
 * only absent resources, changes nothing when all exist, and stops before any change when one
 * belongs to another account. These resources are billable and shared by every stage, so this
 * command is the only path that creates them: `deploy` reports them missing and stops, and no
 * other command, script or test helper of the framework runs `setup-account` on its own.
 * Locally there are no shared resources.
 */
import type { Target } from "../../core/identity.js";
import { runSetupAccount } from "../../provision/core/setup-account.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { parseOptions, TARGETS, UsageError } from "../args.js";
import { EXIT, type Command } from "../io.js";
import { refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

export interface SetupAccountDeps {
  readonly env: ProcessEnvironment;
  operations(input: { readonly appDir: string; readonly target: Target }): TargetOperations;
}

export function setupAccountCommand(deps: SetupAccountDeps): Command {
  return async (args, io) => {
    const target = parseOptions(args, ["target"]).get("target");
    if (target === undefined) throw new UsageError("--target is missing");
    if (!(TARGETS as readonly string[]).includes(target)) throw new UsageError(`--target must be one of: ${TARGETS.join(", ")}`);
    if (target === "local") {
      io.stdout("setup-account (local): nothing to set up; the local target has no shared account resources\n");
      return EXIT.ok;
    }
    const refused = refuseUnreachableCloud("setup-account", deps.env, io);
    if (refused !== undefined) return refused;
    return (await runSetupAccount(deps.operations({ appDir: io.cwd, target: target as Target }), io)).status;
  };
}

/** `setup-account` bound to the target's operations from the process environment. */
export async function setupAccountBinding(env: ProcessEnvironment = process.env): Promise<Command> {
  const { cloudflareOperations } = await import("./deploy.js");
  return setupAccountCommand({ env, operations: cloudflareOperations({ env, requireCredentials: true }) });
}
