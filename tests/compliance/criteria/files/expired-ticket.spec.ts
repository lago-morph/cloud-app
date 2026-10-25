/**
 * FILES-AC-003, expired-ticket clause, in a real browser on the run's target: "An expired upload
 * ticket fails with `FILES.TRANSFER_FAILED`, status null, and a `rejected before sending: ticket
 * expired` message, without contacting storage, and the stored file is unchanged."
 * (docs/components/files.md FILES-REQ-003, FILES-REQ-006; client.d.ts `uploadFile`; DEC-0534,
 * DEC-0536). The same on every target: `uploadFile` checks the ticket's expiry time against the
 * browser's clock before sending.
 *
 * Two tests:
 * - a ticket that really expired: the app issues tickets that last PAR-233 (15 minutes) and offers
 *   no shorter lifetime, so the test waits for it. Before the wait, the same ticket is used once
 *   successfully (control). It is in a file of its own so the wait overlaps the other specs;
 * - a ticket whose expiry time the browser's clock has just reached (`Date.now() >= expiresAt`,
 *   DEC-0534), with the page's clock set to the ticket's `expiresAt`; storage would still accept it.
 *
 * "Without contacting storage" is checked by recording every request the page makes to the
 * ticket's URL: there must be none, so no storage status and no storage body exist.
 */
import type { Page } from "@playwright/test";
import { tag } from "../../harness/index.js";
import { expect, test } from "../../harness/playwright.js";
import { openAppPage, ticketClient, uploadInPage, uploadTicket, type TransferOutcome, type UploadTicketJson } from "./browser.js";
import { head, removeAll, uniquePrefix } from "./support.js";

/** PAR-233, the ticket lifetime. */
const TICKET_LIFETIME_MS = 15 * 60_000;
/** After `expiresAt`, allowance for clock difference between the test and the browser. */
const AFTER_EXPIRY_MS = 30_000;

/** Records every request the page sends to the ticket's URL (path and query compared). */
function recordTicketRequests(page: Page, ticket: UploadTicketJson): string[] {
  const target = new URL(ticket.url, page.url());
  const sent: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin === target.origin && u.pathname === target.pathname) sent.push(`${r.method()} ${r.url()}`);
  });
  return sent;
}

function expectRejectedBeforeSending(out: TransferOutcome, sent: readonly string[]): void {
  expect(out).toMatchObject({ ok: false, isApiError: true, code: "FILES.TRANSFER_FAILED", status: null, requestId: null });
  expect(out.message).toContain("rejected before sending: ticket expired");
  expect(out.maxLoaded).toBe(0);
  expect(sent, "uploadFile contacted storage with an expired ticket").toStrictEqual([]);
}

test(tag("FILES-AC-003", "expired-ticket clause: a ticket past PAR-233 fails with FILES.TRANSFER_FAILED, status null and rejected before sending: ticket expired, without contacting storage; the stored file is unchanged"), async ({ page }) => {
  test.setTimeout(TICKET_LIFETIME_MS + 5 * 60_000);
  const u = await ticketClient("c-t3-files-expiry");
  const prefix = uniquePrefix("ac003-expired");
  const name = `${prefix}late.bin`;
  try {
    await openAppPage(page);
    const ticket = await uploadTicket(u, name, "application/octet-stream");
    const issuedAt = Date.now();
    expect(ticket.expiresAt - issuedAt, "ticket lifetime is bounded by PAR-233").toBeLessThanOrEqual(TICKET_LIFETIME_MS + 60_000);

    // Control: valid until it expires (and reusable).
    expect(await uploadInPage(page, ticket, { size: 32, seed: 11, type: "application/octet-stream" })).toMatchObject({ ok: true });
    expect(await head(u, name)).toStrictEqual({ name, size: 32, contentType: "application/octet-stream" });

    await page.waitForTimeout(Math.max(0, ticket.expiresAt - Date.now()) + AFTER_EXPIRY_MS);
    await page.reload();
    await openAppPage(page);

    const sent = recordTicketRequests(page, ticket);
    const out = await uploadInPage(page, ticket, { size: 48, seed: 12, type: "application/octet-stream" });
    expectRejectedBeforeSending(out, sent);
    // Nothing was written by the expired ticket: the file is still the control upload.
    expect(await head(u, name)).toStrictEqual({ name, size: 32, contentType: "application/octet-stream" });
  } finally {
    await removeAll(u, prefix);
  }
});

test(tag("FILES-AC-003", "expired-ticket clause: once the browser's clock reaches the ticket's expiry time, uploadFile fails with status null and rejected before sending: ticket expired, without contacting storage"), async ({ page }) => {
  const u = await ticketClient("c-t3-files-expiry-clock");
  const prefix = uniquePrefix("ac003-expired-clock");
  const name = `${prefix}late.bin`;
  try {
    await openAppPage(page);
    const ticket = await uploadTicket(u, name, "application/octet-stream");
    // Control: the ticket works while the browser's clock is before its expiry time.
    expect(await uploadInPage(page, ticket, { size: 24, seed: 13, type: "application/octet-stream" })).toMatchObject({ ok: true });
    expect(await head(u, name)).toStrictEqual({ name, size: 24, contentType: "application/octet-stream" });

    // The browser's clock decides (DEC-0534): set it to the ticket's expiry time.
    await page.clock.setSystemTime(ticket.expiresAt);
    expect(await page.evaluate(() => Date.now())).toBeGreaterThanOrEqual(ticket.expiresAt);

    const sent = recordTicketRequests(page, ticket);
    const out = await uploadInPage(page, ticket, { size: 40, seed: 14, type: "application/octet-stream" });
    expectRejectedBeforeSending(out, sent);
    expect(await head(u, name)).toStrictEqual({ name, size: 24, contentType: "application/octet-stream" });
  } finally {
    await removeAll(u, prefix);
  }
});
