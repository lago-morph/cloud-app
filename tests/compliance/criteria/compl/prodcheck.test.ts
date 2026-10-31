/**
 * The production checks on the reference app's `prodcheck` stage (compliance.md COMPL-REQ-005 as
 * amended, §2 "Production-check stage"; plan-auth.md items T2 and T3). The cloud run redeploys
 * `prodcheck` before the test layers and runs `check-login` on it after them (harness/prodcheck.ts).
 *
 * - AUTH-AC-009, production part: "`/api/auth/mock-login` … returns 404 on a production
 *   deployment. Production bundles contain no mock module."
 * - E2E-006: "`/api/auth/mock-login` and `/api/__framework/test-mail` return 404, the deployed
 *   bundle contains no mock or mail-capture code, and `/api/auth/login` redirects to the
 *   framework's sign-in page on the stage's public origin."
 * - COMPL-AC-005 as D's #136 proposes to amend it (DEC-0700, awaiting the owner's approval; the
 *   text on this base still names PWD-AC-009): "On every cloud run, after `prodcheck` is redeployed, the
 *   evidence record has results for its production checks: mock-login and the test-mail route
 *   answer 404, `/api/auth/login` redirects to the auth app's `/start`, and `check-login`'s
 *   AUTH-AC-011 and E2E-008 results are present." This test is the record's result for the HTTP checks,
 *   made after the redeploy (the stage's recorded deploy output is newer than the run stage's).
 *   `check-login` runs after the test layers, so a test cannot read its result; the test checks
 *   that this run is one in which the driver runs it and folds AUTH-AC-011 and E2E-008 in (the expected list,
 *   PRODCHECK_IDS, CHECK_LOGIN_IDS), and the driver's unit tests show the folding itself.
 *
 * The deployed bundle is the Worker script `reference-prodcheck` (CF §2, DEC-0331), downloaded
 * through the Cloudflare API, and is recognised by the strings that survive bundling, as the
 * local bundle inspections do: the route paths `mock-login` and `__framework/test-mail`, and the
 * positive control `__framework/health`.
 */
import { statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClient, prerequisiteMissing, tag, target, type ComplianceClient } from "../../harness/index.js";
import { readCatalogue } from "../../harness/catalogue.js";
import { expectedCriteria } from "../../harness/expected.js";
import { CHECK_LOGIN_IDS, driverChecks, PRODCHECK_IDS, PRODCHECK_STAGE } from "../../harness/prodcheck.js";
import { accountId, cfRawGet } from "../_cloud/api.js";
import { recordedOrigin } from "../cli/support/admins.js";
import { DOCS, isLocal, REFERENCE_APP_NAME, REFERENCE_DIR } from "../core/support/repo.js";

/** Markers of the authentication mock and the test-stage mail capture in a bundle (PROV-AC-005, MAIL-AC-004). */
const MOCK = /mock-login/;
const MAIL_CAPTURE = /__framework\/test-mail/;
const HEALTH = /__framework\/health/;

function prodcheck(): ComplianceClient {
  return createClient({ baseUrl: recordedOrigin(target().target, PRODCHECK_STAGE), keepCookies: true });
}

let script: Promise<string> | undefined;

/** The deployed Worker script of `prodcheck` (every module of it, as downloaded). */
function deployedScript(): Promise<string> {
  script ??= (async () => {
    const name = `${REFERENCE_APP_NAME}-${PRODCHECK_STAGE}`;
    const r = await cfRawGet(`/accounts/${accountId()}/workers/scripts/${encodeURIComponent(name)}`);
    if (r.status === 404) return prerequisiteMissing(`the Worker script ${name} does not exist: prodcheck is not deployed`);
    if (r.status !== 200) throw new Error(`downloading the Worker script ${name} failed: HTTP ${String(r.status)} ${r.text.slice(0, 300)}`);
    return r.text;
  })();
  return script;
}

async function expectBundleClean(what: { readonly mock: boolean; readonly mail: boolean }): Promise<void> {
  const text = await deployedScript();
  expect(HEALTH.test(text), "the downloaded script is the framework's Worker bundle (positive control: the health route)").toBe(true);
  if (what.mock) expect(MOCK.test(text), "the deployed prodcheck bundle holds the authentication mock (mock-login)").toBe(false);
  if (what.mail) expect(MAIL_CAPTURE.test(text), "the deployed prodcheck bundle holds the test-mail route of the mail capture").toBe(false);
}

