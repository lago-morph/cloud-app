/**
 * `setup-account` sequence (PROV-REQ-004): create the account's shared resources that do not
 * exist, change nothing when they all do, and stop before changing anything when one of them
 * exists but this account does not own it. Account settings are recorded by the target with
 * its shared resources (`createSharedResources`), never only on the owner's machine.
 */
import type { TargetOperations } from "./operations.js";
import { EXIT, errorLine, line, messageOf, type ProvisionIo, type ProvisionStatus } from "./output.js";

export interface SetupAccountResult {
  readonly status: ProvisionStatus;
  /** Names of the shared resources created by this run. */
  readonly created: readonly string[];
}

/** The message `setup-account` and `deploy` print for shared resources this account does not own. */
export function foreignResourcesMessage(names: readonly string[]): string {
  return `${names.join(", ")} already exist${names.length === 1 ? "s" : ""} but belong${names.length === 1 ? "s" : ""} to another account (or this account's credentials cannot see ${names.length === 1 ? "it" : "them"}); nothing was changed. Use an account that owns ${names.length === 1 ? "it" : "them"}, or remove ${names.length === 1 ? "it" : "them"} there first.`;
}

export async function runSetupAccount(ops: TargetOperations, io: ProvisionIo): Promise<SetupAccountResult> {
  try {
    const resources = await ops.inspectAccount();
    const foreign = resources.filter((r) => r.state === "foreign").map((r) => r.name);
    if (foreign.length > 0) {
      errorLine(io, `setup-account failed: ${foreignResourcesMessage(foreign)}`);
      return { status: EXIT.failed, created: [] };
    }
    const absent = resources.filter((r) => r.state === "absent");
    const present = resources.filter((r) => r.state === "owned").map((r) => r.name);
    if (present.length > 0) line(io, `already present: ${present.join(", ")}`);
    if (absent.length === 0) {
      line(io, `setup-account (${ops.target}): nothing changed`);
      return { status: EXIT.ok, created: [] };
    }
    await ops.createSharedResources(absent);
    const created = absent.map((r) => r.name);
    line(io, `created: ${created.join(", ")}`);
    return { status: EXIT.ok, created };
  } catch (error) {
    errorLine(io, `setup-account failed: ${messageOf(error)}`);
    return { status: EXIT.failed, created: [] };
  }
}
