/**
 * SQL integration suites (B-T2) on the Postgres dialect: PGlite with C collation and C
 * ctype (DEC-0106). The dialect is selected before the framework is loaded
 * (support/dialect.ts).
 */
import { selectDialect } from "./support/dialect.js";

selectDialect("postgres");
const { defineSqlSuites } = await import("./sql.suites.js");
defineSqlSuites("postgres");
