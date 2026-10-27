/**
 * The account setup as named steps (plan-setup-wizard §4.4; DEC-0578): what `setup-account
 * --target cloudflare` does, split so that each part can be checked first and applied only when
 * it is missing.
 *
 * - **Steps** (`SETUP_STEPS`, in order): the account steps of `account.ts` (the log, state and
 *   backup buckets, the backup lifecycle rule, the `workers.dev` subdomain, the R2 signing
 *   credential and its record), then the email steps of `email.ts` for the email domain (Email
 *   Sending, the mail sink's bucket, lifecycle rule and Worker, Email Routing on `t.<domain>`,
 *   subaddressing, and the test mailbox's routing rule).
 * - **Inspect** (`inspectSetupSteps`, `checkAccountSetup`): reads only, with the reads the everyday
 *   token's permissions allow (Workers Scripts, R2 Storage, Email Sending Read, Zone Read, Email
 *   Routing Rules Read): the buckets, the lifecycle rules, the subdomain, the signing record, the
 *   sending entry, the sink Worker and the routing rule are each read. Two reads may be refused it:
 *   the routing DNS records (the zone's `dns_records` needs "DNS Read") and the routing settings.
 *   A step whose read is refused counts as done only when the setup record of the same domain
 *   lists it as completed, and its `detail` says so.
 * - **Apply** (`applySetupSteps`, with the bootstrap token): inspects every step, reading each one
 *   directly (a refused read stops it; the record never vouches here), stops before any
 *   change when a requested step's resource belongs to another account or when the token lacks a
 *   permission the setup needs (as `setup-account`, DEC-0515, DEC-0551), applies only the
 *   requested steps that are not done, in order, and writes the setup record last
 *   (`setup-record.ts`). A second run finds every step done and changes nothing.
 * - **Current** (`checkAccountSetup`): a setup record with `setupVersion` at least the release's
 *   expected version (`ACCOUNT_SETUP_VERSION`, passed in), the same email domain, and every step
 *   done.
 * Messages never contain a token value or the account ID.
 */
import { emailDomainProblem } from "../core/account-settings.js";
import { foreignResourcesMessage } from "../core/setup-account.js";
import { ACCOUNT_STEP_IDS, accountSteps, type AccountStepId, type SharedResourceOptions } from "./account.js";
import type { CloudflareApi } from "./api.js";
import { createCloudflareEmailSetup, EMAIL_RESOURCES, type EmailSetupOptions, type EmailStepId, type StepInspection } from "./email.js";
import { tokenWriteProblems } from "./r2-token.js";
import { readSetupRecord, SETUP_STEPS, writeSetupRecord, type AccountSetupRecord, type SetupStepId } from "./setup-record.js";

export { FIRST_SETUP_VERSION, readSetupRecord, SETUP_STEPS, type AccountSetupRecord, type SetupStepId } from "./setup-record.js";
export type { StepInspection } from "./email.js";

/** One step's state as an inspection found it. `detail` says why it is not done (or why a refused read counts as done). */
export interface StepState {
  readonly step: SetupStepId;
  readonly done: boolean;
  readonly detail?: string;
  /** The step's resource exists but this account does not own it: applying it is refused. */
  readonly foreign?: boolean;
}

export interface SetupStatus {
  /** The stored setup record; absent when there is none or it predates the setup fields. */
  readonly record?: AccountSetupRecord;
  readonly current: boolean;
  /** The steps not done, in order. */
  readonly missing: readonly SetupStepId[];
}

/** Optional settings of the steps' Cloudflare calls (the defaults are the real ones). */
export interface SetupStepOptions {
  /** The subdomain the `subdomain` step registers (default random, DEC-0552). */
  readonly newSubdomain?: SharedResourceOptions["newSubdomain"];
  /** Receives what the owner must do afterwards (a replaced signing credential). */
  readonly note?: (message: string) => void;
  /** The email steps' polling and waits (`EmailSetupOptions`). */
  readonly email?: Omit<EmailSetupOptions, "api" | "accountId">;
}

interface Step {
  readonly id: SetupStepId;
  /** As printed to the owner. */
  resource(emailDomain: string): string;
  inspect(emailDomain: string, earlier: ReadonlyMap<AccountStepId, "owned" | "absent" | "foreign">): Promise<StepInspection>;
  apply(emailDomain: string): Promise<void>;
}

