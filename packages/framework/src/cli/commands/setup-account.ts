/**
 * `setup-account --target <t> [--region <r>]` (CLI-REQ-001; PROV-REQ-004, PROV-REQ-006; D-05,
 * G-11): the one-time creation of the account's shared resources through the target-neutral
 * core (`runSetupAccount`). It creates only absent resources, changes nothing when all exist, and
 * stops before any change when one belongs to another account. These resources are billable and
 * shared by every stage, so this command is the only path that creates them: `deploy` reports
 * them missing and stops, and no other command, script or test helper of the framework runs
 * `setup-account` on its own. Locally there are no shared resources.
 *
 * `--region` is AWS only: the account's region, recorded as the log bucket's location (DEC-0075,
 * DEC-0476). Without it a new account gets PAR-060 and an existing one keeps its
 * region; a region that differs from an existing log bucket's is refused by the account
 * operations, naming both.
 */
import type { Target } from "../../core/identity.js";
import { runSetupAccount } from "../../provision/core/setup-account.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { parseOptions, TARGETS, UsageError } from "../args.js";
import { EXIT, type Command } from "../io.js";
import { refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

export interface SetupAccountDeps {
  readonly env: ProcessEnvironment;
  operations(input: { readonly appDir: string; readonly target: Target; readonly region?: string }): TargetOperations;
}

/** An AWS region name (`us-east-1`, `ap-southeast-2`, `us-gov-west-1`). */
const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;

export function setupAccountCommand(deps: SetupAccountDeps): Command {
  return async (args, io) => {
    const options = parseOptions(args, ["target", "region"]);
    const target = options.get("target");
    const region = options.get("region");
    if (target === undefined) throw new UsageError("--target is missing");
    if (!(TARGETS as readonly string[]).includes(target)) throw new UsageError(`--target must be one of: ${TARGETS.join(", ")}`);
    if (region !== undefined) {
      if (target !== "aws") throw new UsageError("--region is only for --target aws (the Cloudflare and local targets have no account region)");
      if (!AWS_REGION.test(region)) throw new UsageError("--region must be an AWS region name such as us-east-1");
    }
    if (target === "local") {
      io.stdout("setup-account (local): nothing to set up; the local target has no shared account resources\n");
      return EXIT.ok;
    }
    const refused = refuseUnreachableCloud("setup-account", deps.env, io);
    if (refused !== undefined) return refused;
    return (await runSetupAccount(deps.operations({ appDir: io.cwd, target: target as Target, ...(region === undefined ? {} : { region }) }), io)).status;
  };
}

/** `setup-account` bound to the target's operations from the process environment. */
export async function setupAccountBinding(env: ProcessEnvironment = process.env): Promise<Command> {
  const { targetOperations } = await import("./operations.js");
  return setupAccountCommand({ env, operations: targetOperations({ env, requireCredentials: true }) });
}
