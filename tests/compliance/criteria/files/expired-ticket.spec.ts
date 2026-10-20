/**
 * FILES-AC-003, expired-ticket clause, in a real browser on the run's target: "An expired
 * ticket fails with `FILES.TRANSFER_FAILED`, storage's status, and a `rejected by storage
 * (HTTP n)` message without storage's error body." (docs/components/files.md FILES-REQ-003,
 * FILES-REQ-006). Asserted as written on every target. On Cloudflare this clause is expected to
 * fail (R2 sends no CORS headers on its 403, so the browser cannot read storage's status):
 * DEC-0101, an open owner item; the test is not weakened for it.
 *
 * The ticket really expires: the app issues tickets that last PAR-233 (15 minutes) and offers no
 * shorter lifetime, so the test waits for it. It is in a file of its own so the wait overlaps
 * the other specs. Before the wait, the same ticket is used once successfully (control).
 */
import { tag } from "../../harness/index.js";
import { expect, test } from "../../harness/playwright.js";
import { openAppPage, ticketClient, uploadInPage, uploadTicket } from "./browser.js";
import { head, removeAll, uniquePrefix } from "./support.js";

/** PAR-233, the ticket lifetime. */
const TICKET_LIFETIME_MS = 15 * 60_000;
/** After `expiresAt`, allowance for clock difference between the test and storage. */
const AFTER_EXPIRY_MS = 30_000;

test(tag("FILES-AC-003", "expired-ticket clause: an expired ticket fails with FILES.TRANSFER_FAILED, storage's status and a rejected by storage (HTTP n) message without storage's error body"), async ({ page }) => {
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

    const ticketPath = new URL(ticket.url, page.url()).pathname;
    const bodies: Promise<string>[] = [];
    page.on("response", (r) => {
      if (new URL(r.url()).pathname === ticketPath) bodies.push(r.text().catch(() => ""));
    });
    const out = await uploadInPage(page, ticket, { size: 48, seed: 12, type: "application/octet-stream" });
    const storageBodies = (await Promise.all(bodies)).map((b) => b.trim()).filter((b) => b !== "");

    expect(out).toMatchObject({ ok: false, isApiError: true, code: "FILES.TRANSFER_FAILED" });
    expect(typeof out.status, `status is storage's HTTP status, got ${String(out.status)}`).toBe("number");
    expect(out.status).toBeGreaterThanOrEqual(400);
    expect(out.message).toContain(`rejected by storage (HTTP ${String(out.status)})`);
    for (const body of storageBodies) expect(out.message ?? "").not.toContain(body);
    expect(out.message ?? "").not.toMatch(/<\?xml|<Error>|ExpiredRequest|AccessDenied|SignatureDoesNotMatch/);
    // Nothing was written by the expired ticket: the file is still the control upload.
    expect(await head(u, name)).toStrictEqual({ name, size: 32, contentType: "application/octet-stream" });
  } finally {
    await removeAll(u, prefix);
  }
});
