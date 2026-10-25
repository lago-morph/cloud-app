/**
 * The delivery status of a message sent with Cloudflare Email Sending, for `check-login`'s
 * failure message when a mail does not reach the sink within its bound (decision note i-g.md).
 *
 * Live, 2026-10-25: the send API answers `queued` even for a message the receiving side later
 * rejects (`550 5.1.1 Address does not exist`, `errorCause=routing_unknown_address`, when the
 * sink rule had not spread yet). The final status is in the GraphQL Analytics dataset
 * `emailSendingAdaptive` of the sending domain's zone, filtered by `to` with `isLastEvent: 1`
 * (`status`, `errorCause`, `errorDetail`). `emailRoutingAdaptive` is empty for mail rejected at
 * RCPT, so it is not read. Both datasets lag by over a minute, so "no event yet" is reported as
 * such, never as a delivery. Reads only (`POST /graphql` is a query).
 */
import { describeFailure, resultOf, type CloudflareApi } from "./api.js";
import { zoneCandidates } from "./email.js";

export interface DeliveryEvent {
  readonly datetime?: string;
  readonly status?: string;
  readonly errorCause?: string;
  readonly errorDetail?: string;
}

export const DELIVERY_QUERY = `query EmailDelivery($zoneTag: string, $to: string, $since: Time) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      emailSendingAdaptive(limit: 1, filter: { to: $to, isLastEvent: 1, datetime_geq: $since }, orderBy: [datetime_DESC]) {
        datetime
        status
        errorCause
        errorDetail
      }
    }
  }
}`;

/** The zone ID of the email domain (the sender's zone), or undefined. */
async function zoneId(api: CloudflareApi, accountId: string, emailDomain: string): Promise<string | undefined> {
  for (const name of zoneCandidates(emailDomain)) {
    const list = resultOf<{ id: string; name: string }[]>(await api("GET", `/zones?name=${encodeURIComponent(name)}&account.id=${accountId}`), `looking up the Cloudflare zone of ${emailDomain}`);
    const zone = list.find((z) => z.name === name);
    if (zone) return zone.id;
  }
  return undefined;
}

/** The last Email Sending event for messages to `to` since `since`, or undefined when none is recorded (yet). */
export async function lastDeliveryEvent(api: CloudflareApi, accountId: string, emailDomain: string, to: string, since: Date): Promise<DeliveryEvent | undefined> {
  const zoneTag = await zoneId(api, accountId, emailDomain);
  if (zoneTag === undefined) throw new Error(`the email domain's zone is not on this account`);
  const r = await api("POST", "/graphql", { query: DELIVERY_QUERY, variables: { zoneTag, to: to.trim().toLowerCase(), since: since.toISOString() } });
  const body = r.body as { data?: { viewer?: { zones?: { emailSendingAdaptive?: DeliveryEvent[] }[] } } | null; errors?: { message?: string }[] | null } | null;
  const errors = body?.errors ?? [];
  if (r.status < 200 || r.status >= 300 || errors.length > 0) {
    throw new Error(`the Email Sending analytics query failed: ${errors.length > 0 ? errors.map((e) => e.message ?? "unknown error").join("; ") : describeFailure(r)}`);
  }
  return body?.data?.viewer?.zones?.[0]?.emailSendingAdaptive?.[0];
}

/** One sentence for a failure message. */
export function describeDelivery(event: DeliveryEvent | undefined): string {
  if (event === undefined) return "Email Sending has recorded no delivery event for the recipient yet (emailSendingAdaptive lags by over a minute)";
  const parts = [`status ${event.status ?? "unknown"}`];
  if (event.errorCause !== undefined && event.errorCause !== null && event.errorCause !== "") parts.push(`errorCause ${event.errorCause}`);
  if (event.errorDetail !== undefined && event.errorDetail !== null && event.errorDetail !== "") parts.push(`errorDetail ${JSON.stringify(event.errorDetail)}`);
  return `Email Sending's last event for the recipient (emailSendingAdaptive${event.datetime === undefined ? "" : `, ${event.datetime}`}): ${parts.join(", ")}`;
}