const EMAIL_STEP_RESOURCES: Readonly<Record<EmailStepId, (domain: string) => string>> = {
  "email-sending": EMAIL_RESOURCES.sending,
  "mailsink-bucket": () => EMAIL_RESOURCES.bucket,
  "mailsink-lifecycle": () => EMAIL_RESOURCES.lifecycle,
  "mailsink-worker": () => EMAIL_RESOURCES.worker,
  "test-mailbox-dns": EMAIL_RESOURCES.routing,
  subaddressing: () => EMAIL_RESOURCES.subaddress,
  "test-mailbox-route": EMAIL_RESOURCES.rule,
};

function stepsOf(api: CloudflareApi, accountId: string, options: SetupStepOptions) {
  const email = createCloudflareEmailSetup({ api, accountId, ...options.email });
  const shared = { ...(options.newSubdomain === undefined ? {} : { newSubdomain: options.newSubdomain }) };
  const note = options.note ?? (() => undefined);
  const steps: Step[] = [
    ...accountSteps().map(
      (s): Step => ({
        id: s.id,
        resource: () => s.resource,
        async inspect(_domain, earlier) {
          const state = await s.inspect(api, accountId, earlier);
          if (state === "owned") return { state: "done" };
          if (state === "foreign") return { state, detail: `${s.resource} already exists but belongs to another account (or this account's credentials cannot see it)` };
          return { state: "missing", detail: `${s.resource} is absent` };
        },
        apply: () => s.create(api, accountId, shared, note),
      }),
    ),
    ...email.steps.map(
      (s): Step => ({
        id: s.id,
        resource: EMAIL_STEP_RESOURCES[s.id],
        inspect: (domain) => s.inspect(domain),
        apply: async (domain) => void (await s.apply(domain)),
      }),
    ),
  ];
  return { email, steps };
}

interface Inspected {
  readonly step: Step;
  readonly inspection: StepInspection;
  /** Done, or a refused read the setup record vouches for. */
  readonly done: boolean;
  readonly detail?: string;
}

/**
 * Every step's inspection. With `record` a refused read counts as done when the record of the same
 * domain lists the step (the everyday token's inspection). With `"direct"` (the bootstrap token's
 * apply, DEC-0579) a refused read is an error naming the step: its token must read every step.
 */
async function inspectAll(steps: readonly Step[], emailDomain: string, record: AccountSetupRecord | undefined | "direct"): Promise<Inspected[]> {
  const earlier = new Map<AccountStepId, "owned" | "absent" | "foreign">();
  const out: Inspected[] = [];
  for (const step of steps) {
    const inspection = await step.inspect(emailDomain, earlier);
    if ((ACCOUNT_STEP_IDS as readonly string[]).includes(step.id)) {
      earlier.set(step.id as AccountStepId, inspection.state === "done" ? "owned" : inspection.state === "foreign" ? "foreign" : "absent");
    }
    if (inspection.state === "unreadable" && record === "direct") {
      throw new Error(`the token could not read ${step.resource(emailDomain)} (${inspection.detail ?? "the read was refused"}); nothing was changed`);
    }
    if (inspection.state !== "unreadable" || record === "direct") {
      out.push({ step, inspection, done: inspection.state === "done", ...(inspection.detail === undefined ? {} : { detail: inspection.detail }) });
      continue;
    }
    const vouched = record !== undefined && record.emailDomain === emailDomain && record.completedSteps.includes(step.id);
    out.push({
      step,
      inspection,
      done: vouched,
      detail: `${inspection.detail ?? "the read was refused"}; the setup record ${vouched ? "lists it as completed" : "does not list it as completed"}`,
    });
  }
  return out;
}

const stateOf = (i: Inspected): StepState => ({
  step: i.step.id,
  done: i.done,
  ...(i.detail === undefined ? {} : { detail: i.detail }),
  ...(i.inspection.state === "foreign" ? { foreign: true } : {}),
});