async function expectMockLogin404(c: ComplianceClient): Promise<void> {
  // With the public origin, so the forgery check (AUTH-REQ-007) does not answer first.
  const r = c.expectError(await c.post("/api/auth/mock-login", { level: "admin", id: "prodcheck-mock-probe" }), 404, "HTTP.NOT_FOUND");
  expect(r.headers.getSetCookie(), "mock-login on prodcheck sets no cookie").toEqual([]);
  expect(c.expectStatus(await c.get("/api/auth/me"), 200).json(), "nobody is logged in").toStrictEqual({ level: "anonymous" });
}

async function expectTestMail404(c: ComplianceClient): Promise<void> {
  for (const to of ["mail-ac-006-probe@example.test", "sink@t.example.invalid"]) {
    c.expectError(await c.get(`/api/__framework/test-mail?to=${encodeURIComponent(to)}`), 404, "HTTP.NOT_FOUND");
  }
}

async function expectLoginRedirect(c: ComplianceClient): Promise<void> {
  const r = c.expectStatus(await c.get("/api/auth/login?returnTo=%2Fafter"), 302);
  const location = new URL(r.headers.get("location") ?? "", c.baseUrl);
  // Production stages sign in through the auth app (plan-v0.2.0 §4.1; the password sign-in page is removed).
  expect(location.pathname, "/api/auth/login redirects to the auth app's /start").toBe("/start");
  expect(location.searchParams.get("return"), "with the callback URL on the public origin").toBe(`${c.baseUrl}/api/auth/callback`);
}

/** The recorded deploy output of `stage` (cli.md §2) and when it was written. */
function recordedAt(stage: string): number | undefined {
  const file = join(REFERENCE_DIR, ".framework", target().target, "stages", `${stage}.json`);
  return existsSync(file) ? statSync(file).mtimeMs : undefined;
}

if (!isLocal()) {
  describe("production checks on prodcheck", () => {
    it(tag("AUTH-AC-009", "production part (prodcheck): POST /api/auth/mock-login is 404 HTTP.NOT_FOUND and logs nobody in; the deployed bundle holds no mock module"), async () => {
      await expectMockLogin404(prodcheck());
      await expectBundleClean({ mock: true, mail: false });
    });

    it(tag("E2E-006", "prodcheck: mock-login and the test-mail route are 404, the deployed bundle holds no mock or mail-capture code, and /api/auth/login redirects to the auth app's /start"), async () => {
      const c = prodcheck();
      await expectMockLogin404(c);
      await expectTestMail404(c);
      await expectBundleClean({ mock: true, mail: true });
      await expectLoginRedirect(c);
    });

    it(tag("COMPL-AC-005", "after this run redeployed prodcheck: mock-login and the test-mail route are 404, /api/auth/login redirects to the auth app's /start, and the run runs check-login there"), async () => {
      const t = target();
      // "After prodcheck is redeployed": the driver deploys the run stage, then prodcheck (prodcheck.ts).
      const runStage = t.stage ?? "";
      const stageAt = recordedAt(runStage);
      const prodAt = recordedAt(PRODCHECK_STAGE);
      if (stageAt === undefined) prerequisiteMissing(`the run stage ${runStage} has no recorded deploy output in this checkout (a run with --base-url): the redeploy of prodcheck cannot be ordered against it`);
      expect(prodAt, "prodcheck has a recorded deploy output").toBeDefined();
      expect(prodAt ?? 0, "prodcheck's deploy output was recorded after the run stage's: it was redeployed in this run").toBeGreaterThanOrEqual(stageAt ?? Number.POSITIVE_INFINITY);

      const c = prodcheck();
      await expectMockLogin404(c);
      await expectTestMail404(c);
      await expectLoginRedirect(c);

      // check-login runs after the test layers: this run must be one that runs it (its E2E-008 result).
      expect(PRODCHECK_IDS, "COMPL-AC-005 makes the run redeploy prodcheck and run check-login").toContain("COMPL-AC-005");
      expect(driverChecks(t.target).map((d) => d.title).some((title) => title.startsWith("[E2E-008]")), "the run lists check-login's E2E-008 check").toBe(true);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("production checks on prodcheck (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
