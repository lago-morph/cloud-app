/**
 * The password provider's account state (PWD-REQ-008, password.md §2 "Role column"; DEC-0521,
 * DEC-0524, DEC-0525). Framework-internal, Workers-compatible.
 *
 * - `readAccountStatus` is `accountStatus(subject)`: one primary-key read of
 *   `__framework_auth_user` (`email_verified`, `role`), null when there is no row.
 * - `changeAccountRole` is what `TestApp.grantRole`/`revokeRole` write: one read, then one
 *   `UPDATE … WHERE id = ?` of the parsed list (names unique and in order), NULL when no role is
 *   left, never `user`. Holding the role already, or not holding it on revoke, writes nothing.
 *   The `admins` command writes the same list through its own D1 statements (cli/commands/admins.ts).
 */
import { eq } from "drizzle-orm";
import type { AccountStatus } from "../login-provider.js";
import { formatRoles, parseRoles, withRole, withoutRole, type Role } from "../roles.js";
import { deriveUserId } from "../user-id.js";
import type { PasswordDatabase } from "./options.js";
import { authTables } from "./tables.js";

interface Row {
  readonly emailVerified: boolean | number | null;
  readonly role: string | null;
}

/** Drizzle's query builder as these two statements use it (the D1 and PGlite drivers both fit). */
interface Db {
  select(fields: Record<string, unknown>): { from(table: unknown): { where(condition: unknown): { limit(n: number): Promise<Row[]> } } };
  update(table: unknown): { set(values: Record<string, unknown>): { where(condition: unknown): Promise<unknown> } };
}

async function readRow(database: PasswordDatabase, subject: string): Promise<Row | undefined> {
  const { user } = authTables(database.dialect);
  const db = database.db as Db;
  const rows = await db.select({ emailVerified: user.emailVerified, role: user.role }).from(user).where(eq(user.id, subject)).limit(1);
  return rows[0];
}

export async function readAccountStatus(database: PasswordDatabase, subject: string): Promise<AccountStatus | null> {
  const row = await readRow(database, subject);
  if (row === undefined) return null;
  return { verified: row.emailVerified === true || row.emailVerified === 1, roles: parseRoles(row.role) };
}

/**
 * The subject (BA's user `id`) whose user ID, as `/api/auth/me` shows it, is `userId`; undefined
 * when none. The user ID cannot be reversed (AUTH-REQ-002), so this derives each account's ID:
 * for the test helpers only, over a test app's few accounts.
 */
export async function subjectOfUserId(database: PasswordDatabase, providerId: string, userId: string): Promise<string | undefined> {
  const { user } = authTables(database.dialect);
  const db = database.db as unknown as { select(fields: Record<string, unknown>): { from(table: unknown): Promise<{ id: string }[]> } };
  for (const row of await db.select({ id: user.id }).from(user)) {
    if ((await deriveUserId(providerId, row.id)) === userId) return row.id;
  }
  return undefined;
}

/** Adds or removes `role`; false when no account has `subject` (nothing written). */
export async function changeAccountRole(database: PasswordDatabase, subject: string, role: Role, change: "grant" | "revoke"): Promise<boolean> {
  const row = await readRow(database, subject);
  if (row === undefined) return false;
  const before = parseRoles(row.role);
  const after = change === "grant" ? withRole(before, role) : withoutRole(before, role);
  const stored = formatRoles(after);
  if (stored === formatRoles(before) && stored === row.role) return true;
  const { user } = authTables(database.dialect);
  await (database.db as Db).update(user).set({ role: stored }).where(eq(user.id, subject));
  return true;
}
