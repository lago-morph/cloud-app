/**
 * The optional cleanup of v0.1.x's email resources (v0.2.0 plan §8: "The admin app offers cleanup
 * … It's optional, and never automatic"; DEC-0718). The page says what v0.1.x left. Nothing is
 * deleted until the person presses the button and approves at Cloudflare.
 *
 * With the person's grant (PAR-447 `cleanup`: `workers-scripts.write`, `workers-r2.write`) it
 * deletes the mail-sink Worker `prototype-mailsink`, then empties and deletes its R2 bucket of the
 * same name. What is already gone counts as done, so a second run is harmless.
 *
 * The email parts sit on the domain's zone: the routing rule `sink@t.<domain>`, Email Routing on
 * `t.<domain>`, and the Email Sending entry. The admin client has no email or zone scope (C's
 * `ADMIN_OPTIONAL_SCOPES`), so the page gives the dashboard steps for these, naming the domain from
 * the account settings record when it is there.
 */
import { ACCOUNT_SETTINGS_KEY } from "../provision/cloudflare/account-settings.js";
import { describeFailure, succeeded, type CloudflareApi } from "../provision/cloudflare/api.js";
import { MAIL_SINK_NAME, STATE_BUCKET } from "../provision/cloudflare/names.js";
import type { AdminPage, GrantContext } from "./app.js";
import { esc } from "./html.js";

/** PAR-449: at most this many 1000-key pages of the mail sink's bucket are emptied in one run. */
export const CLEANUP_MAX_PAGES = 10;

const gone = (status: number): boolean => status === 404;

async function deleteWorker(api: CloudflareApi, a: string): Promise<string> {
  const r = await api("DELETE", `/accounts/${a}/workers/scripts/${MAIL_SINK_NAME}`);
  if (gone(r.status)) return `The Worker <code>${MAIL_SINK_NAME}</code> was already gone.`;
  if (!succeeded(r)) throw new Error(`deleting the Worker ${MAIL_SINK_NAME} failed: ${describeFailure(r)}`);
  return `Deleted the Worker <code>${MAIL_SINK_NAME}</code>.`;
}

async function deleteBucket(api: CloudflareApi, a: string): Promise<string> {
  const base = `/accounts/${a}/r2/buckets/${MAIL_SINK_NAME}`;
  let removed = 0;
  for (let page = 0; page < CLEANUP_MAX_PAGES; page++) {
    const r = await api("GET", `${base}/objects?per_page=1000`);
    if (gone(r.status)) return removed === 0 ? `The R2 bucket <code>${MAIL_SINK_NAME}</code> was already gone.` : `Deleted the R2 bucket <code>${MAIL_SINK_NAME}</code>.`;
    const list = (r.body as { result?: { key?: unknown }[] } | null)?.result;
    if (!succeeded(r) || !Array.isArray(list)) throw new Error(`listing the R2 bucket ${MAIL_SINK_NAME} failed: ${describeFailure(r)}`);
    if (list.length === 0) break;
    for (const o of list) {
      if (typeof o.key !== "string") continue;
      const d = await api("DELETE", `${base}/objects/${encodeURIComponent(o.key)}`);
      if (!succeeded(d) && !gone(d.status)) throw new Error(`emptying the R2 bucket ${MAIL_SINK_NAME} failed: ${describeFailure(d)}`);
      removed++;
    }
    if (page === CLEANUP_MAX_PAGES - 1) return `Deleted ${String(removed)} stored test messages; more remain in <code>${MAIL_SINK_NAME}</code>. Run the cleanup again to finish.`;
  }
  const d = await api("DELETE", base);
  if (gone(d.status)) return `The R2 bucket <code>${MAIL_SINK_NAME}</code> was already gone.`;
  if (!succeeded(d)) throw new Error(`deleting the R2 bucket ${MAIL_SINK_NAME} failed: ${describeFailure(d)}`);
  return `Deleted the R2 bucket <code>${MAIL_SINK_NAME}</code> and its ${String(removed)} stored test messages.`;
}

/** The v0.1.x email domain from the account settings record, if any. */
async function emailDomain(api: CloudflareApi, a: string): Promise<string | undefined> {
  const r = await api("GET", `/accounts/${a}/r2/buckets/${STATE_BUCKET}/objects/${encodeURIComponent(ACCOUNT_SETTINGS_KEY)}`);
  const d = r.status >= 200 && r.status < 300 ? (r.body as { emailDomain?: unknown } | null)?.emailDomain : undefined;
  return typeof d === "string" && /^[a-z0-9.-]{1,253}$/i.test(d) ? d : undefined;
}

function dashboardSteps(domain: string | undefined): string {
  const zone = domain === undefined ? "your email domain" : `<code>${esc(domain)}</code>`;
  const sub = domain === undefined ? "the <code>t.</code> subdomain" : `<code>t.${esc(domain)}</code>`;
  return [
    "<p>These are on the domain's zone. The admin app has no permission there, so do them in the Cloudflare dashboard if you want them gone:</p>",
    "<ul>",
    `<li>Email → Email Routing on ${zone}: delete the routing rule <code>sink@</code>${sub}, then turn off routing on ${sub} (this removes its MX and SPF records).</li>`,
    `<li>Email → Email Sending: delete the entry for ${zone}.</li>`,
    "</ul>",
  ].join("\n");
}

async function run(ctx: GrantContext): Promise<string> {
  const domain = await emailDomain(ctx.api, ctx.accountId);
  const worker = await deleteWorker(ctx.api, ctx.accountId);
  const bucket = await deleteBucket(ctx.api, ctx.accountId);
  return `<p>${worker}</p><p>${bucket}</p>${dashboardSteps(domain)}`;
}

export const cleanupPage: AdminPage = {
  id: "cleanup",
  title: "Clean up v0.1.x email",
  view: () =>
    [
      "<p>v0.2.0 signs people in through Cloudflare and sends no email. If this account was set up by v0.1.x, it still has the email pieces that version made. Removing them is optional; nothing is removed unless you continue.</p>",
      `<p>Continuing deletes the mail-sink Worker <code>${MAIL_SINK_NAME}</code> and its R2 bucket <code>${MAIL_SINK_NAME}</code> with the test messages in it. Nothing else is touched. The page then lists the email settings on your domain to remove in the dashboard.</p>`,
    ].join("\n"),
  run,
};
