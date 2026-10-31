/**
 * The account setup as named steps (plan-setup-wizard §4.4; DEC-0578): what `setup-account
 * --target cloudflare` does, split so that each part can be checked first and applied only when
 * it is missing.
 *
 * - **Steps** (`SETUP_STEPS`, in order): the account steps of `account.ts` (the log, state and
 *   backup buckets, the backup lifecycle rule, the `workers.dev` subdomain, the R2 signing
 *   credential and its record). Since v0.2.0 there are no email steps and no email domain (plan
 *   §5.3; DEC-0689).
 * - **Inspect** (`inspectSetupSteps`, `checkAccountSetup`): reads only, with the reads the everyday
 *   token's permissions allow (Workers Scripts, R2 Storage): the buckets, the lifecycle rule, the
 *   subdomain and the signing record are each read. No step needs a zone.
 * - **Apply** (`applySetupSteps`, with a token that may create them): inspects every step, stops
 *   before any change when a requested step's resource belongs to another account or when the
 *   token lacks "Account API Tokens Write" for the signing credential (DEC-0551), applies only the
 *   requested steps that are not done, in order, and writes the setup record last
 *   (`setup-record.ts`). A second run finds every step done and changes nothing.
 * - **Current** (`checkAccountSetup`): a setup record with `setupVersion` at least the release's
 *   expected version (`ACCOUNT_SETUP_VERSION`, passed in), and every step done.
 * Messages never contain a token value or the account ID.
 */
import { foreignResourcesMessage } from "../core/setup-account.js";
import { accountSteps, type AccountStepId, type SharedResourceOptions } from "./account.js";
import type { CloudflareApi } from "./api.js";
import { tokenWriteProblems } from "./r2-token.js";
import { readSetupRecord, SETUP_STEPS, writeSetupRecord, type AccountSetupRecord, type SetupStepId } from "./setup-record.js";

export { FIRST_SETUP_VERSION, readSetupRecord, SETUP_STEPS, type AccountSetupRecord, type SetupStepId } from "./setup-record.js";

/** One step's state as an inspection found it. `detail` says why it is not done. */
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
}

interface Inspected {
  readonly id: SetupStepId;
  readonly resource: string;
  readonly state: "owned" | "absent" | "foreign";
  apply(): Promise<void>;
}

/** Every step's inspection, in order. Reads only. */
async function inspectAll(api: CloudflareApi, accountId: string, options: SetupStepOptions): Promise<Inspected[]> {
  const shared = { ...(options.newSubdomain === undefined ? {} : { newSubdomain: options.newSubdomain }) };
  const note = options.note ?? (() => undefined);
  const earlier = new Map<AccountStepId, "owned" | "absent" | "foreign">();
  const out: Inspected[] = [];
  for (const step of accountSteps()) {
    const state = await step.inspect(api, accountId, earlier);
    earlier.set(step.id, state);
    out.push({ id: step.id, resource: step.resource, state, apply: () => step.create(api, accountId, shared, note) });
  }
  return out;
}

const stateOf = (i: Inspected): StepState => ({
  step: i.id,
  done: i.state === "owned",
  ...(i.state === "owned" ? {} : { detail: i.state === "foreign" ? `${i.resource} already exists but belongs to another account (or this account's credentials cannot see it)` : `${i.resource} is absent` }),
  ...(i.state === "foreign" ? { foreign: true } : {}),
});

/** Each setup step's state. Reads only, with the everyday token's permissions. */
export async function inspectSetupSteps(api: CloudflareApi, accountId: string, options: SetupStepOptions = {}): Promise<StepState[]> {
  return (await inspectAll(api, accountId, options)).map(stateOf);
}

/**
 * Whether the account's setup is current for this release (`expectedVersion`: its
 * `ACCOUNT_SETUP_VERSION`): the setup record is at that version or newer, and every step is done.
 * Reads only, with the everyday token's permissions.
 */
export async function checkAccountSetup(api: CloudflareApi, accountId: string, expectedVersion: number, options: SetupStepOptions = {}): Promise<SetupStatus> {
  const record = await readSetupRecord(api, accountId);
  const states = (await inspectAll(api, accountId, options)).map(stateOf);
  const missing = states.filter((s) => !s.done).map((s) => s.step);
  const current = record !== undefined && record.setupVersion >= expectedVersion && missing.length === 0;
  return { ...(record === undefined ? {} : { record }), current, missing };
}

export interface ApplySetupInput extends SetupStepOptions {
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
 * version or completed steps changed). Changes nothing, and throws naming the cause, when a
 * requested step's resource belongs to another account or the token lacks "Account API Tokens
 * Write" for the signing credential. Idempotent: a second run applies nothing and writes nothing.
 */
export async function applySetupSteps(api: CloudflareApi, accountId: string, input: ApplySetupInput): Promise<{ readonly applied: readonly SetupStepId[]; readonly record: AccountSetupRecord; readonly written: boolean }> {
  const unknown = input.steps.filter((s) => !(SETUP_STEPS as readonly string[]).includes(s));
  if (unknown.length > 0) throw new Error(`unknown setup step${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}; nothing was changed`);

  const inspected = await inspectAll(api, accountId, input);
  const requested = inspected.filter((i) => input.steps.includes(i.id));
  const foreign = requested.filter((i) => i.state === "foreign");
  if (foreign.length > 0) throw new Error(foreignResourcesMessage(foreign.map((i) => i.resource)));

  const toApply = requested.filter((i) => i.state !== "owned");
  // The same check as setup-account, before anything changes (DEC-0551).
  if (toApply.some((i) => i.id === "signing-record")) {
    const problems = await tokenWriteProblems(api, accountId);
    if (problems.length > 0) throw new Error(`${problems.join("; ")}; nothing was changed`);
  }
  const applied: SetupStepId[] = [];
  for (const i of toApply) {
    await i.apply();
    applied.push(i.id);
  }
  let written = false;
  const completedSteps = inspected.filter((i) => i.state === "owned" || applied.includes(i.id)).map((i) => i.id);
  const record = await writeSetupRecord(
    api,
    accountId,
    { completedSteps, setupVersion: input.setupVersion, frameworkVersion: input.frameworkVersion, now: input.now },
    applied.length > 0,
    () => {
      written = true;
    },
  );
  return { applied, record, written };
}
