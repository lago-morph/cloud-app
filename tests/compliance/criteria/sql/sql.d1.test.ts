/**
 * SQL shared case set in-process on local D1 (SQL-AC-003…-006, local part). The dialect is
 * fixed per process (DEC-0134) and selected here before the framework loads. In-process runs
 * exist only on the local target: on a cloud run the same suite runs through the stage
 * (sql.http.test.ts), and in-process results would not be that target's.
 */
import { target } from "../../harness/index.js";

process.env.PROTOTYPE_FRAMEWORK_DIALECT = "sqlite";
const { defineSqlSuite } = await import("./suite.js");
const { inProcessRunner } = await import("./support/runner.js");

if (target().target === "local") defineSqlSuite("in-process local D1", () => inProcessRunner("sqlite"));
