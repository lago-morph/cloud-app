/**
 * The Cloudflare API token's email permissions (DEC-0515; PROV-REQ-002 step 1, PROV-REQ-004
 * amendment, PROV-AC-004): `setup-account` names each
 * one the token lacks, before anything changes.
 *
 * How (read only): `GET /accounts/<a>/tokens/verify` gives the token's own ID, and
 * `GET /accounts/<a>/tokens/<id>` its policies (the setup token has "Account API Tokens Write",
 * which grants the read; DEC-0551). Each policy names permission groups and resources:
 * - account scope: `com.cloudflare.api.account.<account>` (or `…account.*`) with the value `"*"`
 *   (the key holding zones grants only on those zones);
 * - zone scope: `com.cloudflare.api.account.zone.<zone>` or `…zone.*`, at the top level or nested
 *   under the account key (`{ "com.cloudflare.api.account.<a>": { "com.cloudflare.api.account.zone.*": "*" } }`),
 *   or the account key with the value `"*"`.
 * A permission is present when an `allow` policy grants a group of that name (or a stronger one
 * listed with it) on the scope, and no `deny` policy takes it away. The names are those the
 * live token showed on 2026-10-25 (decision note i-f.md).
 */
import { describeFailure, resultOf, succeeded, type CloudflareApi } from "./api.js";

export interface RequiredPermission {
  /** The permission group's name as Cloudflare lists it. */
  readonly name: string;
  readonly scope: "account" | "zone";
  /** Group names that also satisfy it. */
  readonly alsoSatisfiedBy?: readonly string[];
}

/** DEC-0515's email permissions: what `setup-account` and a production deploy need beyond the stage permissions. */
export const EMAIL_PERMISSIONS: readonly RequiredPermission[] = Object.freeze([
  { name: "Email Sending Write", scope: "account" },
  { name: "Email Routing Addresses Write", scope: "account" },
  { name: "Email Routing Rules Write", scope: "zone" },
  { name: "DNS Write", scope: "zone" },
  { name: "Zone Settings Write", scope: "zone" },
  { name: "Zone Read", scope: "zone", alsoSatisfiedBy: ["Zone Write"] },
]);

/** What `setup-account` additionally needs for the mail sink's Worker and bucket. */
export const MAIL_SINK_PERMISSIONS: readonly RequiredPermission[] = Object.freeze([
  { name: "Workers Scripts Write", scope: "account" },
  { name: "Workers R2 Storage Write", scope: "account" },
]);

interface Policy {
  readonly effect?: unknown;
  readonly resources?: unknown;
  readonly permission_groups?: readonly { readonly name?: unknown }[];
}

const ACCOUNT_PREFIX = "com.cloudflare.api.account.";
const ZONE_PREFIX = "com.cloudflare.api.account.zone.";

function coversZone(resources: Readonly<Record<string, unknown>>, zoneId: string): boolean {
  return Object.keys(resources).some((key) => key === `${ZONE_PREFIX}${zoneId}` || key === `${ZONE_PREFIX}*`);
}

/** Whether a policy's resources include the scope. */
export function policyCovers(resources: unknown, scope: "account" | "zone", accountId: string, zoneId: string): boolean {
  if (typeof resources !== "object" || resources === null) return false;
  const top = resources as Record<string, unknown>;
  const accountKeys = [`${ACCOUNT_PREFIX}${accountId}`, `${ACCOUNT_PREFIX}*`];
  // An account group needs the whole account (`"*"`); an account key holding zones grants only on those zones (DEC-0586).
  if (scope === "account") return accountKeys.some((k) => top[k] === "*");
  if (coversZone(top, zoneId)) return true;
  return accountKeys.some((k) => {
    const nested = top[k];
    if (nested === "*") return true;
    return typeof nested === "object" && nested !== null && coversZone(nested as Record<string, unknown>, zoneId);
  });
}

/** The required permissions the policies do not grant on their scope. */
export function missingPermissions(policies: readonly Policy[], required: readonly RequiredPermission[], accountId: string, zoneId: string): RequiredPermission[] {
  const grants = (p: Policy, want: RequiredPermission) =>
    (p.permission_groups ?? []).some((g) => g.name === want.name || (want.alsoSatisfiedBy ?? []).includes(String(g.name))) && policyCovers(p.resources, want.scope, accountId, zoneId);
  return required.filter((want) => {
    const allowed = policies.some((p) => p.effect !== "deny" && grants(p, want));
    const denied = policies.some((p) => p.effect === "deny" && grants(p, want));
    return !allowed || denied;
  });
}

/** How one missing permission is named to the owner. */
export const permissionProblem = (p: RequiredPermission, emailDomain: string): string =>
  `the Cloudflare API token lacks the permission "${p.name}" (${p.scope === "account" ? "account" : `zone ${emailDomain}`}; DEC-0515)`;

/** The token's policies; throws with a message naming what is needed to read them. */
export async function tokenPolicies(api: CloudflareApi, accountId: string): Promise<readonly Policy[]> {
  const verify = await api("GET", `/accounts/${accountId}/tokens/verify`);
  const id = resultOf<{ id?: unknown }>(verify, "verifying CLOUDFLARE_API_TOKEN").id;
  if (typeof id !== "string" || id === "") throw new Error("verifying CLOUDFLARE_API_TOKEN: Cloudflare returned no token ID");
  const r = await api("GET", `/accounts/${accountId}/tokens/${id}`);
  if (!succeeded(r)) throw new Error(`the Cloudflare API token cannot read its own permissions (it needs "Account API Tokens Read"): ${describeFailure(r)}`);
  const policies = (r.body as { result?: { policies?: unknown } }).result?.policies;
  return Array.isArray(policies) ? (policies as Policy[]) : [];
}
