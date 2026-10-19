/**
 * Every database operation runs through a guard (SQL-REQ-006).
 */

/** Runs one database operation. */
export type Guard = <T>(operation: () => Promise<T>) => Promise<T>;

export function createGuard(): Guard {
  return (operation) => operation();
}
