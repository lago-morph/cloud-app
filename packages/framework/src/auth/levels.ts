/**
 * Access level of a validated (real-provider) login, evaluated on every request
 * (AUTH-REQ-003, DEC-0080): admin exactly when the ID is in `framework.admins`; when
 * `framework.users` is present, an ID on neither list is anonymous, and its ID is kept only for
 * `/api/auth/me` (`unlistedId`, AUTH-REQ-005).
 */
import type { CurrentUser } from "./public.js";

export interface AccessLists {
  readonly admins: readonly string[];
  /** Present exactly when the stage configures `framework.users`. */
  readonly users?: readonly string[];
}

export interface Evaluated {
  readonly user: CurrentUser;
  /** Set only for a validated login that `framework.users` makes anonymous. */
  readonly unlistedId?: string;
}

export function evaluateLogin(login: { readonly id: string; readonly displayName: string | null }, lists: AccessLists): Evaluated {
  if (lists.admins.includes(login.id)) return { user: { level: "admin", id: login.id, displayName: login.displayName } };
  if (lists.users !== undefined && !lists.users.includes(login.id)) return { user: { level: "anonymous" }, unlistedId: login.id };
  return { user: { level: "user", id: login.id, displayName: login.displayName } };
}
