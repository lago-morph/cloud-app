/**
 * MAIL-AC-007 (docs/components/mail.md §4; Cloud, milestone): "Running `setup-account --target
 * cloudflare` twice changes nothing the second time, and afterwards the domain's sending entry is
 * verified, Email Routing on `t.<emailDomain>` routes `sink@t.<emailDomain>` to
 * `prototype-mailsink` with subaddressing on, the bucket's lifecycle rule is PAR-241, and a
 * message sent to `sink+<run ID>@t.<emailDomain>` is readable with `mail last --target
 * cloudflare`. Removing a stage leaves all of these."
 *
 * Written from MAIL-REQ-005, mail.md §2 "Mail sink", cloudflare.md `setupAccount`, DEC-0514,
 * DEC-0515, DEC-0518 and DEC-0527. The domain comes from the account settings record
 * (MAIL-REQ-003), so no test holds it. The email state is read through the Cloudflare API with
 * the deploy token (DEC-0515 gives it the zone and account email permissions):
 * - the zone's sending subdomains (`GET /zones/{zone}/email/sending/subdomains`);
 * - the zone's Email Routing settings (`GET /zones/{zone}/email/routing`, with
 *   `support_subaddress`, DEC-0527) and rules (`…/email/routing/rules`);
 * - the DNS records of `t.<emailDomain>`;
 * - the sink Worker `prototype-mailsink` and the bucket `prototype-mailsink` with its lifecycle;
 * - the account settings record `framework/account.json` in `sst-state`.
 * "Changes nothing" compares that state before and after the second run, and again after a
 * further stage of the reference app was deployed and removed.
 *
 * The message is a real send: a sign-up on the long-lived production stage `prodcheck` (the only
 * kind of stage that delivers mail, MAIL-REQ-002) to `sink+mail-ac-007-<random>@t.<emailDomain>`.
 * Cloud usage: two `setup-account` runs, one further stage (one D1 database), one real send.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { tag, target } from "../../harness/index.js";
import { requireCloudD1 } from "../_cloud/d1.js";
import { emailState, sinkSubaddress, SINK, zoneOf, type EmailState } from "../_cloud/email.js";
import { emailDomain, recordedOrigin, sinkMail } from "../cli/support/admins.js";
import { withFurtherStage } from "../core/support/stages.js";
import { scratchCopy } from "../core/support/processes.js";
import { isLocal, parameterNumber, REFERENCE_DIR, uniqueValue } from "../core/support/repo.js";
import { runCli, tail } from "../prov/support/stage.js";
import { expectResult, hasLink, httpBrowser, signUp, testDisplayName, testPassword, waitForMail, type Account } from "../pwd/support.js";

/** True for an entry that Cloudflare reports verified (a `status`-like field reading verified, or `verified: true`). */
function reportsVerified(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object") return false;
  return Object.entries(entry as Record<string, unknown>).some(([k, v]) => (/status/i.test(k) && typeof v === "string" && /^verified$/i.test(v)) || (/^verified$/i.test(k) && v === true));
}

