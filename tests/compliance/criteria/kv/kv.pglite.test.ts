/**
 * KV shared case set in-process on PGlite (KV-AC-001…-005, local part), plus KV-AC-005's
 * local "database unreachable" clause. The dialect is fixed per process (DEC-0134) and selected
 * here before the framework loads. In-process runs exist only on the local target: on a cloud
 * run the same suite runs through the stage (kv.http.test.ts).
 */
import { target } from "../../harness/index.js";

process.env.PROTOTYPE_FRAMEWORK_DIALECT = "postgres";
const { defineKvSuite, defineKvUnavailableSuite } = await import("./suite.js");
const { inProcessRunner } = await import("../sql/support/runner.js");

if (target().target === "local") {
  defineKvSuite("in-process PGlite", () => inProcessRunner("postgres"));
  defineKvUnavailableSuite("in-process PGlite", (unavailable) => inProcessRunner("postgres", { unavailable }));
}
