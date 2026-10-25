/**
 * Better Auth's tables (plan-auth.md item I-A) on the Postgres dialect: PGlite with C
 * collation and C ctype (DEC-0106). The dialect is selected before the framework is loaded
 * (../sql/support/dialect.ts).
 */
import { selectDialect } from "../sql/support/dialect.js";

selectDialect("postgres");
const { defineAuthTablesSuite } = await import("./auth-tables.suite.js");
defineAuthTablesSuite("postgres");
