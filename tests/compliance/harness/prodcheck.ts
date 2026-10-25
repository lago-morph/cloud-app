/**
 * The production checks of a cloud run (COMPL-REQ-005 as amended; compliance.md §2
 * "Production-check stage"; DEC-0512): the driver redeploys the reference app's long-lived
 * production stage `prodcheck` before the test layers (the tests of its other parts read its
 * recorded deploy output), and runs `check-login --target <cloud> --stage prodcheck` after them.
 * `check-login` runs last because its sign-in burst leaves the run's client IP rate-limited for
 * PAR-258's window, and because the tests on `prodcheck` sign in from the same IP.
 *
 * `check-login` writes its own evidence record; the driver folds that record's results for
 * PWD-AC-009, AUTH-AC-011 and E2E-008 into the run's record as outcomes of one driver check per
 * ID, titled `DRIVER_CHECK_TITLE`, so they are tagged like any test (and listed as such:
 * `driverChecks`, used by the coverage listing).
 */
import type { EvidenceRecord } from "../../../packages/framework/src/evidence/public.js";
import { tag } from "../../support/tags.js";
import type { Target } from "./catalogue.js";
import type { TestOutcome } from "./results.js";

export const PRODCHECK_STAGE = "prodcheck";

/** The results `check-login` records (password.md §2; `CHECK_LOGIN_IDS` of the command). */
export const CHECK_LOGIN_IDS: readonly string[] = ["PWD-AC-009", "AUTH-AC-011", "E2E-008"];

/** The criteria whose cloud part runs on `prodcheck` (compliance.md §2): the driver redeploys it when one of them runs. */
export const PRODCHECK_IDS: readonly string[] = [...CHECK_LOGIN_IDS, "COMPL-AC-005", "E2E-006", "E2E-007", "AUTH-AC-005", "AUTH-AC-009", "MAIL-AC-006", "CLI-AC-007"];

export const DRIVER_CHECK_TITLE = "check-login --stage prodcheck, run by the compliance driver after the test layers (COMPL-REQ-005)";
export const DRIVER_CHECK_FILE = "tests/compliance/harness/prodcheck.ts";

/** The driver's own checks on `target`, as a listing shows tests (cloud targets only). */
export function driverChecks(target: Target): { readonly title: string; readonly file: string }[] {
  return target === "local" ? [] : CHECK_LOGIN_IDS.map((id) => ({ title: tag(id, DRIVER_CHECK_TITLE), file: DRIVER_CHECK_FILE }));
}

/** The `Evidence: <path>` line `check-login` prints. */
export function checkLoginRecordPath(output: string): string | undefined {
  return /Evidence: (\S+\.json)/.exec(output)?.[1];
}

/**
 * Outcomes for `ids` (a subset of CHECK_LOGIN_IDS) from one `check-login` run: each ID's result
 * in its record (passed, failed with the detail, not-run as a skip with the detail as note), or a
 * failure naming why there is none.
 */
export function checkLoginOutcomes(ids: readonly string[], run: { readonly status: number; readonly output: string; readonly record?: EvidenceRecord } | { readonly problem: string }): TestOutcome[] {
  return ids.map((id): TestOutcome => {
    const base = { title: tag(id, DRIVER_CHECK_TITLE), file: DRIVER_CHECK_FILE };
    if ("problem" in run) return { ...base, status: "failed", message: run.problem };
    const result = run.record?.results.find((r) => r.id === id);
    if (result === undefined) {
      const last = run.output.trim().split("\n").at(-1) ?? "";
      return { ...base, status: "failed", message: `check-login exited ${String(run.status)} with no result for ${id} in a record: ${last}` };
    }
    if (result.status === "passed") return { ...base, status: "passed" };
    if (result.status === "not-run") return { ...base, status: "skipped", note: result.detail ?? "not run by check-login" };
    return { ...base, status: "failed", message: `check-login ${result.status}: ${result.detail ?? ""} (record ${run.record?.runId ?? "?"})` };
  });
}
