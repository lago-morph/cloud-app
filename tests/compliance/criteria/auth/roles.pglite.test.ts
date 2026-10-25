/**
 * The levels-from-the-account suite (`roles.suite.ts`: AUTH-AC-003, -012, -013, -015, PWD-AC-010)
 * in-process on PGlite (Postgres). The dialect is fixed per process (DEC-0134) and selected here
 * before the framework loads; the database recorder (`database.ts`) is installed before it too.
 * In-process runs exist only on the local target.
 */
import { target } from "../../harness/index.js";

process.env.PROTOTYPE_FRAMEWORK_DIALECT = "postgres";
await import("./database.js");
const { defineRolesSuite } = await import("./roles.suite.js");

if (target().target === "local") defineRolesSuite("PGlite");
