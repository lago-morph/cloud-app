/**
 * AWS PRE-CHECK, NOT EVIDENCE (plan-aws G-T3): C-T2's shared KV case set (the reference app's
 * `kv` cases with the compliance suite's literal expectations, tests/compliance/criteria/kv/
 * suite.ts) through `createKv` over the real Data API adapter (`dataApiDb`) and the Data API
 * fake. Untagged: `tag` keeps only the title, so no criterion is ever credited from this file.
 *
 * Before anything loads the framework: the Postgres dialect is selected and
 * `@lago-morph/prototype-framework` resolves to the sources (see sql.data-api.test.ts).
 */
import { describe, vi } from "vitest";

vi.mock("@lago-morph/prototype-framework", () => import("../../../src/index.js"));
vi.mock("../../../../../tests/support/tags.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../tests/support/tags.js")>()),
  tag: (_ids: string | readonly string[], title: string) => title,
}));

process.env.PROTOTYPE_FRAMEWORK_DIALECT = "postgres";
const { NOT_EVIDENCE, DATA_API_PLACE, dataApiCaseRunner, guardAwsNetwork } = await import("./support.js");
const { defineKvSuite } = await import("../../../../../tests/compliance/criteria/kv/suite.js");

describe(`AWS KV, ${NOT_EVIDENCE}`, () => {
  guardAwsNetwork();
  defineKvSuite(DATA_API_PLACE, dataApiCaseRunner);
});
