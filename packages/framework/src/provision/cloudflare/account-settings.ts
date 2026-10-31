/**
 * The Cloudflare account settings record (provisioning.md §2 "Account settings record";
 * cloudflare.md "Deploy mechanics" `setupAccount`; DEC-0514): the JSON object
 * `framework/account.json` in the state home bucket `sst-state`, `{ "emailDomain": "<domain>" }`.
 * SST's own objects use other top-level prefixes (`app/`, `secret/`, `lock/`, …), so the stage
 * state checks (`isStageStateObject`) never match it. Since v0.2.0 nothing records an email domain
 * (DEC-0689): one a 0.1.x `setup-account` wrote is kept, and `deploy` no longer reads it, since no
 * stage binds `EMAIL` (DEC-0698, DEC-0732).
 *
 * Objects are read and written through the R2 object endpoints of `api.cloudflare.com`
 * (`GET`/`PUT …/r2/buckets/<bucket>/objects/<key>`): a GET answers the object's own bytes,
 * which the API seam parses as JSON. Not yet exercised against the live API (DEC-0334): the
 * first live write of the record confirms the PUT's answer.
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
    throw new Error(`the ${ACCOUNT_SETTINGS_RESOURCE} is not a JSON object; run account setup in the admin app again to rewrite it`);
  }
  const { emailDomain } = body as { emailDomain?: unknown };
  if (emailDomain === undefined) return {};
  const problem = typeof emailDomain === "string" ? emailDomainProblem(emailDomain) : "it is not a string";
  if (problem !== undefined) {
    throw new Error(`the ${ACCOUNT_SETTINGS_RESOURCE} has an invalid emailDomain (${problem}); correct or remove that field in the Cloudflare dashboard (R2, bucket ${STATE_BUCKET})`);
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
