/**
 * `setup-account` sequence (PROV-REQ-004 and its amendment; DEC-0514): create the account's
 * shared resources that do not exist, record the account settings, set up the email domain, and
 * change nothing when all of that is already in place. It stops before changing anything when a
 * shared resource exists but this account does not own it, or when no email domain is known.
 *
 * The email domain is the account settings record's `emailDomain`: `--email-domain` sets it
 * (required while the record has none) and is also how the owner changes it; the record is
 * written only when the value changes, after the shared resources (the record lives in the state
 * home) exist. Account settings are kept by the target with its shared resources, never only on
 * the owner's machine (PROV §2 "State home").
 */
import { emailDomainProblem } from "./account-settings.js";
import type { TargetOperations } from "./operations.js";
import { EXIT, errorLine, line, messageOf, type ProvisionIo, type ProvisionStatus } from "./output.js";

export interface SetupAccountRequest {
  /** `--email-domain`: the account's email domain to record (required while the record has none). */
  readonly emailDomain?: string;
}

export interface SetupAccountResult {
  readonly status: ProvisionStatus;
  /** Names of the shared resources (and parts of the email setup) created by this run. */
  readonly created: readonly string[];
  /** The email domain recorded by this run; absent when the record was left unchanged. */
  readonly recorded?: string;
}

/** The message `setup-account` and `deploy` print for shared resources this account does not own. */
export function foreignResourcesMessage(names: readonly string[]): string {
  return `${names.join(", ")} already exist${names.length === 1 ? "s" : ""} but belong${names.length === 1 ? "s" : ""} to another account (or this account's credentials cannot see ${names.length === 1 ? "it" : "them"}); nothing was changed. Use an account that owns ${names.length === 1 ? "it" : "them"}, or remove ${names.length === 1 ? "it" : "them"} there first.`;
}

/** The message for an account settings record without an email domain. */
export function noEmailDomainMessage(target: string): string {
  return `the account settings record names no email domain; run setup-account --target ${target} --email-domain <domain>`;
}

export async function runSetupAccount(ops: TargetOperations, io: ProvisionIo, request: SetupAccountRequest = {}): Promise<SetupAccountResult> {
  const failed = (message: string): SetupAccountResult => {
    errorLine(io, `setup-account failed: ${message}`);
    return { status: EXIT.failed, created: [] };
  };
  try {
    if (request.emailDomain !== undefined) {
      const problem = emailDomainProblem(request.emailDomain);
      if (problem !== undefined) return failed(`--email-domain ${problem}; nothing was changed`);
    }
    const resources = await ops.inspectAccount();
    const foreign = resources.filter((r) => r.state === "foreign").map((r) => r.name);
    if (foreign.length > 0) return failed(foreignResourcesMessage(foreign));
    const settings = await ops.readAccountSettings();
    const emailDomain = request.emailDomain ?? settings.emailDomain;
    if (emailDomain === undefined) return failed(`${noEmailDomainMessage(ops.target)}; nothing was changed`);

    const absent = resources.filter((r) => r.state === "absent");
    const present = resources.filter((r) => r.state === "owned").map((r) => r.name);
    if (present.length > 0) line(io, `already present: ${present.join(", ")}`);
    const created: string[] = [];
    if (absent.length > 0) {
      await ops.createSharedResources(absent);
      created.push(...absent.map((r) => r.name));
      line(io, `created: ${created.join(", ")}`);
    }

    let recorded: string | undefined;
    if (settings.emailDomain !== emailDomain) {
      await ops.writeAccountSettings({ ...settings, emailDomain });
      recorded = emailDomain;
      line(io, `recorded the account's email domain: ${emailDomain}`);
      if (settings.emailDomain !== undefined) line(io, `the previous email domain ${settings.emailDomain} keeps its email setup; nothing of it was removed`);
    } else {
      line(io, `email domain: ${emailDomain} (unchanged)`);
    }

    const email = await ops.setUpEmail(emailDomain);
    if (email.length > 0) {
      created.push(...email);
      line(io, `email setup created: ${email.join(", ")}`);
    }

    if (created.length === 0 && recorded === undefined) line(io, `setup-account (${ops.target}): nothing changed`);
    return { status: EXIT.ok, created, ...(recorded === undefined ? {} : { recorded }) };
  } catch (error) {
    return failed(messageOf(error));
  }
}
