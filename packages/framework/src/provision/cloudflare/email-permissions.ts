/**
 * The Cloudflare API token's email permissions (DEC-0515; PROV-REQ-002 step 1, PROV-REQ-004
 * amendment, PROV-AC-004): `setup-account` names each
 * one the token lacks, before anything changes. The generic policy reading is in
 * `token-policies.ts` (moved there unchanged, DEC-0687).
 */
import type { RequiredPermission } from "./token-policies.js";

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

/** How one missing permission is named to the owner. */
export const permissionProblem = (p: RequiredPermission, emailDomain: string): string =>
  `the Cloudflare API token lacks the permission "${p.name}" (${p.scope === "account" ? "account" : `zone ${emailDomain}`}; DEC-0515)`;
