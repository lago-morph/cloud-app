/**
 * PROV-AC-002's restricted-credential clause: a Cloudflare API token that lacks the permission
 * to create R2 API tokens. The compliance driver creates one for the run when it selects
 * PROV-AC-002 and the operator did not supply one (`harness/test-tokens.ts`, DEC-0531), and
 * deletes it at the end of the run.
 */
import { prerequisiteMissing } from "../../../harness/index.js";
import { NO_R2_TOKEN_PERMISSION_ENV } from "../../../harness/test-tokens.js";

export const RESTRICTED_TOKEN_ENV = NO_R2_TOKEN_PERMISSION_ENV;

/**
 * The restricted token from `env`; a missing prerequisite (`blocked`) when none is there (a run
 * outside the driver, or one whose token creation was skipped).
 * HTTPS_PROXY does not matter: the sandbox proxy no longer replaces the Authorization header to
 * api.cloudflare.com (DEC-0420; it did under DEC-0083/DEC-0335/DEC-0363), so the token is
 * presented as given.
 */
export function restrictedToken(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const token = env[RESTRICTED_TOKEN_ENV];
  if (token === undefined || token === "") {
    prerequisiteMissing(`needs a Cloudflare API token without the permission to create R2 API tokens in ${RESTRICTED_TOKEN_ENV} (the compliance driver creates one for a cloud run that selects PROV-AC-002)`);
  }
  return token;
}
