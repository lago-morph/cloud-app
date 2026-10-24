/**
 * PROV-AC-002's restricted-credential clause: the operator-supplied Cloudflare API token that
 * lacks the permission to create R2 API tokens.
 */
import { prerequisiteMissing } from "../../../harness/index.js";

export const RESTRICTED_TOKEN_ENV = "COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION";

/**
 * The restricted token from `env`; a missing prerequisite (`blocked`) when none is supplied.
 * HTTPS_PROXY does not matter: the sandbox proxy no longer replaces the Authorization header to
 * api.cloudflare.com (DEC-0420; it did under DEC-0083/DEC-0335/DEC-0363), so the token is
 * presented as given.
 */
export function restrictedToken(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const token = env[RESTRICTED_TOKEN_ENV];
  if (token === undefined || token === "") {
    prerequisiteMissing(`needs a Cloudflare API token without the permission to create R2 API tokens in ${RESTRICTED_TOKEN_ENV}`);
  }
  return token;
}
