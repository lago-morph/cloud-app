/**
 * PROV-AC-002's restricted-credential clause (DEC-0550, DEC-0551): DEC-0551's everyday token,
 * which has no "Account API Tokens" permission at all (account Workers Scripts Write, Workers R2
 * Storage Write, D1 Write and Email Sending Read; zone Zone Read and Analytics Read). Deploy needs
 * no permission on API tokens, so a deploy with it must succeed. The compliance driver creates one
 * for the run when it selects PROV-AC-002 and the operator did not supply one
 * (`harness/test-tokens.ts`, DEC-0531), and deletes it at the end of the run.
 */
import { prerequisiteMissing } from "../../../harness/index.js";
import { EVERYDAY_TOKEN_ENV } from "../../../harness/test-tokens.js";

export const RESTRICTED_TOKEN_ENV = EVERYDAY_TOKEN_ENV;

/**
 * The everyday token from `env`; a missing prerequisite (`blocked`) when none is there (a run
 * outside the driver, or one whose token creation was skipped).
 * HTTPS_PROXY does not matter: the sandbox proxy no longer replaces the Authorization header to
 * api.cloudflare.com (DEC-0420; it did under DEC-0083/DEC-0335/DEC-0363), so the token is
 * presented as given.
 */
export function restrictedToken(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const token = env[RESTRICTED_TOKEN_ENV];
  if (token === undefined || token === "") {
    prerequisiteMissing(`needs DEC-0551's everyday Cloudflare API token (no Account API Tokens permission) in ${RESTRICTED_TOKEN_ENV} (the compliance driver creates one for a cloud run that selects PROV-AC-002)`);
  }
  return token;
}