/** Each setup step's state for the email domain. Reads only, with the everyday token's permissions. */
export async function inspectSetupSteps(api: CloudflareApi, accountId: string, emailDomain: string, options: SetupStepOptions = {}): Promise<StepState[]> {
  const record = await readSetupRecord(api, accountId);
  return (await inspectAll(stepsOf(api, accountId, options).steps, emailDomain, record)).map(stateOf);
}

/**
 * Whether the account's setup is current for this release (`expectedVersion`: its
 * `ACCOUNT_SETUP_VERSION`) and the email domain: the setup record is at that version or newer and
 * names the same domain, and every step is done. Reads only, with the everyday token's permissions.
 */
export async function checkAccountSetup(api: CloudflareApi, accountId: string, emailDomain: string, expectedVersion: number, options: SetupStepOptions = {}): Promise<SetupStatus> {
  const record = await readSetupRecord(api, accountId);
  const states = (await inspectAll(stepsOf(api, accountId, options).steps, emailDomain, record)).map(stateOf);
  const missing = states.filter((s) => !s.done).map((s) => s.step);
  const current = record !== undefined && record.setupVersion >= expectedVersion && record.emailDomain === emailDomain && missing.length === 0;
  return { ...(record === undefined ? {} : { record }), current, missing };
}

export interface ApplySetupInput extends SetupStepOptions {
  readonly emailDomain: string;
  /** The steps to apply when not done (e.g. `checkAccountSetup`'s `missing`, or `SETUP_STEPS`). */
  readonly steps: readonly SetupStepId[];
  /** The release's `ACCOUNT_SETUP_VERSION`. */
  readonly setupVersion: number;
  readonly frameworkVersion: string;
  readonly now: () => Date;
}

/**
 * Applies the requested steps that are not done, in order, and then writes the setup record
 * (`applied`: the steps it ran; `written`: whether the record was written, also when only its
 * version or completed steps changed). Needs the bootstrap token's permissions for any change; changes
 * nothing, and throws naming the cause, when the domain is invalid, a step's read is refused, a
 * requested step's resource belongs to another account, or the token lacks a permission.
 * Idempotent: a second run applies nothing and writes nothing.
 */
export async function applySetupSteps(api: CloudflareApi, accountId: string, input: ApplySetupInput): Promise<{ readonly applied: readonly SetupStepId[]; readonly record: AccountSetupRecord; readonly written: boolean }> {
  const problem = emailDomainProblem(input.emailDomain);
  if (problem !== undefined) throw new Error(`the email domain ${problem}; nothing was changed`);
  const unknown = input.steps.filter((s) => !(SETUP_STEPS as readonly string[]).includes(s));
  if (unknown.length > 0) throw new Error(`unknown setup step${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}; nothing was changed`);

  const { email, steps } = stepsOf(api, accountId, input);
  // The bootstrap token reads every step itself; the record never stands in for a refused read (DEC-0579).
  const inspected = await inspectAll(steps, input.emailDomain, "direct");
  const requested = inspected.filter((i) => input.steps.includes(i.step.id));
  const foreign = requested.filter((i) => i.inspection.state === "foreign");
  if (foreign.length > 0) throw new Error(foreignResourcesMessage(foreign.map((i) => i.step.resource(input.emailDomain))));

  const toApply = requested.filter((i) => !i.done);
  if (toApply.length > 0) {
    // The same checks as setup-account, before anything changes (DEC-0515, DEC-0551).
    const problems = [...(await email.setupProblems(input.emailDomain))];
    if (toApply.some((i) => i.step.id === "signing-record")) problems.push(...(await tokenWriteProblems(api, accountId)));
    if (problems.length > 0) throw new Error(`${problems.join("; ")}; nothing was changed`);
  }
  const applied: SetupStepId[] = [];
  for (const i of toApply) {
    await i.step.apply(input.emailDomain);
    applied.push(i.step.id);
  }
  let written = false;
  const completedSteps = inspected.filter((i) => i.done || applied.includes(i.step.id)).map((i) => i.step.id);
  const record = await writeSetupRecord(
    api,
    accountId,
    { emailDomain: input.emailDomain, completedSteps, setupVersion: input.setupVersion, frameworkVersion: input.frameworkVersion, now: input.now },
    applied.length > 0,
    () => {
      written = true;
    },
  );
  return { applied, record, written };
}
