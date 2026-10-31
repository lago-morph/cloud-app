// Integration layer (vitest.integration.config.ts), COMPL's directory in scripts/ci/path-map.json.
// Root cause 2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test: E2E-004's coverage part for Cloudflare, offline.
// Listing is collect-only (no test body runs, no deployment), but it runs the integration layer's own
// runners as child processes (about 50 CPU-seconds) and needs the framework build, which `test:integration`
// makes and `test:unit` does not: so it lives here, not in the unit layer (root cause
// 2026-10-31-selection-e2e004-under-load, binding fix 3; moved from tests/compliance/harness/selection.unit.test.ts).
// CI runs it for every change to the criteria, the e2e specs, the catalogue, the harness and the tools (the
// path map's test input for tests/compliance/coverage). It is outside tests/compliance/criteria, so a
// Cloudflare run, which E2E-004.spec.ts already checks, never repeats it.
import { describe, expect, it } from "vitest";
import { readCatalogue } from "../harness/catalogue.js";
import { expectedCriteria } from "../harness/expected.js";
import { uncovered } from "../harness/selection.js";
import { driverListingLimitMs, listDriverTests } from "../tools/listing.js";

const repo = new URL("../../../", import.meta.url).pathname;

describe("[E2E-004] the Cloudflare selection covers every criterion expected there", () => {
  // The limit is the listing's ceiling, derived from the children's limits (listing.ts): a hung runner fails
  // as ListingTimeoutError, never as this test's timeout (root cause 2026-10-31-selection-e2e004-under-load, Evidence 5).
  it("every criterion expected on Cloudflare has a tagged test in the cloud selection (AUTH-AC-005's contract part included)", () => {
    const expected = expectedCriteria(readCatalogue(`${repo}docs`), "cloudflare", "automated").filter((e) => e.run);
    const env: NodeJS.ProcessEnv = { ...process.env, COMPLIANCE_TARGET: "cloudflare" };
    for (const k of Object.keys(env)) if (k.startsWith("VITEST")) delete env[k];
    const listing = listDriverTests("cloudflare", { root: repo, env });
    expect(listing.errors).toEqual([]);
    expect(
      uncovered(
        expected.map((e) => e.id),
        listing.tests,
      ),
    ).toEqual([]);
  }, driverListingLimitMs("cloudflare"));
});
