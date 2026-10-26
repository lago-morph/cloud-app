/**
 * The mail-sink reader (mail.md §2 "Reading mail"; MAIL-REQ-005; cli.md `mail last --target
 * cloudflare`, `check-login`): the latest message the sink Worker stored for one address, read
 * from the R2 bucket `prototype-mailsink` through the R2 REST API and parsed into a `MailMessage`.
 *
 * - The address must be under `t.<emailDomain>`, the domain read from the account settings record
 *   on every run (DEC-0514).
 * - Keys are `<recipient>/<YYYYMMDDTHHMMSSmmmZ>-<uuid>.eml` (`src/mail/sink-worker.ts`), listed with
 *   `GET …/objects?prefix=<recipient>/`; the greatest key is the newest.
 * - The object's bytes come back as text (the API seam keeps a non-JSON body as text).
 * Messages never contain the token or the account ID.
 */
import { sinkMailMessage } from "../../mail/mime.js";
import { sinkPrefix } from "../../mail/sink-worker.js";
import type { MailMessage } from "../../mail/sender.js";
import { testMailDomain } from "../core/account-settings.js";
import { readAccountSettings } from "./account-settings.js";
import { describeFailure, resultOf, type CloudflareApi } from "./api.js";
import { MAIL_SINK_NAME } from "./names.js";

const objectsPath = (accountId: string) => `/accounts/${accountId}/r2/buckets/${MAIL_SINK_NAME}/objects`;

/** Every key the sink holds for `address`, sorted. */
export async function sinkKeys(api: CloudflareApi, accountId: string, address: string): Promise<string[]> {
  const prefix = sinkPrefix(address);
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const r = await api("GET", `${objectsPath(accountId)}?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`);
    if (r.status === 404) throw new Error(`the mail sink's R2 bucket ${MAIL_SINK_NAME} does not exist; run setup-account --target cloudflare`);
    for (const o of resultOf<{ key: string }[]>(r, `listing the mail sink's R2 bucket ${MAIL_SINK_NAME}`)) {
      if (o.key.startsWith(prefix)) keys.push(o.key);
    }
    const info = (r.body as { result_info?: { cursor?: unknown; is_truncated?: unknown } }).result_info;
    cursor = info?.is_truncated === true && typeof info.cursor === "string" && info.cursor !== "" ? info.cursor : undefined;
    if (cursor === undefined) return keys.sort();
  }
  throw new Error(`listing the mail sink's R2 bucket ${MAIL_SINK_NAME}: more than 50 pages`);
}

/** The ISO time in a sink key (`…/20261025T100001123Z-<id>.eml`), or the epoch when it has none. */
export function keyTime(key: string): string {
  const m = /\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-[^/]*$/.exec(key);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z` : new Date(0).toISOString();
}

/** The latest message the sink stored for `address`, or undefined. Does not check the domain. */
export async function latestSinkMail(api: CloudflareApi, accountId: string, address: string): Promise<MailMessage | undefined> {
  const keys = await sinkKeys(api, accountId, address);
  const key = keys[keys.length - 1];
  if (key === undefined) return undefined;
  const r = await api("GET", `${objectsPath(accountId)}/${encodeURIComponent(key)}`);
  if (r.status === 404) return undefined; // expired between the listing and the read
  if (r.status < 200 || r.status >= 300) throw new Error(`reading a message from the mail sink failed: ${describeFailure(r)}`);
  const raw = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
  return sinkMailMessage(raw, address.trim().toLowerCase(), keyTime(key));
}

/** `mail last --to <address> --target cloudflare`: refuses an address outside `t.<emailDomain>`. */
export async function readSinkMail(api: CloudflareApi, accountId: string, address: string): Promise<MailMessage | undefined> {
  const { emailDomain } = await readAccountSettings(api, accountId);
  if (emailDomain === undefined) throw new Error("the account settings record names no email domain; run setup-account --target cloudflare --email-domain <domain>");
  const normalized = address.trim().toLowerCase();
  if (!normalized.endsWith(`@${testMailDomain(emailDomain)}`)) throw new Error(`the mail sink receives only addresses under the test mailbox subdomain t.<emailDomain>; this address is not one`);
  return latestSinkMail(api, accountId, normalized);
}
