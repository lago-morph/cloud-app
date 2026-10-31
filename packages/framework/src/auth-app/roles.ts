/**
 * Membership choice and role mapping (plan §4.1 step 3.4–3.5, §4.4). Role names are free text from
 * Cloudflare's API (§10), so matching is by whole, case-sensitive name against PAR-413: a prefix
 * match would make "Administrator Read Only" an admin.
 */
import type { AuthAppRole } from "../auth/auth-app-binding.js";
import { ADMIN_ROLE_NAMES } from "./params.js";

/** `admin` when any role name is one of `adminNames` (PAR-413), else `user`. */
export function mapRole(roles: readonly string[], adminNames: readonly string[] = ADMIN_ROLE_NAMES): AuthAppRole {
  return roles.some((r) => adminNames.includes(r)) ? "admin" : "user";
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/**
 * The role names of the person's `accepted` membership of `accountId` in a `/memberships` result,
 * or `null` when there is none (refused, §4.4). Malformed entries and non-string roles are ignored.
 */
export function pickMembership(list: readonly unknown[], accountId: string): { roles: string[] } | null {
  for (const entry of list) {
    if (!isRecord(entry) || !isRecord(entry.account)) continue;
    if (entry.account.id !== accountId || entry.status !== "accepted") continue;
    const roles = Array.isArray(entry.roles) ? entry.roles.filter((r): r is string => typeof r === "string") : [];
    return { roles };
  }
  return null;
}
