/**
 * The account setup record (plan-setup-wizard §4.4; DEC-0577): the account settings record
 * `framework/account.json` in the state home `sst-state` (`account-settings.ts`, DEC-0514) also
 * says which setup was applied to the account:
 * `{ "emailDomain", "setupVersion", "frameworkVersion", "appliedAt", "completedSteps" }`.
 * - `setupVersion`: the account setup version the run applied (the release's `ACCOUNT_SETUP_VERSION`,
 *   raised by a release that adds or changes a setup step). A record is current for a release
 *   expecting version N when its `setupVersion` is N or more.
 * - `frameworkVersion`: the framework package's version that applied it; `appliedAt`: when (ISO).
 * - `emailDomain`: the domain the email steps were applied for; the same field `deploy`,
 *   `check-login` and `mail` read (`parseAccountSettings`, which ignores the other fields).
 * - `completedSteps`: the setup steps (`setup-steps.ts`) found done or applied by that run.
 *
 * Read through the R2 object endpoints of `api.cloudflare.com`, which the everyday token's
 * "Workers R2 Storage Write" allows. A record without these fields (written before them) or with
 * an invalid one reads as no setup record, so the account counts as not set up for this release.
 * Written last by a setup run, after every step succeeded, and only when it changes (a second run
 * that applies nothing writes nothing); every other field of the object is kept.
 */
import { readFileSync } from "node:fs";
import { describeFailure, type CloudflareApi } from "./api.js";
import { ACCOUNT_SETTINGS_KEY, ACCOUNT_SETTINGS_RESOURCE } from "./account-settings.js";
import { ACCOUNT_STEP_IDS } from "./account.js";
import { EMAIL_STEP_IDS } from "./email.js";
import { STATE_BUCKET } from "./names.js";

/** The account setup's steps, in the order they are applied (DEC-0578). */
export const SETUP_STEPS = Object.freeze([...ACCOUNT_STEP_IDS, ...EMAIL_STEP_IDS] as const);
export type SetupStepId = (typeof SETUP_STEPS)[number];

/** The first account setup version: setups applied by a release without the record count as older. */
export const FIRST_SETUP_VERSION = 1;

export interface AccountSetupRecord {
  readonly setupVersion: number;
  readonly frameworkVersion: string;
  /** ISO time. */
  readonly appliedAt: string;
  readonly emailDomain: string;
  readonly completedSteps: readonly SetupStepId[];
}

const objectPath = (accountId: string) => `/accounts/${accountId}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(ACCOUNT_SETTINGS_KEY)}`;

const isStep = (value: unknown): value is SetupStepId => typeof value === "string" && (SETUP_STEPS as readonly string[]).includes(value);

/** The stored object as JSON, or undefined when it (or the state home) does not exist. Reads only. */
export async function readAccountObject(api: CloudflareApi, accountId: string): Promise<Record<string, unknown> | undefined> {
  const r = await api("GET", objectPath(accountId));
  if (r.status === 404) return undefined;
  if (r.status < 200 || r.status >= 300) throw new Error(`reading the ${ACCOUNT_SETTINGS_RESOURCE} failed: ${describeFailure(r)}`);
  return typeof r.body === "object" && r.body !== null && !Array.isArray(r.body) ? (r.body as Record<string, unknown>) : {};
}

/**
 * The setup record in a stored object; undefined when a field is absent or invalid (a record from
 * before the setup fields reads as none). Step names this release does not know are left out.
 */
export function parseSetupRecord(body: Readonly<Record<string, unknown>> | undefined): AccountSetupRecord | undefined {
  if (body === undefined) return undefined;
  const { setupVersion, frameworkVersion, appliedAt, emailDomain, completedSteps } = body;
  if (typeof setupVersion !== "number" || !Number.isInteger(setupVersion) || setupVersion < 1) return undefined;
  if (typeof frameworkVersion !== "string" || typeof appliedAt !== "string" || typeof emailDomain !== "string" || emailDomain === "") return undefined;
  if (!Array.isArray(completedSteps)) return undefined;
  return { setupVersion, frameworkVersion, appliedAt, emailDomain, completedSteps: SETUP_STEPS.filter((id) => completedSteps.some((s) => isStep(s) && s === id)) };
}

/** The account setup record; undefined when there is none (or it predates the setup fields). Reads only. */
export async function readSetupRecord(api: CloudflareApi, accountId: string): Promise<AccountSetupRecord | undefined> {
  return parseSetupRecord(await readAccountObject(api, accountId));
}

/** What a setup run records. */
export interface SetupRecordInput {
  readonly emailDomain: string;
  readonly completedSteps: readonly SetupStepId[];
  readonly setupVersion: number;
  readonly frameworkVersion: string;
  readonly now: () => Date;
}

/**
 * Writes the setup record unless the stored one already says the same: same domain, the same
 * completed steps and a `setupVersion` at least the input's (`changed` forces the write: the run
 * applied a step). A stored higher `setupVersion` is kept: an older release re-running setup on
 * an account a newer one set up does not make it look out of date to the newer one. Every other
 * field of the stored object is kept. Returns the record now stored.
 */
export async function writeSetupRecord(api: CloudflareApi, accountId: string, input: SetupRecordInput, changed: boolean): Promise<AccountSetupRecord> {
  const stored = await readAccountObject(api, accountId);
  const previous = parseSetupRecord(stored);
  const completedSteps = SETUP_STEPS.filter((id) => input.completedSteps.includes(id));
  const same =
    previous !== undefined &&
    previous.emailDomain === input.emailDomain &&
    previous.setupVersion >= input.setupVersion &&
    previous.completedSteps.length === completedSteps.length &&
    previous.completedSteps.every((id, i) => id === completedSteps[i]);
  if (same && !changed) return previous;
  const record: AccountSetupRecord = {
    setupVersion: Math.max(input.setupVersion, previous?.emailDomain === input.emailDomain ? previous.setupVersion : 0),
    frameworkVersion: input.frameworkVersion,
    appliedAt: input.now().toISOString(),
    emailDomain: input.emailDomain,
    completedSteps,
  };
  const r = await api("PUT", objectPath(accountId), { ...(stored ?? {}), ...record });
  // A 2xx is the end state; the body of the object endpoint's answer is not relied on.
  if (r.status < 200 || r.status >= 300 || (r.body as { success?: unknown } | null)?.success === false) throw new Error(`writing the ${ACCOUNT_SETTINGS_RESOURCE} failed: ${describeFailure(r)}`);
  return record;
}

/** This framework package's version, from its `package.json` (as `check-login` and `smoke` read it); `unknown` when it cannot be read. */
export function frameworkVersion(): string {
  try {
    const version = (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version?: unknown }).version;
    return typeof version === "string" && version !== "" ? version : "unknown";
  } catch {
    return "unknown";
  }
}
