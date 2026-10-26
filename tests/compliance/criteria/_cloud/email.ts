/**
 * The account's email setup on Cloudflare as the cloud tests read it (MAIL-AC-007, PROV-AC-004;
 * mail.md §2 "Mail sink", cloudflare.md `setupAccount`, DEC-0514, DEC-0515, DEC-0527), through the
 * Cloudflare API with the deploy token. Read-only. The email domain comes from the account
 * settings record (MAIL-REQ-003), never from a test.
 */
import { prerequisiteMissing } from "../../harness/index.js";
import { accountId, cfApi, cfList, cfOk } from "./api.js";
import { readObject, STATE_BUCKET } from "./r2.js";
import { accountWorkers } from "./stage-resources.js";

/** The framework-owned sink Worker and bucket (mail.md §2). */
export const SINK = "prototype-mailsink";

/** The sink address with subaddress `tag` (DEC-0527: `sink+<tag>@t.<emailDomain>`). */
export function sinkSubaddress(domain: string, label: string): string {
  return `sink+${label}@t.${domain}`;
}

export async function zoneOf(domain: string): Promise<string> {
  const zones = await cfOk<readonly { readonly id: string; readonly name: string }[]>("looking up the email domain's zone", "GET", `/zones?name=${encodeURIComponent(domain)}`);
  const zone = zones.find((z) => z.name === domain);
  if (zone === undefined) return prerequisiteMissing("the account's email domain has no zone on this account's Cloudflare DNS");
  return zone.id;
}

/** A GET's status and result, for a snapshot (a failed read is part of the state, not a crash). */
async function read(path: string): Promise<{ readonly status: number; readonly result: unknown }> {
  const r = await cfApi("GET", path);
  return { status: r.status, result: r.body?.result ?? null };
}

export interface EmailState {
  readonly sending: { readonly status: number; readonly result: unknown };
  readonly routing: { readonly status: number; readonly result: unknown };
  readonly rules: unknown[];
  readonly dns: unknown[];
  readonly sinkWorker: boolean;
  readonly bucket: { readonly status: number; readonly result: unknown };
  readonly lifecycle: { readonly status: number; readonly result: unknown };
  readonly accountRecord: string;
}

/** The account's email setup for `domain`, compared before and after a run that must change nothing. */
export async function emailState(zone: string, domain: string): Promise<EmailState> {
  const account = accountId();
  return {
    sending: await read(`/zones/${zone}/email/sending/subdomains`),
    routing: await read(`/zones/${zone}/email/routing`),
    rules: await cfList<unknown>("listing Email Routing rules", `/zones/${zone}/email/routing/rules`, 50),
    dns: (await cfList<{ readonly id: string; readonly type: string; readonly name: string; readonly content: string }>("listing the sink subdomain's DNS records", `/zones/${zone}/dns_records?name=${encodeURIComponent(`t.${domain}`)}`, 100))
      .map((d) => ({ id: d.id, type: d.type, name: d.name, content: d.content }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    sinkWorker: (await accountWorkers()).includes(SINK),
    bucket: await read(`/accounts/${account}/r2/buckets/${SINK}`),
    lifecycle: await read(`/accounts/${account}/r2/buckets/${SINK}/lifecycle`),
    accountRecord: await readObject(STATE_BUCKET, "framework/account.json"),
  };
}
