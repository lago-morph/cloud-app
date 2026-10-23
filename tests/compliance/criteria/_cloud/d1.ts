/**
 * Cloudflare D1 guards for cloud tests (plan §1 "Cloud usage limits"; DEC-0317, DEC-0419).
 *
 * - **D1 stop (DEC-0317).** Every test that needs D1 on Cloudflare (any deploy of a stage
 *   creates and migrates its D1 database, so every test that deploys a stage needs D1) calls
 *   `requireCloudD1()` before touching the cloud. Unless the operator has confirmed that the
 *   daily limit has reset and set `COMPLIANCE_CLOUDFLARE_D1=available`, the test reports a
 *   missing prerequisite with exactly the DEC-0317 detail and is recorded `blocked`. The default
 *   is "stopped", so no run uses D1 by accident while the owner's direction holds.
 * - **At most `MAX_D1_DATABASES` (8) D1 databases at once (DEC-0419; account limit 10,
 *   PAR-219).** `requireDatabaseRoom(n)` counts the account's test-stage databases
 *   (`<app>-test-…-db-<n>`) before a test creates `n` more and reports a missing prerequisite
 *   when the total would exceed the cap. One Cloudflare API
 *   request per call; no D1 rows.
 */
import { prerequisiteMissing } from "../../harness/index.js";
import { accountDatabases } from "./stage-resources.js";

export const D1_STOP_DETAIL = "D1 daily row limit exhausted by phase A spikes on 2026-10-19; re-run after reset";
export const D1_AVAILABLE_ENV = "COMPLIANCE_CLOUDFLARE_D1";
export const MAX_D1_DATABASES = 8;

/** Blocks (missing prerequisite) a test that needs D1 on Cloudflare while DEC-0317 holds. */
export function requireCloudD1(target: string): void {
  if (target !== "cloudflare") return;
  if (process.env[D1_AVAILABLE_ENV] !== "available") prerequisiteMissing(D1_STOP_DETAIL);
}

const TEST_STAGE_DATABASE = /^[a-z0-9]+-test-[a-z0-9-]+-db-\d+$/;

/** The account's databases that belong to test stages. */
export async function testStageDatabases(): Promise<string[]> {
  return (await accountDatabases()).map((d) => d.name).filter((n) => TEST_STAGE_DATABASE.test(n)).sort();
}

/** Reports a missing prerequisite when creating `more` databases would hold more than `MAX_D1_DATABASES` at once. */
export async function requireDatabaseRoom(more: number, what: string): Promise<void> {
  const existing = await testStageDatabases();
  if (existing.length + more > MAX_D1_DATABASES) {
    prerequisiteMissing(
      `${what} creates up to ${String(more)} D1 database(s) while ${String(existing.length)} test-stage database(s) exist (${existing.join(", ")}); ` +
        `at most ${String(MAX_D1_DATABASES)} at once (DEC-0419): run it in a pass with fewer other stages`,
    );
  }
}
