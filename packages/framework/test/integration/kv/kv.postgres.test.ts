/**
 * KV integration suite (B-T2) on the Postgres dialect: `__framework_kv` in PGlite with C
 * collation and C ctype (DEC-0106). The dialect is selected before the framework is loaded
 * (../sql/support/dialect.ts).
 */
import { selectDialect } from "../sql/support/dialect.js";

selectDialect("postgres");
const { defineKvSuite } = await import("./kv.suite.js");
defineKvSuite("postgres");
