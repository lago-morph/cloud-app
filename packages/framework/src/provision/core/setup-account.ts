/**
 * `setup-account` sequence (PROV-REQ-004 and its amendments; DEC-0514): create the account's
 * shared resources that do not exist, record the account setup, and change nothing when all of
 * that is already in place. It stops before changing anything when a shared resource exists but
 * this account does not own it, or when a prerequisite is missing (on Cloudflare, the permission
 * to create the R2 signing credential, DEC-0551); each missing one is named.
 *
 * Since v0.2.0 there is no email domain and no email setup, and `setup-account` takes no
 * `--email-domain` (PROV-REQ-004's v0.2.0 amendment, DEC-0698; DEC-0689). An email domain a 0.1.x
 * setup recorded is left as it is. Account settings are kept by the target with its shared
 * resources, never only on the owner's machine (PROV §2 "State home").
 */
import type { TargetOperations } from "./operations.js";
import { EXIT, errorLine, line, messageOf, type ProvisionIo, type ProvisionStatus } from "./output.js";

export interface SetupAccountResult {
  readonly status: ProvisionStatus;
  /** Names of the shared resources (and the setup record) created or written by this run. */
  readonly created: readonly string[];
}

/** The message `setup-account` and `deploy` print for shared resources this account does not own. */
export function foreignResourcesMessage(names: readonly string[]): string {
  return `${names.join(", ")} already exist${names.length === 1 ? "s" : ""} but belong${names.length === 1 ? "s" : ""} to another account (or this account's credentials cannot see ${names.length === 1 ? "it" : "them"}); nothing was changed. Use an account that owns ${names.length === 1 ? "it" : "them"}, or remove ${names.length === 1 ? "it" : "them"} there first.`;
}

export async function runSetupAccount(ops: TargetOperations, io: ProvisionIo): Promise<SetupAccountResult> {
  const failed = (message: string): SetupAccountResult => {
    errorLine(io, `setup-account failed: ${message}`);
    return { status: EXIT.failed, created: [] };
  };
  try {
    const resources = await ops.inspectAccount();
    const foreign = resources.filter((r) => r.state === "foreign").map((r) => r.name);
    if (foreign.length > 0) return failed(foreignResourcesMessage(foreign));
    // The prerequisites are checked before anything changes (PROV-AC-004).
    const problems = await ops.setupProblems();
    if (problems.length > 0) return failed(`${problems.join("; ")}; nothing was changed`);

    const absent = resources.filter((r) => r.state === "absent");
    const present = resources.filter((r) => r.state === "owned").map((r) => r.name);
    if (present.length > 0) line(io, `already present: ${present.join(", ")}`);
    const created: string[] = [];
    if (absent.length > 0) {
      await ops.createSharedResources(absent, (message) => line(io, message));
      created.push(...absent.map((r) => r.name));
      line(io, `created: ${created.join(", ")}`);
    }

    const recorded = await ops.recordSetup();
    if (recorded.length > 0) {
      created.push(...recorded);
      line(io, `recorded: ${recorded.join(", ")}`);
    }

    if (created.length === 0) line(io, `setup-account (${ops.target}): nothing changed`);
    return { status: EXIT.ok, created };
  } catch (error) {
    return failed(messageOf(error));
  }
}
