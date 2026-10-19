/**
 * KV integration suite (B-T2) on the SQLite dialect: `__framework_kv` in local D1
 * (Wrangler's `getPlatformProxy`, DEC-0105). The dialect is selected before the framework
 * is loaded (../sql/support/dialect.ts).
 */
import { selectDialect } from "../sql/support/dialect.js";

selectDialect("sqlite");
const { defineKvSuite } = await import("./kv.suite.js");
defineKvSuite("sqlite");
