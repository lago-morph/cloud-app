/**
 * `./testing`'s TestApp contract on the SQLite dialect (local D1). The dialect is selected before
 * the framework is loaded (../sql/support/dialect.ts).
 */
import { selectDialect } from "../sql/support/dialect.js";

selectDialect("sqlite");
const { defineTestingSuite } = await import("./testing.suite.js");
defineTestingSuite("sqlite");
