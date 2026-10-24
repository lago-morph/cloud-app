/**
 * The cloud SEC-AC-001 / HTTP-AC-002 check after a stage's secret was deleted through the store
 * (secrets/further-stage.test.ts). Root cause and review:
 * ai/implementation/root-causes/2026-10-24-pass2-SEC-AC-001-HTTP-AC-002-delete-read-too-early.md.
 */
import { expect } from "vitest";
import { CLOUD_WAITS, waitFor, type ComplianceClient } from "../../../harness/index.js";
import { catalogueStatus, errorResponseViolations, UUID } from "./repo.js";

export interface SecretMissingOptions {
  /** For tests of this helper: a fake clock (see harness/wait.ts). */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The paths that read the declared secret `apiKey` (apps/reference/ROUTES.md). */
export const SECRET_MISSING_PATHS = ["/api/ref/secret", "/api/errors/SEC.MISSING"] as const;

/**
 * After the stage's secret was deleted: waits, bounded, until the stage answers SEC.MISSING
 * (DEC-0092: Cloudflare applies a secret change by rolling out a new Worker version, and the
 * previous version keeps serving its value for a short time). Then asserts, on fresh requests,
 * that each path fails with SEC.MISSING as a schema-valid ErrorResponse with its own request ID.
 * The wait accepts only the catalogue's SEC.MISSING status with code SEC.MISSING; anything else
 * keeps it waiting, and a stage that never answers SEC.MISSING fails at the bound.
 */
export async function expectSecretMissing(c: ComplianceClient, options: SecretMissingOptions = {}): Promise<void> {
  const status = catalogueStatus("SEC.MISSING");
  await waitFor(async () => c.expectError(await c.get(SECRET_MISSING_PATHS[0]), status, "SEC.MISSING"), {
    what: "the stage answering SEC.MISSING after its secret was deleted",
    timeoutMs: CLOUD_WAITS.secretRolloutMs,
    intervalMs: 2_000,
    ...options,
  });
  const ids = new Set<string>();
  for (const path of SECRET_MISSING_PATHS) {
    const r = c.expectError(await c.get(path), status, "SEC.MISSING");
    expect(errorResponseViolations(r.json()), path).toEqual([]);
    expect(r.requestId ?? "", path).toMatch(UUID);
    ids.add(r.requestId ?? "");
  }
  expect(ids.size, "each response has its own request ID").toBe(2);
}
