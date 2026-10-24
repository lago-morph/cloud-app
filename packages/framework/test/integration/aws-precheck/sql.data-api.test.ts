/**
 * AWS PRE-CHECK, NOT EVIDENCE (plan-aws G-T3): C-T2's shared SQL case set (the reference app's
 * `sql` cases with the compliance suite's literal expectations, tests/compliance/criteria/sql/
 * suite.ts) through the real Data API adapter (`dataApiDb`) over the Data API fake. Untagged:
 * `tag` keeps only the title, so no criterion is ever credited from this file.
 *
 * Before anything loads the framework: the Postgres dialect is selected (the reference schema is
 * built for it at import) and `@lago-morph/prototype-framework` resolves to the sources, so the
 * cases and the adapter share one `FrameworkError` class.
 */
import { describe, vi } from "vitest";

vi.mock("@lago-morph/prototype-framework", () => import("../../../src/index.js"));
vi.mock("../../../../../tests/support/tags.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../../tests/support/tags.js")>()),
  tag: (_ids: string | readonly string[], title: string) => title,
}));

process.env.PROTOTYPE_FRAMEWORK_DIALECT = "postgres";
const { NOT_EVIDENCE, DATA_API_PLACE, dataApiCaseRunner, guardAwsNetwork } = await import("./support.js");
const { defineSqlSuite } = await import("../../../../../tests/compliance/criteria/sql/suite.js");

describe(`AWS SQL, ${NOT_EVIDENCE}`, () => {
  guardAwsNetwork();
  defineSqlSuite(DATA_API_PLACE, dataApiCaseRunner);
});
