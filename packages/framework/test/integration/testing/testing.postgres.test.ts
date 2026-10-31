/**
 * `./testing`'s TestApp contract on the Postgres dialect (PGlite). The dialect is selected before
 * the framework is loaded (../sql/support/dialect.ts).
 */
import { selectDialect } from "../sql/support/dialect.js";

selectDialect("postgres");
const { defineTestingSuite } = await import("./testing.suite.js");
defineTestingSuite("postgres");
