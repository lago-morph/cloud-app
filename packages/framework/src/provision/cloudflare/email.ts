/**
 * The Cloudflare email setup behind `setup-account` and a production stage's deploy preflight
 * (PROV-REQ-002, PROV-REQ-004 amendment; MAIL-REQ-005; cloudflare.md "Deploy mechanics"
 * `setupAccount`; DEC-0514, DEC-0515). This module is the seam; the Cloudflare API calls are
 * implementation item I-F (plan-auth.md §6):
 * - `setUp`: check the token's email permissions (DEC-0515) and name each missing one; onboard
 *   the domain for Email Sending (`GET` then, only if absent, `POST
 *   /zones/{zone}/email/sending/subdomains`) and poll its verification; enable Email Routing on
 *   `t.<domain>` with a catch-all rule to the sink Worker `prototype-mailsink`; deploy that
 *   Worker; create the R2 bucket `prototype-mailsink` with its lifecycle rule (PAR-241). Each part
 *   lists first and creates only what is absent.
 * - `productionPrerequisites`: for deploy step 1 of a production stage, the domain's Email
 *   Sending entry is verified and the token carries the email permissions; reads only.
 *
 * Until I-F lands, `pendingEmailSetup` stands in: it calls nothing and reports nothing missing,
 * so `setup-account` records the domain only (the owner's domain was onboarded for Email Sending
 * on 2026-10-25 outside the framework, DEC-0514) and the preflight checks only that the record
 * names a domain.
 */
export interface CloudflareEmailSetup {
  /** `setup-account`: makes the domain's email setup exist; idempotent. Returns the names of what it created. */
  setUp(emailDomain: string): Promise<readonly string[]>;
  /** Deploy step 1, production stages: the missing email prerequisites by name. Changes nothing. */
  productionPrerequisites(emailDomain: string): Promise<readonly string[]>;
}

/** The stand-in until I-F: no Cloudflare call, nothing created, nothing reported missing. */
export const pendingEmailSetup: CloudflareEmailSetup = Object.freeze({
  setUp: async () => [],
  productionPrerequisites: async () => [],
});
