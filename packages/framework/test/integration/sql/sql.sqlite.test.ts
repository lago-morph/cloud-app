/**
 * SQL integration suites (B-T2) on the SQLite dialect: local D1 (Wrangler's
 * `getPlatformProxy`, DEC-0105). The dialect is selected before the framework is loaded
 * (support/dialect.ts).
 */
import { selectDialect } from "./support/dialect.js";

selectDialect("sqlite");
const { defineSqlSuites } = await import("./sql.suites.js");
defineSqlSuites("sqlite");
