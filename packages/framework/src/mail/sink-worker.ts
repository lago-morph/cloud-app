/**
 * The account-level mail sink Worker `prototype-mailsink` (mail.md §2 "Mail sink"; MAIL-REQ-005;
 * DEC-0518). Email Routing hands it every message to the sink address under `t.<emailDomain>`;
 * it writes the raw message to its R2 bucket under `<recipient>/<timestamp>-<id>.eml` and does
 * nothing else. The bucket's lifecycle rule deletes each object after PAR-241.
 *
 * The Worker is uploaded by `setup-account` exactly as `MAIL_SINK_SOURCE` reads (one ES module,
 * no build step), so the unit test evaluates this same text. `<recipient>` is the envelope
 * recipient, lowercased: with subaddressing on, `sink+<tag>@t.<domain>` keeps its tag, so each
 * `check-login` run reads only its own mail. The timestamp is fixed-width UTC
 * (`YYYYMMDDTHHMMSSmmmZ`), so the newest key of a recipient sorts last.
 */

/** The sink Worker's R2 binding name. */
export const MAIL_SINK_BINDING = "MAILSINK";

/** The sink Worker's compatibility date (the framework's stage Workers use the same, build.ts). */
export const MAIL_SINK_COMPATIBILITY_DATE = "2026-10-01";

/** The module's file name in the upload. */
export const MAIL_SINK_MODULE = "mailsink.js";

/** The key prefix under which the sink stores mail to `recipient` (lowercased, then `/`). */
export const sinkPrefix = (recipient: string): string => `${recipient.trim().toLowerCase()}/`;

/** The sink Worker's whole source (an ES module with only an `email` handler). */
export const MAIL_SINK_SOURCE = `// prototype-mailsink: stores each routed message's raw MIME in R2 (framework-owned; MAIL §2).
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(".", "");
export default {
  async email(message, env) {
    const recipient = String(message.to).trim().toLowerCase();
    const raw = await new Response(message.raw).arrayBuffer();
    const key = recipient + "/" + stamp(new Date()) + "-" + crypto.randomUUID() + ".eml";
    await env.${MAIL_SINK_BINDING}.put(key, raw, { httpMetadata: { contentType: "message/rfc822" } });
  },
};
`;
