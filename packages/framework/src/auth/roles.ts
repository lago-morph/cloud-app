/**
 * The account's role list (PWD-REQ-008, auth.md §2 "Role list", DEC-0521): role names separated
 * by commas in `__framework_auth_user.role`, NULL when there are none. `admin` is the only role
 * defined; there is no "user" role, and nothing ever writes one. Shared by AUTH (reading), the
 * test helpers and the `admins` command (writing). Workers-compatible, no I/O.
 */

/** The roles the framework acts on (internal/login-provider.d.ts `Role`). */
export type Role = "admin";

export const ADMIN_ROLE: Role = "admin";

/** Splits a stored list on commas, trims each name and drops empty ones (unknown names are kept, and ignored by AUTH). */
export function parseRoles(stored: string | null | undefined): string[] {
  if (stored === null || stored === undefined) return [];
  return stored
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** The stored form of a list: names unique and in order, NULL when empty (never `user`). */
export function formatRoles(roles: readonly string[]): string | null {
  const unique = [...new Set(roles.map((name) => name.trim()).filter((name) => name !== ""))];
  return unique.length === 0 ? null : unique.join(",");
}

/** `roles` with `role` added at the end (unchanged when already held). */
export function withRole(roles: readonly string[], role: Role): string[] {
  return roles.includes(role) ? [...roles] : [...roles, role];
}

/** `roles` without `role`. */
export function withoutRole(roles: readonly string[], role: Role): string[] {
  return roles.filter((name) => name !== role);
}
