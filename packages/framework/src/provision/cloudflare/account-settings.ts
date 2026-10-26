/**
 * The Cloudflare account settings record (provisioning.md §2 "Account settings record";
 * cloudflare.md "Deploy mechanics" `setupAccount`; DEC-0514): the JSON object
 * `framework/account.json` in the state home bucket `sst-state`, `{ "emailDomain": "<domain>" }`.
 * SST's own objects use other top-level prefixes (`app/`, `secret/`, `lock/`, …), so the stage
 * state checks (`isStageStateObject`) never match it. Written only by `setup-account`; `deploy`,
 * `check-login` and `mail --target cloudflare` read it on every run.
 *
 * Objects are read and written through the R2 object endpoints of `api.cloudflare.com`
 * (`GET`/`PUT …/r2/buckets/<bucket>/objects/<key>`): a GET answers the object's own bytes,
 * which the API seam parses as JSON. Not yet exercised against the live API (DEC-0334): the
 * first live `setup-account --email-domain` confirms the PUT's answer.
 */
import { emailDomainProblem, type AccountSettings } from "../core/account-settings.js";
import { describeFailure, type CloudflareApi } from "./api.js";
import { STATE_BUCKET } from "./names.js";

/** The record's object key in the state home. */
export const ACCOUNT_SETTINGS_KEY = "framework/account.json";
/** The record as printed to the owner. */
export const ACCOUNT_SETTINGS_RESOURCE = `account settings record ${ACCOUNT_SETTINGS_KEY} in R2 bucket ${STATE_BUCKET}`;

const objectPath = (accountId: string) => `/accounts/${accountId}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(ACCOUNT_SETTINGS_KEY)}`;

/** Validates a stored record. Throws naming the record when it is not one. */
export function parseAccountSettings(body: unknown): AccountSettings {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`the ${ACCOUNT_SETTINGS_RESOURCE} is not a JSON object; run setup-account --target cloudflare --email-domain <domain> to rewrite it`);
  }
  const { emailDomain } = body as { emailDomain?: unknown };
  if (emailDomain === undefined) return {};
  const problem = typeof emailDomain === "string" ? emailDomainProblem(emailDomain) : "it is not a string";
  if (problem !== undefined) {
    throw new Error(`the ${ACCOUNT_SETTINGS_RESOURCE} has an invalid emailDomain (${problem}); run setup-account --target cloudflare --email-domain <domain> to rewrite it`);
  }
  return { emailDomain: emailDomain as string };
}

/** The record; `{}` when it (or the state home) does not exist. Reads only. */
export async function readAccountSettings(api: CloudflareApi, accountId: string): Promise<AccountSettings> {
  const r = await api("GET", objectPath(accountId));
  if (r.status === 404) return {};
  if (r.status < 200 || r.status >= 300) throw new Error(`reading the ${ACCOUNT_SETTINGS_RESOURCE} failed: ${describeFailure(r)}`);
  return parseAccountSettings(r.body);
}

/** Writes the record (the whole object). Only `setup-account` calls it. */
export async function writeAccountSettings(api: CloudflareApi, accountId: string, settings: AccountSettings): Promise<void> {
  const record: AccountSettings = settings.emailDomain === undefined ? {} : { emailDomain: settings.emailDomain };
  const r = await api("PUT", objectPath(accountId), record);
  // A 2xx is the end state; the body of the object endpoint's answer is not relied on.
  if (r.status < 200 || r.status >= 300 || (r.body as { success?: unknown } | null)?.success === false) throw new Error(`writing the ${ACCOUNT_SETTINGS_RESOURCE} failed: ${describeFailure(r)}`);
}
