/**
 * Better Auth's tables (plan-auth.md item I-A) on the SQLite dialect: local D1 through
 * Wrangler's getPlatformProxy (Miniflare). The dialect is selected before the framework is
 * loaded (../sql/support/dialect.ts).
 */
import { selectDialect } from "../sql/support/dialect.js";

selectDialect("sqlite");
const { defineAuthTablesSuite } = await import("./auth-tables.suite.js");
defineAuthTablesSuite("sqlite");
