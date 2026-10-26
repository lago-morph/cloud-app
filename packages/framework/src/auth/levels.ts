/**
 * Access level of a valid real-provider session, from the account's current state (AUTH-REQ-003,
 * auth.md §2 "Levels", DEC-0521, DEC-0522, DEC-0524). There is no admin or users list:
 * - no account (`null`), or an unverified one: `anonymous` (an unverified account is never a user);
 * - a verified account: `user`, or `admin` when its roles contain `admin`.
 * Unknown role names are ignored.
 */
import type { AccountStatus } from "./login-provider.js";
import type { CurrentUser } from "./public.js";
import { ADMIN_ROLE } from "./roles.js";

const ANONYMOUS: CurrentUser = Object.freeze({ level: "anonymous" });

export function levelFromAccount(login: { readonly id: string; readonly displayName: string | null }, status: AccountStatus | null): CurrentUser {
  if (status === null || status.verified !== true) return ANONYMOUS;
  const level = status.roles.includes(ADMIN_ROLE) ? "admin" : "user";
  return { level, id: login.id, displayName: login.displayName };
}
