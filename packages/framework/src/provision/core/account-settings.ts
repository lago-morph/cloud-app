/**
 * The account settings record (provisioning.md §2 "Account settings record"; PROV-REQ-004;
 * MAIL-REQ-003; DEC-0514), target-neutral part: its shape, the email domain's syntax, and the
 * addresses that derive from the domain. Each target keeps the record with its shared resources
 * (Cloudflare: `framework/account.json` in the state home `sst-state`); only `setup-account`
 * writes it, and every reader reads it on each run, so no committed file holds a copy.
 */

/** The account settings record. */
export interface AccountSettings {
  /** The single email domain: the sender and the test mailbox subdomain derive from it (MAIL-REQ-003). */
  readonly emailDomain?: string;
}

/** The sender's local part, fixed by the owner (DEC-0511). */
export const SENDER_LOCAL_PART = "no-reply";

/** The framework's sender address on a cloud: `no-reply@<emailDomain>` (MAIL-REQ-003). */
export const senderAddress = (emailDomain: string): string => `${SENDER_LOCAL_PART}@${emailDomain}`;

/** The test mailbox subdomain the mail sink receives for: `t.<emailDomain>` (MAIL-REQ-005). */
export const testMailDomain = (emailDomain: string): string => `t.${emailDomain}`;

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** Lowercase letter-digit-hyphen labels, at least two; the last one has a letter. */
const DOMAIN = new RegExp(`^(?:${LABEL}\\.)+(?=[a-z0-9-]*[a-z])${LABEL}$`);

/**
 * Why `domain` cannot be the email domain, or undefined when it can. The test mailbox subdomain
 * `t.<domain>` must be a valid name too, so the domain is at most 251 characters.
 */
export function emailDomainProblem(domain: string): string | undefined {
  if (!DOMAIN.test(domain)) {
    return `${JSON.stringify(domain)} is not a domain name (lowercase labels of letters, digits and hyphens separated by dots, such as example.com)`;
  }
  if (testMailDomain(domain).length > 253) return `${JSON.stringify(domain)} is too long: t.<domain> must fit in 253 characters`;
  return undefined;
}