function expectSinkSetUp(state: EmailState, domain: string): void {
  // The domain's sending entry, verified.
  const sending = Array.isArray(state.sending.result) ? (state.sending.result as unknown[]) : [];
  const entry = sending.find((e) => JSON.stringify(e).includes(`"${domain}"`));
  expect(entry, `a sending entry for the email domain (status ${String(state.sending.status)})`).toBeDefined();
  expect(reportsVerified(entry), `the sending entry is verified: ${JSON.stringify(entry)}`).toBe(true);

  // Email Routing: subaddressing on, one literal rule sink@t.<domain> → the sink Worker.
  expect(state.routing.status, "the zone's Email Routing settings").toBe(200);
  expect((state.routing.result as { support_subaddress?: unknown } | null)?.support_subaddress, "subaddressing is on (DEC-0527)").toBe(true);
  const address = `sink@t.${domain}`;
  const rule = state.rules.find((r) => {
    const x = r as { enabled?: unknown; matchers?: readonly { type?: unknown; field?: unknown; value?: unknown }[]; actions?: readonly { type?: unknown; value?: unknown }[] };
    const matches = (x.matchers ?? []).some((m) => m.type === "literal" && m.field === "to" && typeof m.value === "string" && m.value.toLowerCase() === address.toLowerCase());
    const toSink = (x.actions ?? []).some((a) => a.type === "worker" && Array.isArray(a.value) && (a.value as unknown[]).includes(SINK));
    return x.enabled !== false && matches && toSink;
  });
  expect(rule, `an enabled literal rule routes the sink address to the Worker ${SINK}`).toBeDefined();
  expect(state.dns.length, `the subdomain t.<emailDomain> has its routing DNS records`).toBeGreaterThan(0);

  // The sink Worker and bucket, with the PAR-241 lifecycle rule.
  expect(state.sinkWorker, `the Worker ${SINK} exists`).toBe(true);
  expect(state.bucket.status, `the bucket ${SINK} exists`).toBe(200);
  const days = parameterNumber("PAR-241");
  const rules = ((state.lifecycle.result as { rules?: unknown[] } | null)?.rules ?? []) as { enabled?: unknown; deleteObjectsTransition?: { condition?: { type?: unknown; maxAge?: unknown } } }[];
  const deleting = rules.filter((r) => r.enabled !== false && r.deleteObjectsTransition?.condition?.type === "Age");
  expect(
    deleting.map((r) => r.deleteObjectsTransition?.condition?.maxAge),
    `the bucket's lifecycle deletes objects after PAR-241 (${String(days)} day): ${JSON.stringify(state.lifecycle.result)}`,
  ).toEqual([days * 86_400]);
  expect((JSON.parse(state.accountRecord) as { emailDomain?: unknown }).emailDomain, "the account settings record keeps the email domain").toBe(domain);
}

if (!isLocal()) {
  describe("MAIL-AC-007 the account's mail sink (cloud, milestone)", () => {
    it(
      tag("MAIL-AC-007", "setup-account twice changes nothing the second time; the sending entry is verified, t.<domain> routes sink@ to prototype-mailsink with subaddressing on, the bucket keeps mail PAR-241; a sink+<run ID>@ message is readable with mail last; removing a stage leaves all of these"),
      async () => {
        const t = target();
        requireCloudD1(t.target);
        const domain = await emailDomain();
        const zone = await zoneOf(domain);
        const copy = await scratchCopy(REFERENCE_DIR, "mail-ac-007");
        try {
          const first = await runCli(["setup-account", "--target", t.target], { cwd: copy.dir, timeoutMs: 15 * 60_000 });
          expect(first.status, `first setup-account:\n${tail(first.output)}`).toBe(0);
          const before = await emailState(zone, domain);
          expectSinkSetUp(before, domain);
          const second = await runCli(["setup-account", "--target", t.target], { cwd: copy.dir, timeoutMs: 15 * 60_000 });
          expect(second.status, `second setup-account:\n${tail(second.output)}`).toBe(0);
          expect(await emailState(zone, domain), "the email state after the second setup-account").toEqual(before);

          // A real message to a sink subaddress: a sign-up on the production stage prodcheck.
          const a: Account = { email: sinkSubaddress(domain, `mail-ac-007-${randomBytes(6).toString("hex")}`), password: testPassword(), displayName: testDisplayName("MAIL 007") };
          const b = { ...httpBrowser({ baseUrl: recordedOrigin(t.target, "prodcheck") }), mail: sinkMail() };
          expectResult(await signUp(b, a), "check-email");
          const delivered = await waitForMail(b.mail, a.email, "verification (through the sink)", { accept: (m) => hasLink(m, "verify"), timeoutMs: 10 * 60_000 });

          // Removing a stage leaves all of it.
          await withFurtherStage(REFERENCE_DIR, "mail-ac-007", { apiKey: uniqueValue("mailAc007") }, async (stage) => {
            const removed = await stage.remove();
            expect(removed.status, `remove ${stage.stage}:\n${tail(removed.output)}`).toBe(0);
          });
          expect(await emailState(zone, domain), "the email state after a stage was removed").toEqual(before);
          const again = await b.mail.latest(a.email);
          expect(again, "the delivered message is still readable with mail last after the removal").toMatchObject({ subject: delivered.subject, text: delivered.text });
        } finally {
          await copy.remove();
        }
      },
      90 * 60_000,
    );
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("MAIL-AC-007 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
