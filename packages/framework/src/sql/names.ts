/**
 * SQL name rules (sql.md SQL-REQ-001). Table and column SQL names are lowercase ASCII
 * snake_case, at most 63 bytes (the Postgres identifier limit, so no target truncates them),
 * never `sqlite_…` (reserved by SQLite) and never the framework's `__framework_` prefix.
 * Column keys are lowerCamelCase; each upper-case letter becomes `_` plus its lower case.
 */
import { FrameworkError } from "../core/errors.js";

export const MAX_NAME_BYTES = 63;
export const RESERVED_PREFIX = "__framework_";

const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const FRAMEWORK_SNAKE = /^__framework_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;

function misconfigured(message: string): never {
  throw new FrameworkError("CORE.MISCONFIGURED", message);
}

/** The SQL name of a lowerCamelCase column key. */
export function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export function checkTableName(name: string, opts: { framework?: boolean } = {}): void {
  const quoted = JSON.stringify(name);
  if (name.startsWith(RESERVED_PREFIX)) {
    if (opts.framework === true && FRAMEWORK_SNAKE.test(name) && name.length <= MAX_NAME_BYTES) return;
    misconfigured(`table name ${quoted} uses the reserved ${RESERVED_PREFIX} prefix; choose another lowercase snake_case name`);
  }
  if (!SNAKE.test(name) || name.length > MAX_NAME_BYTES || name.startsWith("sqlite_")) {
    misconfigured(
      `table name ${quoted} breaks the table-name rule: lowercase ASCII snake_case (letters, digits, single underscores between words, starting with a letter), at most ${MAX_NAME_BYTES} characters, not starting with "sqlite_"`,
    );
  }
}

export function checkColumnKey(table: string, key: string): void {
  if (!CAMEL.test(key) || snakeCase(key).length > MAX_NAME_BYTES) {
    misconfigured(
      `column key ${JSON.stringify(key)} of table ${JSON.stringify(table)} breaks the column-key rule: lowerCamelCase ASCII (starting with a lowercase letter, letters and digits only), whose snake_case SQL name is at most ${MAX_NAME_BYTES} characters`,
    );
  }
}
